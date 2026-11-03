import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinuteWindow } from '../embedding/rate-limiter.service.js';

/** Routes de lecture soumises à une limite de fréquence par utilisateur. */
export type ReadRateLimitKind = 'library' | 'games' | 'home' | 'sync';

export interface ReadRateLimitDecision {
  allowed: boolean;
  /** Attente restante avant qu'une place se libère (0 si autorisé). */
  retryAfterMs: number;
}

interface UserWindows {
  library: MinuteWindow;
  games: MinuteWindow;
  home: MinuteWindow;
  sync: MinuteWindow;
  lastSeen: number;
}

const WINDOW_MS = 60_000;
const PRUNE_EVERY = 100;
const PRUNE_AFTER_MS = 2 * WINDOW_MS;

const DEFAULTS: Record<ReadRateLimitKind, number> = {
  library: 120,
  games: 120,
  // L'accueil est recalulé pendant les réglages (curseur, genre) : un plafond
  // un peu plus large évite de bloquer une manipulation normale.
  home: 180,
  // Le front sonde `/api/sync` toutes les 2 s (30/min) : 120/min garde de la
  // marge pour deux onglets ouverts et une relance manuelle.
  sync: 120,
};

/** Horloge injectable pour les tests unitaires. */
export const READ_RATE_LIMIT_CLOCK = Symbol('READ_RATE_LIMIT_CLOCK');

/**
 * Limitation de fréquence par utilisateur (`steamId`), en mémoire, pour les
 * routes de lecture. La recherche garde son propre limiteur, avec des fenêtres
 * séparées par mode (`SearchRateLimitService`).
 *
 * État par instance et perdu au redémarrage : acceptable tant que l'API tourne
 * sur une seule instance. À migrer vers un compteur persisté si elle est
 * répliquée.
 */
@Injectable()
export class ReadRateLimitService {
  private readonly limits: Record<ReadRateLimitKind, number>;
  private readonly windows = new Map<string, UserWindows>();
  private decisions = 0;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(READ_RATE_LIMIT_CLOCK)
    private readonly now: () => number = Date.now,
  ) {
    this.limits = {
      library: this.readLimit(
        'LIBRARY_RATE_LIMIT_PER_MINUTE',
        DEFAULTS.library,
      ),
      games: this.readLimit('GAMES_RATE_LIMIT_PER_MINUTE', DEFAULTS.games),
      home: this.readLimit('HOME_RATE_LIMIT_PER_MINUTE', DEFAULTS.home),
      sync: this.readLimit('SYNC_RATE_LIMIT_PER_MINUTE', DEFAULTS.sync),
    };
  }

  /**
   * Réserve une place dans la fenêtre de la route. Ne consomme rien quand la
   * limite est atteinte : l'appelant renvoie une 429 avec `retryAfterMs`.
   */
  tryConsume(steamId: string, kind: ReadRateLimitKind): ReadRateLimitDecision {
    const windows = this.windowsFor(steamId);
    const window = windows[kind];
    const wait = window.waitMillis();

    if (wait > 0) {
      return { allowed: false, retryAfterMs: wait };
    }

    window.record();
    return { allowed: true, retryAfterMs: 0 };
  }

  private windowsFor(steamId: string): UserWindows {
    const current = this.now();
    let windows = this.windows.get(steamId);
    if (!windows) {
      windows = {
        library: new MinuteWindow(this.limits.library, WINDOW_MS, this.now),
        games: new MinuteWindow(this.limits.games, WINDOW_MS, this.now),
        home: new MinuteWindow(this.limits.home, WINDOW_MS, this.now),
        sync: new MinuteWindow(this.limits.sync, WINDOW_MS, this.now),
        lastSeen: current,
      };
      this.windows.set(steamId, windows);
    }
    windows.lastSeen = current;
    this.pruneIfNeeded(current);
    return windows;
  }

  /** Évite qu'un utilisateur inactif conserve ses fenêtres indéfiniment. */
  private pruneIfNeeded(current: number): void {
    this.decisions += 1;
    if (this.decisions % PRUNE_EVERY !== 0) {
      return;
    }
    for (const [steamId, windows] of this.windows) {
      if (current - windows.lastSeen >= PRUNE_AFTER_MS) {
        this.windows.delete(steamId);
      }
    }
  }

  private readLimit(key: string, fallback: number): number {
    const raw = this.config.get<string | number>(key);
    const parsed = raw === undefined || raw === '' ? fallback : Number(raw);
    return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : fallback;
  }
}
