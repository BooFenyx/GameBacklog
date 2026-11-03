import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import {
  achievements,
  games,
  libraryEntries,
  userAchievements,
  type LastActivitySource,
} from '../db/schema.js';

/** Base de la Steam Web API (authentifiée par `STEAM_API_KEY`). */
const STEAM_API_BASE = 'https://api.steampowered.com';
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;
/** Durée de fraîcheur des déblocages d'un joueur avant nouvel appel Steam. */
const PROGRESS_TTL_MS = 24 * 60 * 60 * 1000;
/** Backoff sans `Retry-After` : 5 s, 15 s puis 60 s. */
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 60_000];
const RATE_LIMIT_BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * 429 Steam : l'import doit s'arrêter proprement au lieu de compter le jeu
 * comme traité. `retryAfterMs` vient de `Retry-After` ou du backoff.
 */
export class SteamRateLimitError extends Error {
  constructor(readonly retryAfterMs: number) {
    super(`Steam a limité les appels (429), retry dans ${retryAfterMs} ms`);
    this.name = 'SteamRateLimitError';
  }
}

/** Lit `Retry-After` (secondes ou date HTTP) et renvoie un délai en ms. */
function lireRetryAfter(headers: Headers | undefined): number | null {
  const valeur = headers?.get('retry-after')?.trim();
  if (!valeur) return null;
  if (/^\d+$/.test(valeur)) return Number(valeur) * 1000;
  const date = Date.parse(valeur);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/** Backoff exponentiel borné quand Steam ne fournit pas `Retry-After`. */
function backoffRateLimitMs(tentative = 0): number {
  const index = Math.min(
    Math.max(0, Math.trunc(tentative)),
    RATE_LIMIT_BACKOFF_MS.length - 1,
  );
  return Math.min(RATE_LIMIT_BACKOFF_MS[index], RATE_LIMIT_BACKOFF_MAX_MS);
}

/** Succès tel que renvoyé au front (avec la date de déblocage éventuelle). */
export interface AchievementDto {
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  unlockedAt: Date | null;
}

/** Compteurs + liste détaillée d'un jeu pour un utilisateur. */
export interface SuccesDetail {
  total: number;
  /** `null` quand Steam ne permet pas de lire la progression (profil privé). */
  unlocked: number | null;
  list: AchievementDto[];
}

/** Ligne `achievements` telle que lue en base. */
interface AchievementRow {
  id: number;
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
}

/** Ligne `library_entries` utile au calcul de progression. */
interface EntreeProgression {
  playtimeForever: number;
  lastActivityAt: Date | null;
  lastActivitySource: LastActivitySource | null;
  achievementsFetchedAt: Date | null;
}

/** Réponse de `GetSchemaForGame`. */
interface GetSchemaForGameResponse {
  game?: {
    availableGameStats?: {
      achievements?: Array<{
        name?: string;
        displayName?: string;
        description?: string;
        icon?: string;
      }>;
    };
  };
}

/** Réponse de `GetPlayerAchievements`. */
interface GetPlayerAchievementsResponse {
  playerstats?: {
    success?: boolean;
    achievements?: Array<{
      apiname?: string;
      achieved?: number;
      unlocktime?: number;
    }>;
  };
}

const STEAM_STAT_URL = (endpoint: string, params: URLSearchParams): string =>
  `${STEAM_API_BASE}/${endpoint}?${params.toString()}`;

/**
 * Résultat d'un appel `GetPlayerAchievements` :
 * - `ok` : progression récupérée ;
 * - `indisponible` : profil de détails privé / succès joueur inaccessibles
 *   (ce n'est pas « zéro succès ») ;
 * - `reseau` : timeout, 5xx ou réponse illisible (transitoire).
 */
type ResultatProgression =
  | {
      kind: 'ok';
      unlocks: Array<{
        apiName?: string;
        achieved?: number;
        unlocktime?: number;
      }>;
    }
  | { kind: 'indisponible' }
  | { kind: 'reseau' };

/**
 * Succès d'un jeu (`Achievement`) et déblocages d'un joueur
 * (`UserAchievement`).
 *
 * Le **schéma** est global et mis en cache une fois par jeu. Les **déblocages**
 * sont propres à l'utilisateur et rafraîchis à la demande, avec un TTL de 24 h.
 * L'étape `achievements` du sync précharge les compteurs pour la bibliothèque ;
 * la fiche charge la liste détaillée à l'ouverture.
 */
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  /**
   * Succès d'un jeu. Si le schéma n'est pas encore en cache, `GetSchemaForGame`
   * est appelé puis persisté (upserts idempotents par `gameId + apiName`).
   */
  async getGameAchievements(
    gameId: number,
    appId: number,
  ): Promise<AchievementRow[]> {
    try {
      return await this.ensureGameAchievements(gameId, appId);
    } catch (error) {
      if (error instanceof SteamRateLimitError) {
        // Comportement historique de la fiche : 503, jamais 500.
        throw new ServiceUnavailableException(
          'Succès Steam indisponibles pour le moment',
        );
      }
      throw error;
    }
  }

  /** Liste complète des succès d'un joueur pour un jeu. */
  async getUserAchievements(
    steamId: string,
    userId: number,
    gameId: number,
    appId: number,
  ): Promise<AchievementDto[]> {
    const detail = await this.getUserAchievementsDetail(
      steamId,
      userId,
      gameId,
      appId,
    );
    return detail.list;
  }

  /** Compteurs + liste complète, avec rafraîchissement si nécessaire. */
  async getUserAchievementsDetail(
    steamId: string,
    userId: number,
    gameId: number,
    appId: number,
    options: {
      force?: boolean;
      propagerRateLimit?: boolean;
      propagerEchecReseau?: boolean;
    } = {},
  ): Promise<SuccesDetail> {
    let schema: AchievementRow[];
    try {
      schema = await this.ensureGameAchievements(
        gameId,
        appId,
        options.force ?? false,
      );
    } catch (error) {
      if (error instanceof SteamRateLimitError && !options.propagerRateLimit) {
        // 429 sur le schéma : la fiche répond 503, comme avant le lot.
        throw new ServiceUnavailableException(
          'Succès Steam indisponibles pour le moment',
        );
      }
      throw error;
    }
    const total = schema.length;

    if (total === 0) {
      await this.marquerProgression(userId, gameId, 0);
      return { total: 0, unlocked: 0, list: [] };
    }

    const entree = await this.chargerEntree(userId, gameId);
    const dateProgression = entree?.achievementsFetchedAt ?? null;
    // Une partie détectée après la dernière récupération force le rafraîchissement.
    const activiteSync =
      entree?.lastActivitySource === 'sync_delta'
        ? entree.lastActivityAt
        : null;
    const frais =
      dateProgression !== null &&
      Date.now() - dateProgression.getTime() < PROGRESS_TTL_MS &&
      (!activiteSync || activiteSync <= dateProgression);

    // Jeu jamais lancé : le débloqué vaut 0, inutile d'appeler
    // `GetPlayerAchievements`. On ignore d'éventuelles lignes historiques et
    // on remet le compteur à 0 pour qu'il ne diverge pas de la fiche.
    if (!options.force && entree && entree.playtimeForever === 0) {
      await this.marquerProgression(userId, gameId, 0);
      return {
        total,
        unlocked: 0,
        list: this.listeDepuisCache(schema, new Map()),
      };
    }

    if (!options.force && frais) {
      const debloques = await this.chargerDeblocages(userId, gameId);
      return {
        total,
        unlocked: debloques.size,
        list: this.listeDepuisCache(schema, debloques),
      };
    }

    let resultat: ResultatProgression;
    try {
      resultat = await this.fetchPlayerStats(steamId, appId);
    } catch (error) {
      if (error instanceof SteamRateLimitError && !options.propagerRateLimit) {
        // 429 sur la progression : servir le cache, comme avant le lot.
        const debloques = await this.chargerDeblocages(userId, gameId);
        return {
          total,
          unlocked: debloques.size,
          list: this.listeDepuisCache(schema, debloques),
        };
      }
      throw error;
    }
    if (resultat.kind === 'reseau') {
      // Échec réseau : la fiche sert le cache. En mode import, on doit au
      // contraire signaler l'échec : sinon `stepAchievements` le compte comme
      // un succès, la passe se réenfile et les mêmes jeux restent manquants.
      if (options.propagerEchecReseau) {
        throw new ServiceUnavailableException(
          'Progression Steam indisponible pour le moment',
        );
      }
      const debloques = await this.chargerDeblocages(userId, gameId);
      return {
        total,
        unlocked: debloques.size,
        list: this.listeDepuisCache(schema, debloques),
      };
    }
    if (resultat.kind === 'indisponible') {
      // Profil de détails privé : la progression n'est pas « zéro succès ».
      // On marque le compteur indisponible (null) sans le remettre à 0, et on
      // sert le cache à la fiche. Le marqueur évite de retenter à chaque login.
      await this.marquerProgressionIndisponible(userId, gameId);
      const debloques = await this.chargerDeblocages(userId, gameId);
      return {
        total,
        unlocked: null,
        list: this.listeDepuisCache(schema, debloques),
      };
    }

    const unlocks = resultat.unlocks;
    const nomsSchema = new Set(schema.map((jeu) => jeu.apiName));
    const unlockedAtByApiName = new Map<string, Date>();
    for (const raw of unlocks) {
      if (
        raw.achieved === 1 &&
        raw.apiName &&
        nomsSchema.has(raw.apiName) &&
        raw.unlocktime
      ) {
        unlockedAtByApiName.set(raw.apiName, new Date(raw.unlocktime * 1000));
      }
    }

    const deblocages = [
      ...new Map(
        schema.flatMap((jeu) => {
          const unlockedAt = unlockedAtByApiName.get(jeu.apiName);
          return unlockedAt
            ? [{ userId, achievementId: jeu.id, unlockedAt }]
            : [];
        }).map((deblocage) => [deblocage.achievementId, deblocage]),
      ).values(),
    ];
    if (deblocages.length > 0) {
      await this.db
        .insert(userAchievements)
        .values(deblocages)
        .onConflictDoUpdate({
          target: [userAchievements.userId, userAchievements.achievementId],
          set: { unlockedAt: sql`excluded.unlocked_at` },
        });
    }

    // Purge uniquement les déblocages explicites : un succès revenu à
    // `achieved: 0` (reverrouillé) ou absent du schéma courant (ancien
    // schéma). Une réponse `success: true` incomplète ne doit pas effacer des
    // déblocages valides.
    const tousLesSucces = await this.loadAll(gameId);
    const idsReverrouilles = new Set(
      unlocks
        .filter(
          (raw) =>
            raw.achieved === 0 && raw.apiName && nomsSchema.has(raw.apiName),
        )
        .map((raw) => schema.find((jeu) => jeu.apiName === raw.apiName)?.id)
        .filter((id): id is number => id !== undefined),
    );
    const idsPerimes = tousLesSucces
      .filter(
        (jeu) => !nomsSchema.has(jeu.apiName) || idsReverrouilles.has(jeu.id),
      )
      .map((jeu) => jeu.id);
    if (idsPerimes.length > 0) {
      await this.db
        .delete(userAchievements)
        .where(
          and(
            eq(userAchievements.userId, userId),
            inArray(userAchievements.achievementId, idsPerimes),
          ),
        );
    }

    await this.marquerProgression(userId, gameId, unlockedAtByApiName.size);

    return {
      total,
      unlocked: unlockedAtByApiName.size,
      list: this.listeDepuisCache(schema, unlockedAtByApiName),
    };
  }

  /** Variante utilisée par l'étape `achievements` du sync. */
  async refreshForSync(
    steamId: string,
    userId: number,
    gameId: number,
    appId: number,
  ): Promise<void> {
    await this.getUserAchievementsDetail(steamId, userId, gameId, appId, {
      propagerRateLimit: true,
      propagerEchecReseau: true,
    });
  }

  /**
   * Garantit que le schéma du jeu est en base. Renvoie les lignes persistées.
   * Le marqueur `games.achievements_fetched_at` évite de rappeler Steam pour
   * un jeu sans succès (total 0).
   */
  private async ensureGameAchievements(
    gameId: number,
    appId: number,
    force = false,
  ): Promise<AchievementRow[]> {
    if (!force) {
      const [jeu] = await this.db
        .select({
          fetchedAt: games.achievementsFetchedAt,
          total: games.achievementsTotal,
        })
        .from(games)
        .where(eq(games.id, gameId))
        .limit(1);

      if (!jeu) return [];
      if (jeu.fetchedAt) return this.loadAll(gameId);

      // Anciennes fiches déjà chargées par la fiche détail : on complète le
      // marqueur sans rappeler Steam.
      const cached = await this.loadAll(gameId);
      if (cached.length > 0) {
        await this.db
          .update(games)
          .set({
            achievementsTotal: cached.length,
            achievementsFetchedAt: new Date(),
          })
          .where(eq(games.id, gameId));
        return cached;
      }
    }

    const list = await this.fetchSchema(appId);
    if (list === null) {
      throw new ServiceUnavailableException(
        'Succès Steam indisponibles pour le moment',
      );
    }

    const lignes = [
      ...new Map(
        list.flatMap((raw) =>
          raw.apiName && raw.displayName
            ? [
                {
                  gameId,
                  apiName: raw.apiName,
                  displayName: raw.displayName,
                  description: raw.description ?? null,
                  iconUrl: raw.iconUrl ?? null,
                },
              ]
            : [],
        ).map((ligne) => [ligne.apiName, ligne]),
      ).values(),
    ];
    if (lignes.length > 0) {
      await this.db
        .insert(achievements)
        .values(lignes)
        .onConflictDoUpdate({
          target: [achievements.gameId, achievements.apiName],
          set: {
            displayName: sql`excluded.display_name`,
            description: sql`excluded.description`,
            iconUrl: sql`excluded.icon_url`,
          },
        });
    }

    await this.db
      .update(games)
      .set({
        achievementsTotal: list.length,
        achievementsFetchedAt: new Date(),
      })
      .where(eq(games.id, gameId));

    return this.loadAll(gameId);
  }

  private async chargerEntree(
    userId: number,
    gameId: number,
  ): Promise<EntreeProgression | null> {
    const [entree] = await this.db
      .select({
        playtimeForever: libraryEntries.playtimeForever,
        lastActivityAt: libraryEntries.lastActivityAt,
        lastActivitySource: libraryEntries.lastActivitySource,
        achievementsFetchedAt: libraryEntries.achievementsFetchedAt,
      })
      .from(libraryEntries)
      .where(
        and(
          eq(libraryEntries.userId, userId),
          eq(libraryEntries.gameId, gameId),
        ),
      )
      .limit(1);
    return entree ?? null;
  }

  private async chargerDeblocages(
    userId: number,
    gameId: number,
  ): Promise<Map<string, Date>> {
    const rows = await this.db
      .select({
        apiName: achievements.apiName,
        unlockedAt: userAchievements.unlockedAt,
      })
      .from(userAchievements)
      .innerJoin(
        achievements,
        eq(userAchievements.achievementId, achievements.id),
      )
      .where(
        and(
          eq(userAchievements.userId, userId),
          eq(achievements.gameId, gameId),
        ),
      );

    return new Map(
      rows
        .filter(
          (row): row is { apiName: string; unlockedAt: Date } =>
            row.unlockedAt !== null,
        )
        .map((row) => [row.apiName, row.unlockedAt]),
    );
  }

  private async marquerProgression(
    userId: number,
    gameId: number,
    unlocked: number,
  ): Promise<void> {
    await this.db
      .update(libraryEntries)
      .set({
        achievementsUnlocked: unlocked,
        achievementsFetchedAt: new Date(),
      })
      .where(
        and(
          eq(libraryEntries.userId, userId),
          eq(libraryEntries.gameId, gameId),
        ),
      );
  }

  /**
   * Progression inaccessible (profil de détails privé) : le compteur passe à
   * `null` — l'UI affiche `—/total` — et la date évite de retenter à chaque
   * login. Ce n'est pas « zéro succès ».
   */
  private async marquerProgressionIndisponible(
    userId: number,
    gameId: number,
  ): Promise<void> {
    await this.db
      .update(libraryEntries)
      .set({
        achievementsUnlocked: null,
        achievementsFetchedAt: new Date(),
      })
      .where(
        and(
          eq(libraryEntries.userId, userId),
          eq(libraryEntries.gameId, gameId),
        ),
      );
  }

  private listeDepuisCache(
    schema: AchievementRow[],
    debloques: Map<string, Date>,
  ): AchievementDto[] {
    return schema.map((jeu) => ({
      apiName: jeu.apiName,
      displayName: jeu.displayName,
      description: jeu.description,
      iconUrl: jeu.iconUrl,
      unlockedAt: debloques.get(jeu.apiName) ?? null,
    }));
  }

  /** Récupère la fiche des succès d'un jeu (`GetSchemaForGame`). */
  private async fetchSchema(appId: number): Promise<Array<{
    apiName: string;
    displayName: string;
    description?: string;
    iconUrl?: string;
  }> | null> {
    let key: string;
    try {
      key = this.apiKey();
    } catch {
      this.logger.warn(
        'STEAM_API_KEY absente : schéma des succès indisponible',
      );
      return null;
    }

    const url = STEAM_STAT_URL(
      'ISteamUserStats/GetSchemaForGame/v2',
      new URLSearchParams({ key, appid: String(appId), l: 'french' }),
    );

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
      if (response.status === 429) {
        throw new SteamRateLimitError(
          lireRetryAfter(response.headers) ?? backoffRateLimitMs(),
        );
      }
      if (!response.ok) {
        this.logger.warn(`GetSchemaForGame a répondu ${response.status}`);
        return null;
      }
      const body = (await response.json()) as GetSchemaForGameResponse;
      // Une réponse 200 sans `game` (maintenance/erreur) ne signifie pas
      // « zéro succès » : on la traite comme indisponible pour ne pas poser
      // définitivement `achievements_fetched_at`.
      if (!body.game) {
        this.logger.warn(`GetSchemaForGame ${appId} sans bloc game`);
        return null;
      }
      return (body.game.availableGameStats?.achievements ?? [])
        .map((a) => ({
          apiName: a.name ?? '',
          displayName: a.displayName ?? '',
          description: a.description,
          iconUrl: a.icon,
        }))
        .filter((a) => a.apiName && a.displayName);
    } catch (error) {
      if (error instanceof SteamRateLimitError) throw error;
      this.logger.warn(
        `GetSchemaForGame ${appId} injoignable: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return null;
    }
  }

  /**
   * Déblocages du joueur (`GetPlayerAchievements`). Renvoie `null` sur une
   * erreur réseau ; lève `SteamRateLimitError` sur 429 pour que l'import
   * puisse mettre la passe en pause.
   */
  private async fetchPlayerStats(
    steamId: string,
    appId: number,
  ): Promise<ResultatProgression> {
    let key: string;
    try {
      key = this.apiKey();
    } catch {
      return { kind: 'reseau' };
    }
    const url = STEAM_STAT_URL(
      'ISteamUserStats/GetPlayerAchievements/v1',
      new URLSearchParams({
        key,
        steamid: steamId,
        appid: String(appId),
        l: 'french',
      }),
    );

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
      if (response.status === 429) {
        throw new SteamRateLimitError(
          lireRetryAfter(response.headers) ?? backoffRateLimitMs(),
        );
      }
      if (!response.ok) {
        this.logger.warn(`GetPlayerAchievements a répondu ${response.status}`);
        return { kind: 'reseau' };
      }
      const body = (await response.json()) as GetPlayerAchievementsResponse;
      // `success: false` → profil de détails privé : ce n'est pas « zéro
      // succès ». On marque la progression indisponible, sans écraser le
      // compteur.
      if (!body.playerstats?.success) return { kind: 'indisponible' };
      // Steam renvoie `apiname` : on normalise vers `apiName` pour le reste du
      // service.
      return {
        kind: 'ok',
        unlocks: (body.playerstats.achievements ?? []).map((raw) => ({
          apiName: raw.apiname,
          achieved: raw.achieved,
          unlocktime: raw.unlocktime,
        })),
      };
    } catch (error) {
      if (error instanceof SteamRateLimitError) throw error;
      this.logger.warn(
        `GetPlayerAchievements ${appId} injoignable: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return { kind: 'reseau' };
    }
  }

  private loadAll(gameId: number): Promise<AchievementRow[]> {
    return this.db
      .select()
      .from(achievements)
      .where(eq(achievements.gameId, gameId))
      .then((rows) => rows as AchievementRow[]);
  }

  private apiKey(): string {
    const key = this.config.get<string>('STEAM_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'STEAM_API_KEY absente : succès Steam indisponibles',
      );
    }
    return key;
  }
}
