import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

const GEMINI_EMBEDDING_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:embedContent';
const DEFAULT_MODEL = 'gemini-embedding-001';
const DEFAULT_DIMENSIONS = 1024;

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

  constructor(private readonly config: ConfigService) {}

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
        },
      );

      if (!response.ok) {
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
