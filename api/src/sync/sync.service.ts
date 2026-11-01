import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  desc,
  eq,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  notInArray,
  or,
  sql,
} from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import {
  achievements,
  games,
  libraryEntries,
  syncJobs,
  userAchievements,
  users,
} from '../db/schema.js';
import {
  AchievementsService,
  SteamRateLimitError,
} from '../achievements/achievements.service.js';
import { QuotaReachedError } from '../embedding/rate-limiter.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { FILTERS_VERSION, GamesService } from '../games/games.service.js';
import {
  LibraryService,
  type BibliothequeGame,
} from '../library/library.service.js';
import { UsersService } from '../users/users.service.js';
import { deriverActivite, normaliserDernierSucces } from './activite.js';
import { traiterSuccesParLots } from './achievements-batch.js';

const DEFAULT_APPDETAILS_THROTTLE_MS = 1500;
const DEFAULT_ACHIEVEMENTS_THROTTLE_MS = 200;
/** Trois 429 consécutifs : la passe s'arrête pour ne pas marteler Steam. */
const MAX_429_CONSECUTIFS = 3;
/** Attente maximale imposée par un `Retry-After` pendant une passe. */
const MAX_ATTENTE_429_MS = 5 * 60 * 1000;
/** Délais avant de retenter une fiche en échec. */
const RETRY_FICHE_RESEAU_MS = 5 * 60 * 1000;
const RETRY_FICHE_DELISTEE_MS = 24 * 60 * 60 * 1000;
const RETRY_FICHE_DELISTEE_LONG_MS = 30 * 24 * 60 * 60 * 1000;
/** Nombre d'échecs « délisté » avant de considérer la fiche indisponible. */
const SEUIL_FICHE_DELISTEE = 3;
/** Taille d'un lot de succès : borne une requête, pas le total de la passe. */
const DEFAULT_ACHIEVEMENTS_BATCH_SIZE = 200;
/**
 * Ancien plafond total, déprécié. `0` (défaut) signifie « aucun plafond » ;
 * une valeur > 0 reste possible comme garde-fou explicite.
 */
const DEFAULT_ACHIEVEMENTS_MAX_GAMES = 0;
/** Budget d'une passe d'étape : au-delà, le job est mis en pause et repris. */
const DEFAULT_SYNC_STEP_MAX_MS = 900_000;

/** Résultat d'une étape : budget atteint et progrès réalisé. */
interface ResultatEtape {
  paused: boolean;
  progressed: boolean;
}

/** État d'un job renvoyé au front (suivi de progression). */
export interface SyncJobResponse {
  id: number;
  status: 'pending' | 'running' | 'done' | 'error';
  step: 'library' | 'details' | 'achievements' | 'embeddings' | 'done';
  totalGames: number;
  processedGames: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
}

