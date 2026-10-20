import { Inject, Injectable, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { MinuteWindow } from '../embedding/rate-limiter.service.js';

/** Modes soumis à une limite de fréquence distincte. */
export type SearchRateLimitKind = 'name' | 'semantic';

/** Horloge injectable, pour tester les fenêtres glissantes sans attente réelle. */
export const SEARCH_CLOCK = Symbol('SEARCH_CLOCK');

export interface SearchRateLimitDecision {
  allowed: boolean;
  /** Attente restante avant qu'une place se libère (0 si autorisé). */
  retryAfterMs: number;
}

interface UserWindows {
  name: MinuteWindow;
  semantic: MinuteWindow;
  lastSeen: number;
}

const WINDOW_MS = 60_000;
/** Purge les utilisateurs inactifs toutes les N décisions. */
const PRUNE_EVERY = 100;
const PRUNE_AFTER_MS = 2 * WINDOW_MS;

/**
 * Limitation de fréquence par utilisateur (`steamId`), en mémoire.
 *
 * Deux fenêtres indépendantes : `name` (aperçu pendant la frappe, SQL seul) et
 * `semantic` (un appel Gemini par recherche). Sans cette séparation, l'aperçu
 * consommerait la limite sémantique et bloquerait la saisie.
 *
 * État par instance et perdu au redémarrage : acceptable tant que l'API tourne
 * sur une seule instance. À migrer vers un compteur persisté si elle est
 * répliquée.
 */
@Injectable()
export class SearchRateLimitService {
  private readonly nameLimit: number;
  private readonly semanticLimit: number;
  private readonly windows = new Map<string, UserWindows>();
  private decisions = 0;

  constructor(
    private readonly config: ConfigService,
    @Optional()
    @Inject(SEARCH_CLOCK)
    private readonly now: () => number = Date.now,
  ) {
    this.nameLimit = this.readLimit('SEARCH_NAME_RATE_LIMIT_PER_MINUTE', 120);
    this.semanticLimit = this.readLimit('SEARCH_RATE_LIMIT_PER_MINUTE', 20);
  }

  /**
   * Réserve une place dans la fenêtre du mode demandé. Ne consomme rien quand
   * la limite est atteinte : l'appelant renvoie une 429 avec `retryAfterMs`.
   */
  tryConsume(
    steamId: string,
    kind: SearchRateLimitKind,
  ): SearchRateLimitDecision {
    const windows = this.windowsFor(steamId);
    const window = kind === 'semantic' ? windows.semantic : windows.name;
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
        name: new MinuteWindow(this.nameLimit, WINDOW_MS, this.now),
        semantic: new MinuteWindow(this.semanticLimit, WINDOW_MS, this.now),
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
