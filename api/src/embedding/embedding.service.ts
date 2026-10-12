import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  QuotaReachedError,
  RateLimitService,
} from './rate-limiter.service.js';

const GEMINI_EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = 1024;
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;

export interface EmbeddingInput {
  name: string;
  shortDescription?: string;
  genres?: string[];
  categories?: string[];
}

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly rateLimit: RateLimitService,
  ) {}

  get modelName(): string {
    return this.config.get<string>('EMBEDDING_MODEL') ?? DEFAULT_MODEL;
  }

  buildText(input: EmbeddingInput): string {
    const parts: string[] = [input.name];

    if (input.shortDescription) {
      parts.push(input.shortDescription);
    }

    if (input.genres && input.genres.length > 0) {
      parts.push(`Genres: ${input.genres.join(', ')}`);
    }

    if (input.categories && input.categories.length > 0) {
      parts.push(`Catégories: ${input.categories.join(', ')}`);
    }

    return parts.join('. ');
  }

  async embed(text: string): Promise<number[] | null> {
    const apiKey = this.config.get<string>('EMBEDDING_API_KEY');
    if (!apiKey) {
      this.logger.warn('EMBEDDING_API_KEY absente : embedding non généré');
      return null;
    }

    // Réserve une place dans les quotas (minute + jour). Si le quota quotidien
    // est épuisé, on lève une exception dédiée : l'import s'arrête proprement
    // et reprendra plus tard (aucune suppression).
    const slot = await this.rateLimit.acquire();
    if (slot === 'quota-journalier') {
      throw new QuotaReachedError();
    }

    const model = this.config.get<string>('EMBEDDING_MODEL') ?? DEFAULT_MODEL;
    const dimensions =
      this.config.get<number>('EMBEDDING_DIMENSIONS') ?? DEFAULT_DIMENSIONS;

    try {
      const response = await fetch(
        `${GEMINI_EMBEDDING_URL}?key=${encodeURIComponent(apiKey)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model: `models/${model}`,
            content: { parts: [{ text }] },
            outputDimensionality: dimensions,
          }),
          signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
        },
      );

      if (!response.ok) {
        if (response.status === 429) {
          throw new QuotaReachedError();
        }
        this.logger.warn(`Gemini a répondu ${response.status}`);
        return null;
      }

      const data = (await response.json()) as GeminiEmbeddingResponse;
      const embedding = data.embedding?.values;

      if (!embedding || embedding.length === 0) {
        this.logger.warn('Gemini a renvoyé un embedding vide');
        return null;
      }

      return embedding;
    } catch (error) {
      if (error instanceof QuotaReachedError) {
        throw error;
      }
      this.logger.error(
        `Erreur lors de l'appel à Gemini: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return null;
    }
  }

  async embedGame(input: EmbeddingInput): Promise<number[] | null> {
    const text = this.buildText(input);
    return this.embed(text);
  }
}
