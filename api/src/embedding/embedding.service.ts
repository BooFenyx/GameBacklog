import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { QuotaReachedError, RateLimitService } from './rate-limiter.service.js';

const GEMINI_EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = 1024;
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;
/**
 * Version du texte indexé. À incrémenter à chaque changement de `buildText` :
 * le sync réindexe alors les jeux dont `embedding_text_version` est antérieure.
 *
 * v2 ajoute la description longue (premiers blocs) après la description courte.
 */
export const EMBEDDING_TEXT_VERSION = 2;
/** Longueur maximale de description longue injectée dans le texte. */
export const MAX_LONG_DESCRIPTION_CHARS = 1200;

export interface EmbeddingInput {
  name: string;
  shortDescription?: string;
  /** Description longue déjà convertie en texte brut, sans HTML. */
  longDescription?: string;
  genres?: string[];
  categories?: string[];
}

export interface EmbedOptions {
  /**
   * Attente maximale dans la fenêtre de quota par minute. Au-delà, `embed`
   * renvoie `null` immédiatement au lieu de suspendre la requête.
   */
  maxWaitMs?: number;
  /**
   * Origine de l'appel : l'import s'arrête à 80 % de la fenêtre minute pour
   * réserver le reste à la recherche. Défaut : `'search'`.
   */
  source?: 'search' | 'import';
  /**
   * Utilisateur à l'origine d'une recherche sémantique. Sert au quota
   * quotidien par utilisateur ; l'import n'en a pas besoin.
   */
  userId?: number;
}

interface GeminiEmbeddingResponse {
  embedding?: { values?: number[] };
  error?: { message?: string };
}

/** Réduit les espaces et retire les blancs de bord d'un texte optionnel. */
function normaliser(texte: string | undefined): string {
  return (texte ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Joint des phrases en évitant les points doubles quand un morceau se termine
 * déjà par une ponctuation finale.
 */
function joindrePhrases(morceaux: string[]): string {
  return morceaux.reduce((accumule, morceau, index) => {
    if (index === 0) return morceau;
    return `${accumule.replace(/[.!?]+$/, '')}. ${morceau}`;
  }, '');
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

  /** Version courante du texte indexé, persistée avec chaque embedding. */
  get textVersion(): number {
    return EMBEDDING_TEXT_VERSION;
  }

  buildText(input: EmbeddingInput): string {
    const parts: string[] = [input.name.trim()];

    const court = normaliser(input.shortDescription);
    if (court) parts.push(court);

    const long = normaliser(input.longDescription);
    // Évite de dupliquer la description courte quand Steam la répète au début
    // de la description longue.
    if (long && long !== court) {
      parts.push(long.slice(0, MAX_LONG_DESCRIPTION_CHARS));
    }

    if (input.genres && input.genres.length > 0) {
      parts.push(`Genres: ${input.genres.join(', ')}`);
    }

    if (input.categories && input.categories.length > 0) {
      parts.push(`Catégories: ${input.categories.join(', ')}`);
    }

    return joindrePhrases(parts);
  }

  async embed(
    text: string,
    options: EmbedOptions = {},
  ): Promise<number[] | null> {
    const apiKey = this.config.get<string>('EMBEDDING_API_KEY');
    if (!apiKey) {
      this.logger.warn('EMBEDDING_API_KEY absente : embedding non généré');
      return null;
    }

    // Réserve une place dans les quotas (minute + jour). Si le quota quotidien
    // est épuisé, on lève une exception dédiée : l'import s'arrête proprement
    // et reprendra plus tard (aucune suppression). `'busy'` signifie que la
    // fenêtre minute est saturée au-delà de l'attente autorisée : on renonce
    // sans consommer de créneau.
    const slot = await this.rateLimit.acquire(
      options.maxWaitMs,
      options.source,
      options.userId,
    );
    if (slot === 'busy') {
      this.logger.debug(
        "Fenêtre d'embedding saturée : appel abandonné sans attente",
      );
      return null;
    }
    if (slot === 'quota-utilisateur') {
      // La recherche bascule en repli par nom ; on ne lève pas pour ne pas
      // transformer un quota personnel en erreur 500.
      this.logger.debug(`Quota utilisateur atteint pour ${options.userId}`);
      return null;
    }
    if (slot === 'quota-journalier') {
      throw new QuotaReachedError();
    }

    const model = this.config.get<string>('EMBEDDING_MODEL') ?? DEFAULT_MODEL;
    // `ConfigService` renvoie les variables d'environnement sous forme de
    // chaînes : sans `Number()`, `outputDimensionality` partirait en `"1024"`.
    const rawDimensions = this.config.get<string>('EMBEDDING_DIMENSIONS');
    const dimensions = rawDimensions
      ? Number(rawDimensions)
      : DEFAULT_DIMENSIONS;

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
      const message =
        error instanceof Error ? error.message : 'erreur inconnue';
      // Ne jamais laisser la clé API (présente dans l'URL d'appel) dans les
      // logs Render si le message d'erreur contient l'URL complète.
      this.logger.error(
        `Erreur lors de l'appel à Gemini: ${message.replace(
          /key=[^&\s]+/gi,
          'key=***',
        )}`,
      );
      return null;
    }
  }

  async embedGame(
    input: EmbeddingInput,
    options: EmbedOptions = {},
  ): Promise<number[] | null> {
    const text = this.buildText(input);
    return this.embed(text, options);
  }
}
