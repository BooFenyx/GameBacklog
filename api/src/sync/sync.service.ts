import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  and,
  desc,
  eq,
  gt,
  gte,
  isNotNull,
  isNull,
  lt,
  lte,
  max,
  min,
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
import {
  QuotaReachedError,
  RateLimitService,
} from '../embedding/rate-limiter.service.js';
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
/** Trois échecs réseau consécutifs : la passe s'arrête au lieu de balayer tout. */
const MAX_ERREURS_RESEAU_CONSECUTIVES = 3;
/** Attente maximale imposée par un `Retry-After` pendant une passe. */
const MAX_ATTENTE_429_MS = 5 * 60 * 1000;
/** Délais avant de retenter une fiche en échec. */
const RETRY_FICHE_RESEAU_MS = 5 * 60 * 1000;
const RETRY_FICHE_DELISTEE_MS = 24 * 60 * 60 * 1000;
const RETRY_FICHE_DELISTEE_LONG_MS = 30 * 24 * 60 * 60 * 1000;
/** Délai minimal d'un 429 sans `Retry-After` exploitable (anti-boucle). */
const RETRY_429_MIN_MS = 5_000;
/** Plafond d'un `setTimeout` Node (2^31 - 1 ms) pour les reprises lointaines. */
const MAX_TIMEOUT_MS = 2_147_483_647;
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
  /** Fiches encore récupérables, y compris celles en attente de reprise. */
  pendingDetails: number;
  /** Jeux dont la fiche est considérée indisponible (3 échecs « délisté »). */
  detailsUnavailable: number;
  /** Jeux dont les compteurs de succès manquent. */
  pendingAchievements: number;
  /** Jeux indexables dont l'embedding manque. */
  pendingEmbeddings: number;
}

/** Compteurs de reliquat exposés par `GET /api/sync`. */
type CompteursImport = Pick<
  SyncJobResponse,
  | 'pendingDetails'
  | 'detailsUnavailable'
  | 'pendingAchievements'
  | 'pendingEmbeddings'
>;

