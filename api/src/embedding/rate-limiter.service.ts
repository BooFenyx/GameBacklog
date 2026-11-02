import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DB, type Db } from '../db/db.module.js';

/** Clé du compteur de quota quotidien partagé par toutes les requêtes. */
export const RATE_LIMIT_KEY = 'embedding_gemini';

/** Levée quand le quota quotidien d'embedding est épuisé (ou un 429 reçu). */
export class QuotaReachedError extends Error {
  constructor(message = "Quota d'embedding atteint (Google Gemini)") {
    super(message);
    this.name = 'QuotaReachedError';
  }
}

/**
 * Fenêtre glissante par minute, purement en mémoire. `now` est injectable pour
 * les tests : la logique d'attente est testée sans horloge simulée.
 */
export class MinuteWindow {
  private readonly calls: number[] = [];

  constructor(
    private readonly maxPerMinute: number,
    private readonly windowMs = 60_000,
    private readonly now: () => number = Date.now,
  ) {}

  /** Nombre d'appels encore comptés dans la fenêtre courante. */
  count(): number {
    this.purger();
    return this.calls.length;
  }

  /** Attente restante en ms avant de pouvoir émettre (0 si une place est libre). */
  waitMillis(limite = this.maxPerMinute): number {
    const current = this.now();
    this.purger(current);
    if (this.calls.length >= limite) {
      return this.windowMs - (current - this.calls[0]);
    }
    return 0;
  }

  record(now = this.now()): void {
    this.calls.push(now);
  }

  private purger(current = this.now()): void {
    while (this.calls.length > 0 && current - this.calls[0] >= this.windowMs) {
      this.calls.shift();
    }
  }
}

export function slowDown(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Limiteur de débit pour les appels d'embedding :
 * - compteur quotidien **persisté en base** (`rate_limits`), partagé par toutes
 *   les requêtes et survivant aux redémarrages ;
 * - fenêtre par minute **en mémoire**.
 * `acquire()` est appelé avant chaque requête Gemini : il attend que la fenêtre
 * minute libère une place, puis renvoie `'quota-journalier'` si le quota du
 * jour est épuisé (l'import s'arrête alors gracieusement, rien n'est supprimé).
 * `maxWaitMs` borne l'attente : au-delà, `acquire()` renvoie `'busy'` sans
 * consommer de créneau. La recherche s'en sert pour basculer en repli plutôt
 * que de bloquer la requête HTTP pendant une minute.
 */
@Injectable()
export class RateLimitService {
  private readonly logger = new Logger(RateLimitService.name);
  private readonly maxPerMinute: number;
  private readonly maxPerDay: number;
  private readonly dayWindowMs = 24 * 60 * 60 * 1000;
  private readonly minuteWindow: MinuteWindow;

  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly config: ConfigService,
  ) {
    this.maxPerMinute = this.readLimit('EMBEDDING_RATE_LIMIT_PER_MINUTE', 100);
    this.maxPerDay = this.readLimit('EMBEDDING_RATE_LIMIT_PER_DAY', 1000);
    this.minuteWindow = new MinuteWindow(this.maxPerMinute);
  }

  private readLimit(key: string, defaultValue: number): number {
    const raw = this.config.get<string | number>(key);
    const parsed = raw === undefined || raw === '' ? defaultValue : Number(raw);
    return Number.isFinite(parsed) ? Math.max(1, parsed) : defaultValue;
  }

  /**
   * Nombre d'appels encore disponibles aujourd'hui (0 quand le quota est
   * épuisé). Utilisé pour ne pas relancer une sync qui ne pourrait rien faire.
   */
  async remainingToday(): Promise<number> {
    const day = await this.readDayCounter();
    if (!day) {
      return this.maxPerDay;
    }
    if (Date.now() - day.windowStartedAt >= this.dayWindowMs) {
      return this.maxPerDay;
    }
    return Math.max(0, this.maxPerDay - day.count);
  }

  async acquire(
    maxWaitMs?: number,
    source: 'search' | 'import' = 'search',
  ): Promise<'ok' | 'quota-journalier' | 'busy'> {
    // Fenêtre par minute (mémoire) : on attend le temps exact de libération
    // avant de consommer un créneau, sans pause fixe de 60 s. La recherche
    // borne cette attente : au-delà, elle préfère un repli immédiat.
    // L'import s'arrête à 80 % de la fenêtre pour laisser ~20 % à la recherche.
    const limite =
      source === 'import'
        ? Math.max(1, Math.floor(this.maxPerMinute * 0.8))
        : this.maxPerMinute;
    const wait = this.minuteWindow.waitMillis(limite);
    if (wait > 0) {
      if (maxWaitMs !== undefined && wait > maxWaitMs) {
        return 'busy';
      }
      await slowDown(wait);
    }

    const now = Date.now();

    // Compteur quotidien (persisté, partagé) : réinitialisé après 24 h.
    const day = await this.readDayCounter();
    if (day) {
      if (now - day.windowStartedAt >= this.dayWindowMs) {
        await this.resetDayCounter(now);
      } else if (day.count >= this.maxPerDay) {
        this.logger.warn(
          `Quota quotidien atteint (${day.count}/${this.maxPerDay}) : import interrompu`,
        );
        return 'quota-journalier';
      } else {
        await this.incrementDayCounter();
      }
    } else {
      await this.resetDayCounter(now);
    }

    this.minuteWindow.record(now);
    return 'ok';
  }

  private async readDayCounter(): Promise<{
    count: number;
    windowStartedAt: number;
  } | null> {
    const result = await this.db.$client.query(
      'SELECT count, window_started_at FROM rate_limits WHERE key = $1',
      [RATE_LIMIT_KEY],
    );
    const row = result.rows[0];
    if (!row) {
      return null;
    }
    return {
      count: Number(row.count),
      windowStartedAt: new Date(row.window_started_at).getTime(),
    };
  }

  private async resetDayCounter(now: number): Promise<void> {
    await this.db.$client.query(
      `INSERT INTO rate_limits (key, count, window_started_at)
       VALUES ($1, 1, $2)
       ON CONFLICT (key) DO UPDATE SET count = 1, window_started_at = $2`,
      [RATE_LIMIT_KEY, new Date(now)],
    );
  }

  private async incrementDayCounter(): Promise<void> {
    await this.db.$client.query(
      'UPDATE rate_limits SET count = count + 1 WHERE key = $1',
      [RATE_LIMIT_KEY],
    );
  }
}
