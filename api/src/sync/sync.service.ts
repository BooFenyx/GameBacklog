import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, isNull } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { games, libraryEntries, syncJobs, users } from '../db/schema.js';
import { QuotaReachedError } from '../embedding/rate-limiter.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { GamesService } from '../games/games.service.js';
import { LibraryService, type BibliothequeGame } from '../library/library.service.js';
import { UsersService } from '../users/users.service.js';

const DEFAULT_APPDETAILS_THROTTLE_MS = 300;

/** État d'un job renvoyé au front (suivi de progression). */
export interface SyncJobResponse {
  id: number;
  status: 'pending' | 'running' | 'done' | 'error';
  step: 'library' | 'details' | 'embeddings' | 'done';
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
  step: 'library' | 'details' | 'embeddings' | 'done';
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
   */
  async enqueue(userId: number): Promise<SyncJobResponse> {
    const job = await this.upsertJob(userId);
    // Traitement hors du cycle de requête : le front suivra via GET /api/sync.
    void this.drain();
    return this.toResponse(job);
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

  /** Déroule les trois étapes. Aucune suppression nulle part. */
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
      await this.stepDetails(job.id, job.userId, jeux.length);
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

  /** Étape 2 : récupère les fiches `appdetails` manquantes. */
  private async stepDetails(
    jobId: number,
    userId: number,
    totalGames: number,
  ): Promise<void> {
    const jeuxSansFiche = await this.appIdsForUser(userId, true);
    this.logger.log(
      `Étape fiches : ${jeuxSansFiche.length} fiche(s) manquante(s)`,
    );
    const throttleMs =
      this.config.get<number>('APPDETAILS_THROTTLE_MS') ??
      DEFAULT_APPDETAILS_THROTTLE_MS;

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
        totalGames,
        processedGames: processed,
      });
    }
  }

  /** Étape 3 : génère et persiste les embeddings manquants. */
  private async stepEmbeddings(jobId: number, userId: number): Promise<void> {
    const appIds = await this.appIdsForUser(userId, false);
    this.logger.log(`Étape embeddings : ${appIds.length} jeu(x)`);

    let processed = 0;
    for (const appId of appIds) {
      const input = await this.games.embeddingInputFor(appId);
      if (!input) {
        processed += 1;
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
        processedGames: processed,
      });
    }
  }

  /** Liste des `appId` de la bibliothèque, sans fiche ou sans embedding. */
  private async appIdsForUser(
    userId: number,
    ficheManquante: boolean,
  ): Promise<number[]> {
    const rows = await this.db
      .select({ appId: games.appId })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          ficheManquante
            ? isNull(games.detailsFetchedAt)
            : isNull(games.embedding),
        ),
      );
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