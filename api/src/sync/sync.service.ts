import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, desc, eq, isNotNull, isNull, lt, or, sql } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { games, libraryEntries, syncJobs, users } from '../db/schema.js';
import { AchievementsService } from '../achievements/achievements.service.js';
import { QuotaReachedError } from '../embedding/rate-limiter.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { FILTERS_VERSION, GamesService } from '../games/games.service.js';
import {
  LibraryService,
  type BibliothequeGame,
} from '../library/library.service.js';
import { UsersService } from '../users/users.service.js';

const DEFAULT_APPDETAILS_THROTTLE_MS = 300;
const DEFAULT_ACHIEVEMENTS_THROTTLE_MS = 200;
/** Plafond de jeux traités pour les succès lors d'une synchronisation. */
const DEFAULT_ACHIEVEMENTS_MAX_GAMES = 200;

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
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNotNull(games.detailsFetchedAt),
          or(
            isNull(games.achievementsFetchedAt),
            isNull(libraryEntries.achievementsFetchedAt),
            and(
              isNotNull(libraryEntries.lastPlayedAt),
              lt(
                libraryEntries.achievementsFetchedAt,
                libraryEntries.lastPlayedAt,
              ),
            ),
          ),
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
      const jeux = await this.library.ownedGames(user.steamId);
      await this.syncLibrary(job.id, job.userId, jeux);
      await this.stepDetails(job.id, job.userId);
      await this.stepAchievements(job.id, job.userId, user.steamId);
      await this.stepEmbeddings(job.id, job.userId);

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
    for (const jeu of jeux) {
      const gameId = await this.games.upsertBasic(jeu.appId, jeu.name);
      await this.db
        .insert(libraryEntries)
        .values({
          userId,
          gameId,
          playtimeForever: jeu.playtimeForever,
          playtimeLast2Weeks: jeu.playtimeLast2Weeks,
          lastPlayedAt: jeu.lastPlayedAt,
        })
        .onConflictDoUpdate({
          target: [libraryEntries.userId, libraryEntries.gameId],
          set: {
            playtimeForever: jeu.playtimeForever,
            playtimeLast2Weeks: jeu.playtimeLast2Weeks,
            lastPlayedAt: jeu.lastPlayedAt,
          },
        });
    }
    await this.setProgress(jobId, 'details', {
      processedGames: jeux.length,
    });
  }

  /**
   * Étape 2 : récupère les fiches `appdetails` manquantes, ainsi que celles
   * dont le mapping est antérieur à `FILTERS_VERSION` (backfill des ids).
   *
   * La progression porte sur le nombre de fiches réellement à traiter, et non
   * sur la taille de la bibliothèque : la barre ne recule plus entre les étapes.
   */
  private async stepDetails(jobId: number, userId: number): Promise<void> {
    const jeuxSansFiche = await this.appIdsSansDetails(userId);
    this.logger.log(
      `Étape fiches : ${jeuxSansFiche.length} fiche(s) à traiter`,
    );
    const throttleMs =
      this.config.get<number>('APPDETAILS_THROTTLE_MS') ??
      DEFAULT_APPDETAILS_THROTTLE_MS;

    await this.setProgress(jobId, 'details', {
      totalGames: jeuxSansFiche.length,
      processedGames: 0,
    });

    let processed = 0;
    for (const appId of jeuxSansFiche) {
      if (processed > 0 && throttleMs > 0) {
        await sleep(throttleMs);
      }
      const details = await this.games.fetchAppDetails(appId);
      if (details) {
        await this.games.upsertFromDetails(details);
      }
      processed += 1;
      await this.setProgress(jobId, 'details', {
        totalGames: jeuxSansFiche.length,
        processedGames: processed,
      });
    }
  }

  /**
   * Étape 3 : précharge les compteurs de succès pour la bibliothèque.
   *
   * Le schéma Steam est global (une fois par jeu) et les déblocages sont
   * propres au joueur. On traite au plus `ACHIEVEMENTS_MAX_GAMES_PER_SYNC`
   * jeux par synchronisation, en priorisant les jeux récemment lancés : les
   * suivants seront repris à la prochaine synchronisation. Les jeux jamais
   * lancés n'appellent pas `GetPlayerAchievements`.
   */
  private async stepAchievements(
    jobId: number,
    userId: number,
    steamId: string,
  ): Promise<void> {
    const max =
      this.config.get<number>('ACHIEVEMENTS_MAX_GAMES_PER_SYNC') ??
      DEFAULT_ACHIEVEMENTS_MAX_GAMES;
    const rows = await this.db
      .select({
        gameId: games.id,
        appId: games.appId,
      })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNotNull(games.detailsFetchedAt),
          or(
            isNull(games.achievementsFetchedAt),
            isNull(libraryEntries.achievementsFetchedAt),
            and(
              isNotNull(libraryEntries.lastPlayedAt),
              lt(
                libraryEntries.achievementsFetchedAt,
                libraryEntries.lastPlayedAt,
              ),
            ),
          ),
        ),
      )
      .orderBy(
        sql`${libraryEntries.lastPlayedAt} DESC NULLS LAST`,
        desc(libraryEntries.playtimeForever),
        games.name,
      )
      .limit(max);

    this.logger.log(
      `Étape succès : ${rows.length} jeu(x) à traiter (plafond ${max})`,
    );

    await this.setProgress(jobId, 'achievements', {
      totalGames: rows.length,
      processedGames: 0,
    });

    const throttleMs =
      this.config.get<number>('ACHIEVEMENTS_THROTTLE_MS') ??
      DEFAULT_ACHIEVEMENTS_THROTTLE_MS;
    let processed = 0;

    for (const row of rows) {
      if (processed > 0 && throttleMs > 0) {
        await sleep(throttleMs);
      }
      try {
        await this.achievements.refreshForSync(
          steamId,
          userId,
          row.gameId,
          row.appId,
        );
      } catch (error) {
        // Un jeu en échec ne doit pas bloquer les autres. Le marqueur de
        // récupération n'est pas avancé, donc une prochaine sync retentera.
        this.logger.warn(
          `Succès ${row.appId} indisponibles: ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      }
      processed += 1;
      await this.setProgress(jobId, 'achievements', {
        totalGames: rows.length,
        processedGames: processed,
      });
    }
  }

  /** Étape 4 : génère et persiste les embeddings manquants. */
  private async stepEmbeddings(jobId: number, userId: number): Promise<void> {
    const appIds = await this.appIdsSansEmbedding(userId);
    this.logger.log(`Étape embeddings : ${appIds.length} jeu(x)`);

    await this.setProgress(jobId, 'embeddings', {
      totalGames: appIds.length,
      processedGames: 0,
    });

    let processed = 0;
    for (const appId of appIds) {
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
      }
      processed += 1;
      await this.setProgress(jobId, 'embeddings', {
        totalGames: appIds.length,
        processedGames: processed,
      });
    }
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