/** Ligne `sync_jobs` telle que lue en base. */
type SyncJobRow = {
  id: number;
  userId: number;
  status: 'pending' | 'running' | 'done' | 'error';
  step: 'library' | 'details' | 'achievements' | 'embeddings' | 'done';
  totalGames: number;
  processedGames: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

@Injectable()
export class SyncService implements OnModuleInit {
  private readonly logger = new Logger(SyncService.name);
  /** Verrou en mémoire : un seul job traité à la fois dans ce process. */
  private running = false;
  /** Reboucle s'il reste un job en file à la fin du tour. */
  private rerun = false;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly library: LibraryService,
    private readonly games: GamesService,
    private readonly achievements: AchievementsService,
    private readonly embedding: EmbeddingService,
    private readonly users: UsersService,
  ) {}

  /**
   * Reprise au démarrage : un job interrompu par un redémarrage est resté en
   * `running` dans la base. On le remet en file (`pending`) puis on relance la
   * boucle : les étapes déjà terminées sont sautées (upserts idempotents).
   */
  async onModuleInit(): Promise<void> {
    const result = await this.db.$client.query(
      `UPDATE sync_jobs
       SET status = $1, started_at = NULL
       WHERE status = $2`,
      ['pending', 'running'],
    );
    if ((result.rowCount ?? 0) > 0) {
      this.logger.log(
        `${result.rowCount} job(s) interrompu(s) remis en file au démarrage`,
      );
    }
    void this.drain();
  }

  /**
   * Crée/réactive le job de l'utilisateur (une ligne par utilisateur, upsert)
   * puis lance le traitement en tâche de fond, sans bloquer la réponse HTTP.
   *
   * Si un job est déjà en file ou en cours, il est renvoyé tel quel : relancer
   * l'import ne doit pas remettre sa progression à zéro.
   */
  async enqueue(userId: number): Promise<SyncJobResponse> {
    const [existant] = await this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .limit(1);

    if (
      existant &&
      (existant.status === 'pending' || existant.status === 'running')
    ) {
      return this.toResponse(existant as SyncJobRow);
    }

    const job = await this.upsertJob(userId);
    // Traitement hors du cycle de requête : le front suivra via GET /api/sync.
    void this.drain();
    return this.toResponse(job);
  }

  /**
   * Indique si au moins un jeu de l'utilisateur a une fiche déjà récupérée mais
   * pas encore remappée (`filters_version`). Sert à relancer un import après
   * l'ajout d'un champ dérivé de `appdetails`, même si le dernier import est
   * terminé.
   *
   * Les fiches jamais récupérées (`details_fetched_at IS NULL`) sont exclues :
   * les inclure relancerait un import à chaque connexion pour un jeu retiré du
   * Store, sans jamais pouvoir aboutir. Un `Synchroniser` manuel les retente.
   */
  async needsFilters(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNotNull(games.detailsFetchedAt),
          lt(games.filtersVersion, FILTERS_VERSION),
        ),
      );
    return Number(row?.count ?? 0) > 0;
  }

  /**
   * Indique s'il reste des jeux dont le schéma de succès ou la progression du
   * joueur n'a pas encore été récupéré. Sert à relancer la synchronisation au
   * login, sans dépendre de l'ouverture d'une fiche.
   */
  async needsAchievements(userId: number): Promise<boolean> {
    return (await this.compterSuccesManquants(userId)) > 0;
  }

  /**
   * Conditions SQL des jeux dont les compteurs de succès manquent. Partagées
   * par `needsAchievements`, le comptage et la sélection des lots.
   */
  private conditionsSuccesManquants(userId: number) {
    return and(
      eq(libraryEntries.userId, userId),
      isNotNull(games.detailsFetchedAt),
      or(
        isNull(games.achievementsFetchedAt),
        isNull(libraryEntries.achievementsFetchedAt),
        and(
          eq(libraryEntries.lastActivitySource, 'sync_delta'),
          isNotNull(libraryEntries.lastActivityAt),
          lt(
            libraryEntries.achievementsFetchedAt,
            libraryEntries.lastActivityAt,
          ),
        ),
      ),
    );
  }

  /** Nombre de jeux à traiter pour les succès au début d'une passe. */
  private async compterSuccesManquants(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(this.conditionsSuccesManquants(userId));
    return Number(row?.count ?? 0);
  }

  /**
   * Sélectionne un lot de jeux manquants, en excluant ceux déjà tentés dans le
   * run courant (`notInArray`) pour ne pas boucler sur un échec.
   */
  private async selectionnerSuccesManquants(
    userId: number,
    dejaTentes: number[],
    limite: number,
  ): Promise<Array<{ gameId: number; appId: number }>> {
    return this.db
      .select({
        gameId: games.id,
        appId: games.appId,
      })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          this.conditionsSuccesManquants(userId),
          dejaTentes.length > 0
            ? notInArray(games.id, dejaTentes)
            : undefined,
        ),
      )
      .orderBy(
        sql`${libraryEntries.lastActivityAt} DESC NULLS LAST`,
        desc(libraryEntries.playtimeForever),
        games.name,
      )
      .limit(limite);
  }

  /**
   * Vrai si au moins une entrée n'a jamais été vue par une sync terminée.
   * Déclenche la première re-synchronisation après déploiement : elle remplit
   * `last_seen_at` (et dérive l'activité), puis la condition redevient fausse.
   */
  async needsLibraryActivity(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNull(libraryEntries.lastSeenAt),
        ),
      );
    return Number(row?.count ?? 0) > 0;
  }

  /** Renvoie le job courant de l'utilisateur (null si jamais importé). */
  async currentJob(userId: number): Promise<SyncJobResponse | null> {
    const [job] = await this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .limit(1);
    return job ? this.toResponse(job as SyncJobRow) : null;
  }

  /**
   * Boucle de traitement : exécute le premier job `pending`, puis, s'il reste
   * des jobs en file, enchaîne. Idempotent : les upserts reprennent en l'état.
   */
  private async drain(): Promise<void> {
    if (this.running) {
      this.rerun = true;
      return;
    }
    this.running = true;
    try {
      do {
        this.rerun = false;
        const [job] = await this.db
          .select()
          .from(syncJobs)
          .where(eq(syncJobs.status, 'pending'))
          .orderBy(syncJobs.id)
          .limit(1);
        if (job) {
          await this.processJob(job as SyncJobRow);
        }
      } while (this.rerun);
    } catch (error) {
      this.logger.error(
        `Erreur de la boucle de sync: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
    } finally {
      this.running = false;
    }
  }

  private async upsertJob(userId: number): Promise<SyncJobRow> {
    const rows = await this.db
      .insert(syncJobs)
      .values({ userId, status: 'pending', step: 'library', error: null })
      .onConflictDoUpdate({
        target: syncJobs.userId,
        set: {
          status: 'pending',
          step: 'library',
          totalGames: 0,
          processedGames: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      })
      .returning();
    return rows[0] as SyncJobRow;
  }

  /** Déroule les quatre étapes. Aucune suppression nulle part. */
  private async processJob(job: SyncJobRow): Promise<void> {
    const [user] = await this.db
      .select({ steamId: users.steamId })
      .from(users)
      .where(eq(users.id, job.userId))
      .limit(1);
    if (!user) {
      throw new NotFoundException('Utilisateur inconnu');
    }

    await this.markRunning(job.id);
    try {
      // Un job repris repart de son étape courante ; les étapes terminées sont
      // sautées. `done` + `pending` est un état anormal : on répare depuis le
      // début.
      let etape = job.step === 'done' ? 'library' : job.step;

      if (etape === 'library') {
        const jeux = await this.library.ownedGames(user.steamId);
        await this.syncLibrary(job.id, job.userId, jeux);
        etape = 'details';
      }

      if (etape === 'details') {
        const resultat = await this.stepDetails(job.id, job.userId);
        if (resultat.paused) {
          await this.pauseJob(job.id, 'details');
          return;
        }
        etape = 'achievements';
      }

      if (etape === 'achievements') {
        const resultat = await this.stepAchievements(
          job.id,
          job.userId,
          user.steamId,
        );
        if (resultat.paused) {
          await this.pauseJob(job.id, 'achievements');
          return;
        }
        etape = 'embeddings';
      }

      if (etape === 'embeddings') {
        const resultat = await this.stepEmbeddings(job.id, job.userId);
        if (resultat.paused) {
          await this.pauseJob(job.id, 'embeddings');
          return;
        }
      }

      await this.finish(job.id, 'done', 'done', null, new Date());
      await this.users.setStatus(job.userId, 'done', {
        lastSyncAt: new Date(),
      });
    } catch (error) {
      const message =
        error instanceof QuotaReachedError
          ? 'quota-embedding-atteint'
          : error instanceof Error
            ? error.message.slice(0, 500)
            : 'erreur inconnue';
      this.logger.warn(`Sync interrompue: ${message}`);
      // L'étape en cours est relue depuis la base (la progression en mémoire
      // n'est pas fiable en cas d'échec).
      const [fraiche] = await this.db
        .select({ step: syncJobs.step })
        .from(syncJobs)
        .where(eq(syncJobs.id, job.id))
        .limit(1);
      await this.finish(
        job.id,
        'error',
        fraiche?.step ?? 'library',
        message,
        new Date(),
      );
      await this.users.setStatus(job.userId, 'error');
    }
  }

  /** Étape 1 : persiste `library_entries` depuis `GetOwnedGames` (upserts). */
  private async syncLibrary(
    jobId: number,
    userId: number,
    jeux: BibliothequeGame[],
  ): Promise<void> {
    await this.setProgress(jobId, 'library', {
      totalGames: jeux.length,
      processedGames: 0,
    });

    const maintenant = new Date();

    // Les précédents sont lus **avant** la boucle : comparer le temps de jeu à
    // une sync datée est la seule façon de détecter une partie entre deux
    // imports. `last_seen_at` est ensuite écrit après la boucle.
    const precedents = await this.db
      .select({
        gameId: libraryEntries.gameId,
        playtimeForever: libraryEntries.playtimeForever,
        lastActivityAt: libraryEntries.lastActivityAt,
        lastActivitySource: libraryEntries.lastActivitySource,
        lastActivityPrecision: libraryEntries.lastActivityPrecision,
        lastSeenAt: libraryEntries.lastSeenAt,
      })
      .from(libraryEntries)
      .where(eq(libraryEntries.userId, userId));
    const parJeu = new Map(precedents.map((p) => [p.gameId, p]));

    // Dernier succès par jeu, en une seule requête : il sert de borne basse.
    const succes = await this.db
      .select({
        gameId: achievements.gameId,
        dernier: max(userAchievements.unlockedAt),
      })
      .from(userAchievements)
      .innerJoin(
        achievements,
        eq(userAchievements.achievementId, achievements.id),
      )
      .where(eq(userAchievements.userId, userId))
      .groupBy(achievements.gameId);
    const succesParJeu = new Map(
      succes.map((s) => [s.gameId, normaliserDernierSucces(s.dernier)]),
    );

    for (const jeu of jeux) {
      const gameId = await this.games.upsertBasic(jeu.appId, jeu.name);
      const precedent = parJeu.get(gameId) ?? null;
      const activite = deriverActivite(
        {
          playtimeForever: jeu.playtimeForever,
          playtime2Weeks: jeu.playtimeLast2Weeks,
        },
        precedent,
        succesParJeu.get(gameId) ?? null,
        maintenant,
      );

      const valeurs = {
        userId,
        gameId,
        playtimeForever: jeu.playtimeForever,
        playtimeLast2Weeks: jeu.playtimeLast2Weeks,
        lastSeenAt: maintenant,
        ...(activite
          ? {
              lastActivityAt: activite.at,
              lastActivitySource: activite.source,
              lastActivityPrecision: activite.precision,
            }
          : {}),
      };

      const miseAJour = {
        playtimeForever: jeu.playtimeForever,
        playtimeLast2Weeks: jeu.playtimeLast2Weeks,
        ...(activite
          ? {
              lastActivityAt: activite.at,
              lastActivitySource: activite.source,
              lastActivityPrecision: activite.precision,
            }
          : {}),
      };

      await this.db
        .insert(libraryEntries)
        .values(valeurs)
        .onConflictDoUpdate({
          target: [libraryEntries.userId, libraryEntries.gameId],
          set: miseAJour,
        });
    }
    await this.setProgress(jobId, 'details', {
      processedGames: jeux.length,
    });

    // Couvre les entrées qui ne sont plus dans la réponse Steam : la prochaine
    // sync a un point de départ même pour un jeu retiré de la bibliothèque.
    await this.db
      .update(libraryEntries)
      .set({ lastSeenAt: maintenant })
      .where(eq(libraryEntries.userId, userId));
  }

  /**
   * Étape 2 : récupère les fiches `appdetails` manquantes, ainsi que celles
   * dont le mapping est antérieur à `FILTERS_VERSION` (backfill des ids).
   *
   * La progression porte sur le nombre de fiches réellement à traiter, et non
   * sur la taille de la bibliothèque : la barre ne recule plus entre les étapes.
   */
  private async stepDetails(
    jobId: number,
    userId: number,
  ): Promise<ResultatEtape> {
    const jeuxSansFiche = await this.appIdsSansDetails(userId);
    const total = jeuxSansFiche.length;
    this.logger.log(`Étape fiches : ${total} fiche(s) à traiter`);

    await this.setProgress(jobId, 'details', {
      totalGames: total,
      processedGames: 0,
    });

    const throttleMs = this.lireEntier(
      'APPDETAILS_THROTTLE_MS',
      DEFAULT_APPDETAILS_THROTTLE_MS,
      0,
      60_000,
    );
    const deadline = this.creerDeadline();
    let processed = 0;
    let progressed = false;
    let limitesConsecutives = 0;

    for (const appId of jeuxSansFiche) {
      // Budget vérifié entre deux jeux, jamais au milieu d'un appel HTTP.
      if (this.budgetDepasse(deadline)) {
        return { paused: progressed, progressed };
      }
      if (processed > 0 && throttleMs > 0) {
        await sleep(throttleMs);
      }
      const resultat = await this.tenterFiche(appId);
      processed += 1;
      if (resultat === 'ok' || resultat === 'removed') {
        progressed = true;
      }
      limitesConsecutives =
        resultat === 'rate-limit' ? limitesConsecutives + 1 : 0;
      await this.setProgress(jobId, 'details', {
        totalGames: total,
        processedGames: processed,
      });
      if (limitesConsecutives >= MAX_429_CONSECUTIFS) {
        this.logger.warn(
          `Étape fiches : ${MAX_429_CONSECUTIFS} 429 consécutifs, pause de la passe`,
        );
        return { paused: progressed, progressed };
      }
    }
    return { paused: false, progressed };
  }

  /**
   * Tente une fiche, avec un second essai sur 429 (après `Retry-After` ou
   * backoff). Enregistre la cause d'échec pour la prochaine synchronisation.
   */
  private async tenterFiche(
    appId: number,
  ): Promise<'ok' | 'removed' | 'network' | 'rate-limit'> {
    let tentative = 0;
    for (;;) {
      const resultat = await this.games.fetchAppDetails(appId, tentative);
      if (resultat.kind === 'ok') {
        await this.games.upsertFromDetails(resultat.details);
        return 'ok';
      }
      if (resultat.kind === 'removed') {
        await this.enregistrerEchecFiche(appId, 'removed');
        return 'removed';
      }
      if (resultat.kind === 'network') {
        await this.enregistrerEchecFiche(appId, 'network');
        return 'network';
      }
      if (tentative === 0) {
        await sleep(Math.min(resultat.retryAfterMs, MAX_ATTENTE_429_MS));
        tentative = 1;
        continue;
      }
      await this.enregistrerEchecFiche(appId, 'rate-limit', resultat.retryAfterMs);
      return 'rate-limit';
    }
  }

  /**
   * Cache négatif d'une fiche : seuls les jeux délistés incrémentent
   * `details_attempts` (un 429 ou un timeout réseau ne sont pas permanents).
   */
  private async enregistrerEchecFiche(
    appId: number,
    cause: 'removed' | 'network' | 'rate-limit',
    retryAfterMs = 0,
  ): Promise<void> {
    const maintenant = Date.now();

    if (cause === 'removed') {
      const [row] = await this.db
        .select({ attempts: games.detailsAttempts })
        .from(games)
        .where(eq(games.appId, appId))
        .limit(1);
      const attempts = (row?.attempts ?? 0) + 1;
      const delai =
        attempts >= SEUIL_FICHE_DELISTEE
          ? RETRY_FICHE_DELISTEE_LONG_MS
          : RETRY_FICHE_DELISTEE_MS;
      await this.db
        .update(games)
        .set({
          detailsAttempts: attempts,
          detailsNextRetryAt: new Date(maintenant + delai),
          detailsLastError: 'removed',
        })
        .where(eq(games.appId, appId));
      return;
    }

    const delai =
      cause === 'network'
        ? RETRY_FICHE_RESEAU_MS
        : Math.max(0, retryAfterMs);
    await this.db
      .update(games)
      .set({
        detailsNextRetryAt: new Date(maintenant + delai),
        detailsLastError: cause,
      })
      .where(eq(games.appId, appId));
  }

  /**
   * Étape 3 : précharge les compteurs de succès pour la bibliothèque.
   *
   * Le schéma Steam est global (une fois par jeu) et les déblocages sont
   * propres au joueur. Les jeux manquants sont traités par lots de
   * `ACHIEVEMENTS_BATCH_SIZE`, jusqu'à épuisement : il n'y a plus de plafond
   * total. Les lots suivants excluent les jeux déjà tentés, pour ne pas boucler
   * sur un échec. Les jeux jamais lancés n'appellent pas `GetPlayerAchievements`.
   */
  private async stepAchievements(
    jobId: number,
    userId: number,
    steamId: string,
  ): Promise<ResultatEtape> {
    const batchSize = this.lireEntier(
      'ACHIEVEMENTS_BATCH_SIZE',
      DEFAULT_ACHIEVEMENTS_BATCH_SIZE,
      1,
      1000,
    );
    const maxTotal = this.lireEntier(
      'ACHIEVEMENTS_MAX_GAMES_PER_SYNC',
      DEFAULT_ACHIEVEMENTS_MAX_GAMES,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    const manquants = await this.compterSuccesManquants(userId);
    const total =
      maxTotal > 0 ? Math.min(manquants, maxTotal) : manquants;

    this.logger.log(
      `Étape succès : ${total} jeu(x) à traiter (lots de ${batchSize})`,
    );

    await this.setProgress(jobId, 'achievements', {
      totalGames: total,
      processedGames: 0,
    });

    const throttleMs = this.lireEntier(
      'ACHIEVEMENTS_THROTTLE_MS',
      DEFAULT_ACHIEVEMENTS_THROTTLE_MS,
      0,
      60_000,
    );
    const deadline = this.creerDeadline();
    let dejaTraite = false;
    let limitesConsecutives = 0;
    let limiteAtteinte = false;

    const resultat = await traiterSuccesParLots({
      total,
      batchSize,
      selectionner: (dejaTentes, limite) =>
        this.selectionnerSuccesManquants(userId, dejaTentes, limite),
      traiter: async (row) => {
        if (dejaTraite && throttleMs > 0) {
          await sleep(throttleMs);
        }
        dejaTraite = true;
        try {
          await this.achievements.refreshForSync(
            steamId,
            userId,
            row.gameId,
            row.appId,
          );
          limitesConsecutives = 0;
        } catch (error) {
          if (error instanceof SteamRateLimitError) {
            limitesConsecutives += 1;
            if (limitesConsecutives >= MAX_429_CONSECUTIFS) {
              limiteAtteinte = true;
              this.logger.warn(
                `Étape succès : ${MAX_429_CONSECUTIFS} 429 consécutifs, pause de la passe`,
              );
            }
          } else {
            limitesConsecutives = 0;
          }
          throw error;
        }
      },
      onProgression: (processed) =>
        this.setProgress(jobId, 'achievements', {
          totalGames: total,
          processedGames: processed,
        }),
      onEchec: (row, error) => {
        // Un jeu en échec ne doit pas bloquer les autres. Le marqueur de
        // récupération n'est pas avancé, donc une prochaine sync retentera.
        this.logger.warn(
          `Succès ${row.appId} indisponibles: ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      },
      doitPause: () =>
        limiteAtteinte || this.budgetDepasse(deadline),
    });

    await this.marquerActiviteSucces(userId);

    return {
      paused: resultat.paused,
      progressed: resultat.reussis > 0,
    };
  }

  /**
   * Remplit l'activité des jeux qui n'en ont aucune avec la date du dernier
   * succès (borne basse). Ne remplace jamais `sync_delta` ni `recent_window`.
   *
   * `unlocked_at` est un `timestamp` sans fuseau qui stocke un mur UTC, et la
   * cible est `timestamptz` : `AT TIME ZONE 'UTC'` est indispensable.
   */
  private async marquerActiviteSucces(userId: number): Promise<void> {
    await this.db.$client.query(
      `UPDATE library_entries le
       SET last_activity_at = a.dernier AT TIME ZONE 'UTC',
           last_activity_source = 'achievement',
           last_activity_precision = 'lower_bound'
       FROM (
         SELECT ach.game_id, MAX(ua.unlocked_at) AS dernier
         FROM user_achievements ua
         JOIN achievements ach ON ach.id = ua.achievement_id
         WHERE ua.user_id = $1
         GROUP BY ach.game_id
       ) a
       WHERE le.user_id = $1
         AND le.game_id = a.game_id
         AND le.last_activity_at IS NULL`,
      [userId],
    );
  }

  /** Étape 4 : génère et persiste les embeddings manquants. */
  private async stepEmbeddings(
    jobId: number,
    userId: number,
  ): Promise<ResultatEtape> {
    const appIds = await this.appIdsSansEmbedding(userId);
    this.logger.log(`Étape embeddings : ${appIds.length} jeu(x)`);

    await this.setProgress(jobId, 'embeddings', {
      totalGames: appIds.length,
      processedGames: 0,
    });

    const deadline = this.creerDeadline();
    let processed = 0;
    let progressed = false;
    for (const appId of appIds) {
      if (this.budgetDepasse(deadline)) {
        return { paused: progressed, progressed };
      }
      const input = await this.games.embeddingInputFor(appId);
      if (!input) {
        processed += 1;
        await this.setProgress(jobId, 'embeddings', {
          totalGames: appIds.length,
          processedGames: processed,
        });
        continue;
      }
      const embedding = await this.embedding.embedGame(input);
      if (embedding) {
        await this.db
          .update(games)
          .set({
            embedding,
            embeddingModel: this.embedding.modelName,
          })
          .where(eq(games.appId, appId));
        progressed = true;
      }
      processed += 1;
      await this.setProgress(jobId, 'embeddings', {
        totalGames: appIds.length,
        processedGames: processed,
      });
    }
    return { paused: false, progressed };
  }

  /** `appId` de la bibliothèque dont la fiche manque ou est à remapper. */
  private async appIdsSansDetails(userId: number): Promise<number[]> {
    const rows = await this.db
      .select({ appId: games.appId })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          or(
            isNull(games.detailsFetchedAt),
            lt(games.filtersVersion, FILTERS_VERSION),
          ),
          or(
            isNull(games.detailsNextRetryAt),
            lte(games.detailsNextRetryAt, new Date()),
          ),
        ),
      );
    return rows.map((row) => row.appId);
  }

  /** `appId` de la bibliothèque dont l'embedding manque. */
  private async appIdsSansEmbedding(userId: number): Promise<number[]> {
    const rows = await this.db
      .select({ appId: games.appId })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(and(eq(libraryEntries.userId, userId), isNull(games.embedding)));
    return rows.map((row) => row.appId);
  }

  /**
   * Lit un entier de configuration. `ConfigService.get<number>()` renvoie en
   * réalité une chaîne : on convertit explicitement et on borne la valeur.
   */
  private lireEntier(
    cle: string,
    defaut: number,
    min: number,
    max: number,
  ): number {
    const brut = this.config.get<string | number>(cle);
    const valeur = brut === undefined || brut === '' ? defaut : Number(brut);
    if (!Number.isFinite(valeur)) return defaut;
    return Math.min(max, Math.max(min, Math.trunc(valeur)));
  }

  /** Budget d'une passe d'étape, ou `null` quand `SYNC_STEP_MAX_MS=0`. */
  private creerDeadline(): number | null {
    const budgetMs = this.lireEntier(
      'SYNC_STEP_MAX_MS',
      DEFAULT_SYNC_STEP_MAX_MS,
      0,
      Number.MAX_SAFE_INTEGER,
    );
    return budgetMs > 0 ? Date.now() + budgetMs : null;
  }

  private budgetDepasse(deadline: number | null): boolean {
    return deadline !== null && Date.now() >= deadline;
  }

  /**
   * Remet le job en file à l'étape courante, sans le terminer. `rerun` arme la
   * reprise immédiate par `drain` ; un redémarrage reprend aussi à `step`.
   */
  private async pauseJob(
    jobId: number,
    step: SyncJobRow['step'],
  ): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({ status: 'pending', step, finishedAt: null })
      .where(eq(syncJobs.id, jobId));
    this.rerun = true;
  }

  private async markRunning(jobId: number): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({ status: 'running', startedAt: new Date() })
      .where(eq(syncJobs.id, jobId));
  }

  private async setProgress(
    jobId: number,
    step: SyncJobRow['step'],
    fields: Partial<Pick<SyncJobResponse, 'totalGames' | 'processedGames'>>,
  ): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({ step, ...fields })
      .where(eq(syncJobs.id, jobId));
  }

  private async finish(
    jobId: number,
    status: 'done' | 'error',
    step: SyncJobRow['step'],
    error: string | null,
    finishedAt: Date,
  ): Promise<void> {
    await this.db
      .update(syncJobs)
      .set({ status, step, error, finishedAt })
      .where(eq(syncJobs.id, jobId));
  }

  private toResponse(job: SyncJobRow): SyncJobResponse {
    return {
      id: job.id,
      status: job.status,
      step: job.step,
      totalGames: job.totalGames,
      processedGames: job.processedGames,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
