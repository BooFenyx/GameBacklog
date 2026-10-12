import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { achievements, libraryEntries, userAchievements } from '../db/schema.js';

/** Base de la Steam Web API (authentifiée par `STEAM_API_KEY`). */
const STEAM_API_BASE = 'https://api.steampowered.com';
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;

/** Succès tel que renvoyé au front (avec la date de déblocage éventuelle). */
export interface AchievementDto {
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
  unlockedAt: Date | null;
}

/** Ligne `achievements` telle que lue en base. */
interface AchievementRow {
  id: number;
  apiName: string;
  displayName: string;
  description: string | null;
  iconUrl: string | null;
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
 * Succès d'un jeu (`Achievement`) et déblocages d'un joueur
 * (`UserAchievement`). Chargés **à la demande**, à l'ouverture du détail d'un
 * jeu (spec) : jamais pendant l'import. Les fiches sont mises en cache dans
 * `achievements` (une seule passe par jeu), les déblocages upsertés
 * individuellement dans `user_achievements`.
 */
@Injectable()
export class AchievementsService {
  private readonly logger = new Logger(AchievementsService.name);

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {}

  /**
   * Succès d'un jeu. Si rien n'est en cache, la fiche `GetSchemaForGame` est
   * récupérée puis persistée (upserts idempotents par `gameId + apiName`).
   */
  async getGameAchievements(
    gameId: number,
    appId: number,
  ): Promise<AchievementRow[]> {
    const [cached] = await this.db
      .select()
      .from(achievements)
      .where(eq(achievements.gameId, gameId))
      .limit(1);
    if (cached) {
      return this.loadAll(gameId);
    }

    const list = await this.fetchSchema(appId);
    for (const raw of list) {
      if (!raw.apiName || !raw.displayName) continue;
      await this.db
        .insert(achievements)
        .values({
          gameId,
          apiName: raw.apiName,
          displayName: raw.displayName,
          description: raw.description ?? null,
          iconUrl: raw.iconUrl ?? null,
        })
        .onConflictDoUpdate({
          target: [achievements.gameId, achievements.apiName],
          set: { displayName: raw.displayName, description: raw.description, iconUrl: raw.iconUrl },
        });
    }
    return this.loadAll(gameId);
  }

  /**
   * Déblocages du joueur pour un jeu : upsert des réussites dans
   * `user_achievements`, mise à jour du compteur
   * `library_entries.achievementsUnlocked`, puis liste complète des succès
   * avec leur date de déblocage.
   */
  async getUserAchievements(
    steamId: string,
    userId: number,
    gameId: number,
    appId: number,
  ): Promise<AchievementDto[]> {
    const jeux = await this.getGameAchievements(gameId, appId);
    if (jeux.length === 0) return [];

    const unlocks = await this.fetchPlayerStats(steamId, appId);

    const unlockedAtByApiName = new Map<string, Date>();
    for (const raw of unlocks) {
      if (raw.achieved === 1 && raw.apiName) {
        unlockedAtByApiName.set(
          raw.apiName,
          new Date((raw.unlocktime ?? 0) * 1000),
        );
      }
    }

    for (const jeu of jeux) {
      const unlockedAt = unlockedAtByApiName.get(jeu.apiName);
      if (!unlockedAt) continue;
      await this.db
        .insert(userAchievements)
        .values({ userId, achievementId: jeu.id, unlockedAt })
        .onConflictDoUpdate({
          target: [userAchievements.userId, userAchievements.achievementId],
          set: { unlockedAt },
        });
    }

    const unlockedCount = jeux.filter((jeu) =>
      unlockedAtByApiName.has(jeu.apiName),
    ).length;
    await this.db
      .update(libraryEntries)
      .set({ achievementsUnlocked: unlockedCount })
      .where(
        and(
          eq(libraryEntries.userId, userId),
          eq(libraryEntries.gameId, gameId),
        ),
      );

    return jeux.map((jeu) => ({
      apiName: jeu.apiName,
      displayName: jeu.displayName,
      description: jeu.description,
      iconUrl: jeu.iconUrl,
      unlockedAt: unlockedAtByApiName.get(jeu.apiName) ?? null,
    }));
  }

  /** Récupère la fiche des succès d'un jeu (`GetSchemaForGame`). */
  private async fetchSchema(appId: number): Promise<Array<{
    apiName: string;
    displayName: string;
    description?: string;
    iconUrl?: string;
  }>> {
    const key = this.apiKey();
    const url = STEAM_STAT_URL(
      'ISteamUserStats/GetSchemaForGame/v2',
      new URLSearchParams({ key, appid: String(appId), l: 'french' }),
    );

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`GetSchemaForGame a répondu ${response.status}`);
        return [];
      }
      const body = (await response.json()) as GetSchemaForGameResponse;
      return (body.game?.availableGameStats?.achievements ?? [])
        .map((a) => ({
          apiName: a.name ?? '',
          displayName: a.displayName ?? '',
          description: a.description,
          iconUrl: a.icon,
        }))
        .filter((a) => a.apiName && a.displayName);
    } catch (error) {
      this.logger.warn(
        `GetSchemaForGame ${appId} injoignable: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return [];
    }
  }

  /** Déblocages du joueur (`GetPlayerAchievements`). Jamais d'exception. */
  private async fetchPlayerStats(
    steamId: string,
    appId: number,
  ): Promise<Array<{ apiName?: string; achieved?: number; unlocktime?: number }>> {
    let key: string;
    try {
      key = this.apiKey();
    } catch {
      return [];
    }
    const url = STEAM_STAT_URL(
      'ISteamUserStats/GetPlayerAchievements/v1',
      new URLSearchParams({ key, steamid: steamId, appid: String(appId), l: 'french' }),
    );

    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`GetPlayerAchievements a répondu ${response.status}`);
        return [];
      }
      const body = (await response.json()) as GetPlayerAchievementsResponse;
      // `success: false` → profil privé ou jeu sans succès : à traiter comme vide.
      if (!body.playerstats?.success) return [];
      // Steam renvoie `apiname` : on normalise vers `apiName` pour le reste du
      // service.
      return (body.playerstats.achievements ?? []).map((raw) => ({
        apiName: raw.apiname,
        achieved: raw.achieved,
        unlocktime: raw.unlocktime,
      }));
    } catch (error) {
      this.logger.warn(
        `GetPlayerAchievements ${appId} injoignable: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return [];
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