const COMPTEURS_VIDES: CompteursImport = {
  pendingDetails: 0,
  detailsUnavailable: 0,
  pendingAchievements: 0,
  pendingEmbeddings: 0,
};

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
export class SyncService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SyncService.name);
  /** Verrou en mémoire : un seul job traité à la fois dans ce process. */
  private running = false;
  /** Reboucle s'il reste un job en file à la fin du tour. */
  private rerun = false;
  /**
   * Reprises automatiques programmées par utilisateur. La clé est l'id
   * utilisateur ; la valeur est le timer qui réenfilera l'import à l'échéance
   * de la prochaine fiche en backoff.
   */
  private readonly reprises = new Map<number, NodeJS.Timeout>();

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
    private readonly library: LibraryService,
    private readonly games: GamesService,
    private readonly achievements: AchievementsService,
    private readonly embedding: EmbeddingService,
    private readonly users: UsersService,
    private readonly rateLimit: RateLimitService,
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
    // Un redémarrage perd les timers en mémoire : on relit les échéances
    // persistées (`details_next_retry_at`) pour reprogrammer les reprises.
    await this.planifierToutesReprises();
    void this.drain();
  }

  onModuleDestroy(): void {
    for (const timer of this.reprises.values()) {
      clearTimeout(timer);
    }
    this.reprises.clear();
  }

  /**
   * Crée/réactive le job de l'utilisateur (une ligne par utilisateur, upsert)
   * puis lance le traitement en tâche de fond, sans bloquer la réponse HTTP.
   *
   * Si un job est déjà en file ou en cours, il est renvoyé tel quel : relancer
   * l'import ne doit pas remettre sa progression à zéro.
   */
  async enqueue(
    userId: number,
    options: { forcerFiches?: boolean } = {},
  ): Promise<SyncJobResponse> {
    // Une relance (login ou clic) remplace la reprise programmée : le job qui
    // va tourner reprogrammera l'échéance suivante à sa fin.
    this.annulerReprise(userId);

    if (options.forcerFiches) {
      await this.forcerRepriseFiches(userId);
    }

    const [existant] = await this.db
      .select()
      .from(syncJobs)
      .where(eq(syncJobs.userId, userId))
      .limit(1);

    if (
      existant &&
      (existant.status === 'pending' || existant.status === 'running')
    ) {
      // Un job pending peut être orphelin si la boucle a été interrompue :
      // on réarme `drain` même dans ce cas.
      void this.drain();
      return this.toResponse(existant as SyncJobRow);
    }

    const job = await this.upsertJob(userId);
    // Traitement hors du cycle de requête : le front suivra via GET /api/sync.
    void this.drain();
    return this.toResponse(job);
  }

  /**
   * Relance manuelle : ignore le backoff des fiches encore récupérables.
   * Les jeux à 3 échecs « délisté » restent en quarantaine ; les fiches déjà
   * récupérées mais à remapper sont également retentées.
   */
  private async forcerRepriseFiches(userId: number): Promise<void> {
    await this.db.$client.query(
      `UPDATE games g
       SET details_next_retry_at = NULL
       FROM library_entries le
       WHERE le.game_id = g.id
         AND le.user_id = $1
         AND g.details_attempts < $2
         AND (
           g.details_fetched_at IS NULL
           OR g.filters_version < $3
         )`,
      [userId, SEUIL_FICHE_DELISTEE, FILTERS_VERSION],
    );
  }

  /** Annule la reprise programmée d'un utilisateur (relance ou arrêt). */
  private annulerReprise(userId: number): void {
    const timer = this.reprises.get(userId);
    if (timer) {
      clearTimeout(timer);
      this.reprises.delete(userId);
    }
  }

  /**
   * Programme la prochaine reprise d'un utilisateur à l'échéance de sa fiche
   * la plus proche. Un timer en mémoire suffit : au redémarrage,
   * `onModuleInit` relit les échéances persistées et reprogramme.
   */
  private async planifierReprise(
    userId: number,
    options: { autoriserEcheanceDue?: boolean } = {},
  ): Promise<void> {
    // On ne touche pas au timer existant avant d'avoir la réponse : une erreur
    // de requête ne doit pas faire perdre une échéance future valide.
    const prochaine = await this.prochaineRepriseFiche(
      userId,
      options.autoriserEcheanceDue ?? true,
    );
    if (!prochaine) {
      // Plus aucune fiche à reprendre : un timer posé avant un remap ou une
      // relance ne doit pas réveiller un job `done` pour rien.
      this.annulerReprise(userId);
      return;
    }
    if (!options.autoriserEcheanceDue && prochaine.getTime() <= Date.now()) {
      return;
    }
    this.planifierAvecEcheance(userId, prochaine);
  }

  /** Pose le timer (borné à `MAX_TIMEOUT_MS`) pour une échéance connue. */
  private planifierAvecEcheance(userId: number, prochaine: Date): void {
    // Remplace un éventuel timer existant : les appels concurrents ne doivent
    // pas laisser deux timers pour le même utilisateur.
    this.annulerReprise(userId);
    const delai = Math.max(0, prochaine.getTime() - Date.now());
    const attente = Math.min(delai, MAX_TIMEOUT_MS);
    const timer = setTimeout(() => {
      this.reprises.delete(userId);
      if (Date.now() >= prochaine.getTime()) {
        void this.enqueue(userId).catch((error: unknown) => {
          this.logger.warn(
            `Reprise automatique impossible pour l'utilisateur ${userId}: ${
              error instanceof Error ? error.message : 'erreur inconnue'
            }`,
          );
        });
      } else {
        void this.planifierReprise(userId).catch((error: unknown) => {
          this.logger.warn(
            `Replanification impossible pour l'utilisateur ${userId}: ${
              error instanceof Error ? error.message : 'erreur inconnue'
            }`,
          );
        });
      }
    }, attente);
    // Ne pas garder le processus en vie uniquement pour ce timer (tests,
    // arrêt propre) : le serveur HTTP le maintient déjà.
    timer.unref();
    this.reprises.set(userId, timer);
    this.logger.debug(
      `Reprise des fiches de l'utilisateur ${userId} programmée dans ${attente} ms`,
    );
  }

  /** Plus proche échéance de reprise d'une fiche pour un utilisateur. */
  private async prochaineRepriseFiche(
    userId: number,
    autoriserEcheanceDue = true,
  ): Promise<Date | null> {
    const conditions = [
      eq(libraryEntries.userId, userId),
      or(
        isNull(games.detailsFetchedAt),
        lt(games.filtersVersion, FILTERS_VERSION),
      ),
    ];
    if (!autoriserEcheanceDue) {
      conditions.push(
        isNotNull(games.detailsNextRetryAt),
        gt(games.detailsNextRetryAt, new Date()),
      );
    }
    const [row] = await this.db
      .select({
        prochaine: min(games.detailsNextRetryAt),
        sansEcheance: sql<number>`count(*) filter (where ${games.detailsNextRetryAt} is null)`,
      })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(and(...conditions));
    // Une fiche sans échéance (jamais tentée / remap) est due maintenant.
    if (Number(row?.sansEcheance ?? 0) > 0) {
      return new Date();
    }
    return row?.prochaine ?? null;
  }

  /**
   * Reprogramme toutes les reprises au démarrage. Un redémarrage perd les
   * timers en mémoire mais pas `details_next_retry_at`.
   */
  private async planifierToutesReprises(): Promise<void> {
    try {
      const rows = await this.db
        .select({
          userId: libraryEntries.userId,
          prochaine: min(games.detailsNextRetryAt),
          sansEcheance: sql<number>`count(*) filter (where ${games.detailsNextRetryAt} is null)`,
        })
        .from(libraryEntries)
        .innerJoin(games, eq(libraryEntries.gameId, games.id))
        .where(
          or(
            isNull(games.detailsFetchedAt),
            lt(games.filtersVersion, FILTERS_VERSION),
          ),
        )
        .groupBy(libraryEntries.userId);

      for (const row of rows) {
        if (Number(row.sansEcheance ?? 0) > 0) {
          this.planifierAvecEcheance(row.userId, new Date());
        } else if (row.prochaine) {
          this.planifierAvecEcheance(row.userId, row.prochaine);
        }
      }
    } catch (error) {
      this.logger.warn(
        `Planification des reprises impossible au démarrage: ${
          error instanceof Error ? error.message : 'erreur inconnue'
        }`,
      );
    }
  }

  /**
   * Indique si au moins un jeu de l'utilisateur a une fiche déjà récupérée mais
   * pas encore remappée (`filters_version`), ou si un remap en attente est dû.
   * Sert à relancer un import après l'ajout d'un champ dérivé de `appdetails`,
   * même si le dernier import est terminé.
   *
   * Les fiches jamais récupérées (`details_fetched_at IS NULL`) sont traitées
   * par `needsDetails` ; ici on ne couvre que les fiches existantes à remapper.
   * Le délai `details_next_retry_at` évite une sync à chaque login pendant un
   * backoff de remap.
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
          or(
            isNull(games.detailsNextRetryAt),
            lte(games.detailsNextRetryAt, new Date()),
          ),
        ),
      );
    return Number(row?.count ?? 0) > 0;
  }

  /**
   * Indique s'il reste une fiche manquante dont la reprise est due. Complète
   * le planificateur (`planifierToutesReprises` / `planifierReprise`) pour un
   * login qui suit immédiatement l'échéance, sans attendre un timer.
   */
  async needsDetails(userId: number): Promise<boolean> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNull(games.detailsFetchedAt),
          lt(games.detailsAttempts, SEUIL_FICHE_DELISTEE),
          or(
            isNull(games.detailsNextRetryAt),
            lte(games.detailsNextRetryAt, new Date()),
          ),
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
   * Indique s'il reste des jeux indexables sans embedding. Faux quand le quota
   * Gemini du jour est épuisé, ou quand aucune clé n'est configurée : relancer
   * une sync ne servirait à rien et créerait une boucle au login.
   */
  async needsEmbeddings(userId: number): Promise<boolean> {
    if (!this.config.get<string>('EMBEDDING_API_KEY')) {
      return false;
    }
    const count = await this.compterEmbeddingsManquants(userId);
    if (count === 0) {
      return false;
    }
    return (await this.rateLimit.remainingToday()) > 0;
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
          dejaTentes.length > 0 ? notInArray(games.id, dejaTentes) : undefined,
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
    if (!job) {
      return null;
    }
    return this.toResponse(
      job as SyncJobRow,
      await this.compterReliquats(userId),
    );
  }

  /**
   * Reliquat de l'import, quel que soit l'état du job (`done`, `error`…).
   * Quatre `count(*)` par utilisateur : négligeable même pour 1 000 jeux.
   */
  private async compterReliquats(userId: number): Promise<CompteursImport> {
    const [
      pendingDetails,
      detailsUnavailable,
      pendingAchievements,
      pendingEmbeddings,
    ] = await Promise.all([
      this.compterDetailsEnAttente(userId),
      this.compterDetailsIndisponibles(userId),
      this.compterSuccesManquants(userId),
      this.compterEmbeddingsManquants(userId),
    ]);
    return {
      pendingDetails,
      detailsUnavailable,
      pendingAchievements,
      pendingEmbeddings,
    };
  }

  /**
   * Fiches encore récupérables, y compris celles dont le retry est programmé.
   * C'est le contrat du brief 00 §4.6 : une fiche en backoff n'est pas perdue,
   * elle reste un reliquat visible. La sélection d'une passe, elle, respecte
   * `details_next_retry_at` (voir `appIdsSansDetails`).
   */
  private async compterDetailsEnAttente(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNull(games.detailsFetchedAt),
          lt(games.detailsAttempts, SEUIL_FICHE_DELISTEE),
        ),
      );
    return Number(row?.count ?? 0);
  }

  /** Fiches abandonnées : trois passages « délisté » sans succès. */
  private async compterDetailsIndisponibles(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(
        and(
          eq(libraryEntries.userId, userId),
          isNull(games.detailsFetchedAt),
          gte(games.detailsAttempts, SEUIL_FICHE_DELISTEE),
        ),
      );
    return Number(row?.count ?? 0);
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
    let job: SyncJobRow | undefined;
    try {
      // Traite tous les jobs pending du tour, pas seulement le premier : au
      // redémarrage, plusieurs utilisateurs peuvent avoir un job à reprendre.
      // On avance par id croissant puis on repart au début pour ne pas
      // reprendre immédiatement un job pausé au détriment des autres.
      let dernierId = 0;
      for (let tours = 0; tours < 10_000; tours += 1) {
        job = undefined;
        const [prochain] = await this.db
          .select()
          .from(syncJobs)
          .where(
            and(eq(syncJobs.status, 'pending'), gt(syncJobs.id, dernierId)),
          )
          .orderBy(syncJobs.id)
          .limit(1);
        if (!prochain) {
          if (dernierId === 0) {
            break;
          }
          dernierId = 0;
          continue;
        }
        job = prochain as SyncJobRow;
        dernierId = job.id;
        await this.processJob(job);
      }
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message.slice(0, 500)
          : 'erreur inconnue';
      this.logger.error(`Erreur de la boucle de sync: ${message}`);
      // Best effort : ne pas laisser un job pending orphelin si l'erreur a
      // échappé à `processJob`.
      if (job && (job.status === 'pending' || job.status === 'running')) {
        await this.finish(job.id, 'error', job.step, message, new Date()).catch(
          () => undefined,
        );
        await this.users.setStatus(job.userId, 'error').catch(() => undefined);
      }
    } finally {
      this.running = false;
      // Un job a pu être enfilé pendant le dernier SELECT vide : `enqueue` a
      // alors posé `rerun` au lieu de relancer un drain concurrent. Sans cette
      // reprise, le job resterait `pending` jusqu'au prochain login.
      if (this.rerun) {
        this.rerun = false;
        void this.drain();
      }
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
    let enErreur = false;
    try {
      const [user] = await this.db
        .select({ steamId: users.steamId })
        .from(users)
        .where(eq(users.id, job.userId))
        .limit(1);
      if (!user) {
        throw new NotFoundException('Utilisateur inconnu');
      }

      await this.markRunning(job.id);

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
      enErreur = true;
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
    } finally {
      // Programme la reprise de la prochaine fiche en backoff. Si le job a
      // échoué avant l'étape des fiches (ex. profil privé à `library`), une
      // échéance déjà due ne doit pas être replanifiée à zéro : ce serait une
      // boucle serrée. Elle sera reprise au login (`needsDetails`) ou au
      // prochain démarrage.
      await this.planifierReprise(job.userId, {
        autoriserEcheanceDue: !enErreur,
      }).catch((error: unknown) => {
        this.logger.warn(
          `Planification de reprise impossible pour l'utilisateur ${job.userId}: ${
            error instanceof Error ? error.message : 'erreur inconnue'
          }`,
        );
      });
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
      await this.enregistrerEchecFiche(
        appId,
        'rate-limit',
        resultat.retryAfterMs,
      );
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
        .select({
          attempts: games.detailsAttempts,
          detailsFetchedAt: games.detailsFetchedAt,
        })
        .from(games)
        .where(eq(games.appId, appId))
        .limit(1);

      // Une fiche déjà récupérée mais à remapper n'est pas un « jeu délisté » :
      // on ne pollue pas `details_attempts` et on la retente après 24 h.
      if (row?.detailsFetchedAt) {
        await this.db
          .update(games)
          .set({
            detailsNextRetryAt: new Date(maintenant + RETRY_FICHE_DELISTEE_MS),
            detailsLastError: 'removed',
          })
          .where(eq(games.appId, appId));
        return;
      }

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
        : Math.max(RETRY_429_MIN_MS, retryAfterMs);
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
    const total = maxTotal > 0 ? Math.min(manquants, maxTotal) : manquants;

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
    let erreursReseauConsecutives = 0;
    let limiteAtteinte = false;
    let arretReseau = false;
    let attente429Ms = 0;

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
          erreursReseauConsecutives = 0;
        } catch (error) {
          if (error instanceof SteamRateLimitError) {
            attente429Ms = Math.max(attente429Ms, error.retryAfterMs);
            limitesConsecutives += 1;
            erreursReseauConsecutives = 0;
            if (limitesConsecutives >= MAX_429_CONSECUTIFS) {
              limiteAtteinte = true;
              this.logger.warn(
                `Étape succès : ${MAX_429_CONSECUTIFS} 429 consécutifs, pause de la passe`,
              );
            }
          } else {
            limitesConsecutives = 0;
            // Un 5xx/timeout répété ne doit pas balayer 1 000 jeux à chaque
            // login : après trois échecs réseau consécutifs, on rend la main.
            erreursReseauConsecutives += 1;
            if (erreursReseauConsecutives >= MAX_ERREURS_RESEAU_CONSECUTIVES) {
              // Arrêt sans `pauseJob` : un job repassé en `pending` serait
              // repris immédiatement par `drain` et martèlerait Steam. Le job
              // termine ; `needsAchievements` reprendra au prochain login.
              arretReseau = true;
              this.logger.warn(
                `Étape succès : ${MAX_ERREURS_RESEAU_CONSECUTIVES} échecs réseau consécutifs, arrêt de la passe`,
              );
            }
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
        limiteAtteinte || arretReseau || this.budgetDepasse(deadline),
      // Les erreurs Steam transitoires restent des échecs de jeu ; une erreur
      // DB ou de programmation doit faire échouer le job, pas finir en `done`.
      estFatal: (error) =>
        !(error instanceof SteamRateLimitError) &&
        !(error instanceof ServiceUnavailableException),
    });

    // Trois 429 consécutifs avec du progrès : on attend le Retry-After (borné)
    // avant de réenfiler la passe. Sans cela, `pauseJob` relancerait
    // immédiatement et martèlerait Steam.
    if (limiteAtteinte && resultat.paused && attente429Ms > 0) {
      await sleep(Math.min(attente429Ms, MAX_ATTENTE_429_MS));
    }

    await this.marquerActiviteSucces(userId);

    return {
      // Un arrêt réseau termine la passe sans remettre le job en `pending`.
      paused: resultat.paused && !arretReseau,
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
    let quotaAtteint = false;
    for (const appId of appIds) {
      if (this.budgetDepasse(deadline)) {
        return { paused: progressed, progressed };
      }
      const input = await this.games.embeddingInputFor(appId);
      if (!input) {
        // Jeu sans texte exploitable : non indexable, jamais retenté.
        processed += 1;
        await this.setProgress(jobId, 'embeddings', {
          totalGames: appIds.length,
          processedGames: processed,
        });
        continue;
      }
      try {
        const embedding = await this.embedding.embedGame(input, {
          source: 'import',
        });
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
      } catch (error) {
        if (error instanceof QuotaReachedError) {
          // Le quota ne revient pas en quelques secondes : on termine la passe
          // sans réenfiler, le reliquat reste dans `pendingEmbeddings`.
          quotaAtteint = true;
          this.logger.warn(
            'Étape embeddings : quota Gemini atteint, reliquat conservé',
          );
          break;
        }
        throw error;
      }
      processed += 1;
      await this.setProgress(jobId, 'embeddings', {
        totalGames: appIds.length,
        processedGames: processed,
      });
    }
    return { paused: false, progressed: !quotaAtteint && progressed };
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
      )
      // Les jeux jamais tentés passent avant ceux qui reviennent d'un backoff :
      // sans cet ordre, trois 429 répétés pourraient affamer les suivants.
      .orderBy(sql`${games.detailsNextRetryAt} ASC NULLS FIRST`, games.appId);
    return rows.map((row) => row.appId);
  }

  /**
   * Conditions des jeux indexables dont l'embedding manque : fiche récupérée et
   * au moins une description, un genre ou une catégorie. Un jeu sans texte
   * exploitable n'est jamais retenté (aligné sur `embeddingInputFor`).
   */
  private conditionsEmbeddingsManquants(userId: number) {
    return and(
      eq(libraryEntries.userId, userId),
      isNull(games.embedding),
      isNotNull(games.detailsFetchedAt),
      or(
        sql`coalesce(${games.shortDescription}, '') <> ''`,
        sql`cardinality(${games.genres}) > 0`,
        sql`cardinality(${games.categories}) > 0`,
      ),
    );
  }

  /** `appId` de la bibliothèque dont l'embedding manque. */
  private async appIdsSansEmbedding(userId: number): Promise<number[]> {
    const rows = await this.db
      .select({ appId: games.appId })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(this.conditionsEmbeddingsManquants(userId));
    return rows.map((row) => row.appId);
  }

  /** Nombre de jeux indexables dont l'embedding manque. */
  private async compterEmbeddingsManquants(userId: number): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)` })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(this.conditionsEmbeddingsManquants(userId));
    return Number(row?.count ?? 0);
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

  private toResponse(
    job: SyncJobRow,
    compteurs: CompteursImport = COMPTEURS_VIDES,
  ): SyncJobResponse {
    return {
      id: job.id,
      status: job.status,
      step: job.step,
      totalGames: job.totalGames,
      processedGames: job.processedGames,
      error: job.error,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      ...compteurs,
    };
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
