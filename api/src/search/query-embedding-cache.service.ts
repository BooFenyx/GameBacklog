import { Inject, Injectable, Optional } from '@nestjs/common';
import { SEARCH_CLOCK } from './search-clock.js';

/** Durée de vie d'un embedding de requête en cache. */
export const QUERY_CACHE_TTL_MS = 60 * 60 * 1000;
/** Nombre maximal d'entrées conservées (les plus anciennes sont évincées). */
export const QUERY_CACHE_MAX_ENTRIES = 500;

interface CacheEntry {
  vector: number[];
  expiresAt: number;
}

/**
 * Cache mémoire des embeddings de requête, partagé entre utilisateurs.
 *
 * L'embedding d'une phrase ne dépend pas de l'utilisateur : la clé est la
 * requête normalisée. Le cache évite de rappeler Gemini quand un utilisateur
 * relance la même recherche, et déduplique les appels concurrents identiques.
 * État par instance, perdu au redémarrage : suffisant pour ce périmètre.
 */
@Injectable()
export class QueryEmbeddingCacheService {
  private readonly entries = new Map<string, CacheEntry>();
  private readonly pending = new Map<string, Promise<number[] | null>>();

  constructor(
    @Optional()
    @Inject(SEARCH_CLOCK)
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Renvoie le vecteur en cache ou exécute `compute`. Un résultat `null` n'est
   * pas mis en cache (échec transient) et deux appels simultanés sur la même
   * requête ne déclenchent qu'un seul calcul.
   */
  async getOrCompute(
    text: string,
    compute: () => Promise<number[] | null>,
  ): Promise<number[] | null> {
    const key = normalizeQuery(text);
    const cached = this.read(key);
    if (cached) {
      return cached;
    }

    const inFlight = this.pending.get(key);
    if (inFlight) {
      return inFlight;
    }

    const promise = compute()
      .then((vector) => {
        if (vector && vector.length > 0) {
          this.write(key, vector);
        }
        return vector;
      })
      .finally(() => {
        this.pending.delete(key);
      });

    this.pending.set(key, promise);
    return promise;
  }

  private read(key: string): number[] | null {
    const entry = this.entries.get(key);
    if (!entry) {
      return null;
    }
    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.vector;
  }

  private write(key: string, vector: number[]): void {
    if (
      !this.entries.has(key) &&
      this.entries.size >= QUERY_CACHE_MAX_ENTRIES
    ) {
      this.evict();
    }
    this.entries.set(key, {
      vector,
      expiresAt: this.now() + QUERY_CACHE_TTL_MS,
    });
  }

  /** Purge les entrées expirées, puis la plus ancienne si le cache est plein. */
  private evict(): void {
    const current = this.now();
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= current) {
        this.entries.delete(key);
      }
    }
    if (this.entries.size < QUERY_CACHE_MAX_ENTRIES) {
      return;
    }
    const oldest = this.entries.keys().next().value;
    if (oldest !== undefined) {
      this.entries.delete(oldest);
    }
  }
}

/** Normalise une requête pour servir de clé de cache. */
export function normalizeQuery(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, ' ');
}
