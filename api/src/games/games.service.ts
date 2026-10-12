import { Inject, Injectable, Logger } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { games } from '../db/schema.js';
import type { EmbeddingInput } from '../embedding/embedding.service.js';

const STEAM_STORE_APPDETAILS = 'https://store.steampowered.com/api/appdetails';
const EXTERNAL_CALL_TIMEOUT_MS = 5000;

/** Fiche Steam telle que persistée dans `games`. */
export interface AppDetails {
  appId: number;
  name: string;
  shortDescription: string | null;
  genres: string[];
  categories: string[];
  controllerSupport: 'none' | 'partial' | 'full';
  releaseDate: Date | null;
  headerImageUrl: string | null;
}

interface AppdetailsData {
  success?: boolean;
  data?: {
    name?: string;
    short_description?: string;
    genres?: Array<{ description?: string }>;
    categories?: Array<{ description?: string }>;
    controller_support?: string;
    release_date?: { date?: string; coming_soon?: boolean };
    header_image?: string;
  };
}

const FRENCH_MONTHS: Array<[RegExp, number]> = [
  [/jan/i, 0],
  [/f[eé]v/i, 1],
  [/mars/i, 2],
  [/avr/i, 3],
  [/mai/i, 4],
  [/juin/i, 5],
  [/juil/i, 6],
  [/ao[uû]t/i, 7],
  [/sept/i, 8],
  [/oct/i, 9],
  [/nov/i, 10],
  [/d[eé]c/i, 11],
];

/** Parses les dates "26 Oct, 2023" (anglais, natif) et "26 oct. 2023" (français). */
export function parseReleaseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/coming|bientôt|bientot/i.test(trimmed)) return null;

  const native = new Date(trimmed);
  if (!Number.isNaN(native.getTime())) return native;

  const match = trimmed.match(
    /^(\d{1,2})\s+([a-zàâäéèêëîïôöùûüç]+)\.?,?\s*,?\s*(\d{4})$/i,
  );
  if (!match) return null;

  const month = FRENCH_MONTHS.find(([regex]) => regex.test(match[2]));
  if (!month) return null;

  const date = new Date(
    Number(match[3]),
    month[1],
    Number(match[1]),
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** Déduit le support manette du champ dédié puis des catégories Steam. */
export function mapControllerSupport(
  data: NonNullable<AppdetailsData['data']>,
): 'none' | 'partial' | 'full' {
  const direct = data.controller_support?.trim().toLowerCase();
  if (direct === 'full' || direct === 'partial' || direct === 'none') {
    return direct;
  }
  const categories = (data.categories ?? [])
    .map((category) => category.description?.toLowerCase() ?? '');
  if (categories.some((c) => c.includes('full controller support'))) {
    return 'full';
  }
  if (categories.some((c) => c.includes('partial controller'))) {
    return 'partial';
  }
  return 'none';
}

function stripHtml(value: string): string {
  return value.replace(/<[^>]*>/g, '').trim();
}

function mapAppDetails(appId: number, data: NonNullable<AppdetailsData['data']>): AppDetails {
  return {
    appId,
    name: data.name as string,
    shortDescription: data.short_description
      ? stripHtml(data.short_description)
      : null,
    genres: (data.genres ?? [])
      .map((genre) => genre.description?.trim() ?? '')
      .filter((description) => description.length > 0),
    categories: (data.categories ?? [])
      .map((category) => category.description?.trim() ?? '')
      .filter((description) => description.length > 0),
    controllerSupport: mapControllerSupport(data),
    releaseDate: parseReleaseDate(data.release_date?.date),
    headerImageUrl: data.header_image ?? null,
  };
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Récupère la fiche Steam d'un jeu. Renvoie `null` si indisponible (jeu
   * retiré du Store, erreur réseau, timeout) : jamais une exception — l'import
   * poursuit sans cette fiche.
   */
  async fetchAppDetails(appId: number): Promise<AppDetails | null> {
    const url = `${STEAM_STORE_APPDETAILS}?appids=${appId}&l=french`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
      if (!response.ok) {
        this.logger.warn(`appdetails a répondu ${response.status}`);
        return null;
      }
      const body = (await response.json()) as Record<string, AppdetailsData>;
      const entry = body[String(appId)];
      if (!entry?.success || !entry.data?.name) {
        return null;
      }
      return mapAppDetails(appId, entry.data);
    } catch (error) {
      this.logger.warn(
        `appdetails ${appId} injoignable: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return null;
    }
  }

  /** Upsert d'une fiche complète. Met à jour les champs, ne supprime jamais. */
  async upsertFromDetails(details: AppDetails): Promise<number> {
    const [row] = await this.db
      .insert(games)
      .values({
        appId: details.appId,
        name: details.name,
        shortDescription: details.shortDescription,
        genres: details.genres,
        categories: details.categories,
        controllerSupport: details.controllerSupport,
        releaseDate: details.releaseDate,
        headerImageUrl: details.headerImageUrl,
        detailsFetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: games.appId,
        set: {
          name: details.name,
          shortDescription: details.shortDescription,
          genres: details.genres,
          categories: details.categories,
          controllerSupport: details.controllerSupport,
          releaseDate: details.releaseDate,
          headerImageUrl: details.headerImageUrl,
          detailsFetchedAt: new Date(),
        },
      })
      .returning({ id: games.id });

    return row.id;
  }

  /** Ligne minimale (nom seul), en attendant la fiche complète. */
  async upsertBasic(appId: number, name: string): Promise<number> {
    const [row] = await this.db
      .insert(games)
      .values({ appId, name })
      .onConflictDoUpdate({ target: games.appId, set: { name } })
      .returning({ id: games.id });

    return row.id;
  }

  /** Texte d'entrée pour l'embedding, depuis la fiche persistée. */
  async embeddingInputFor(appId: number): Promise<EmbeddingInput | null> {
    const [row] = await this.db
      .select()
      .from(games)
      .where(eq(games.appId, appId))
      .limit(1);
    if (!row) return null;
    if (!row.shortDescription && row.genres.length === 0 && row.categories.length === 0) {
      return null;
    }
    return {
      name: row.name,
      shortDescription: row.shortDescription ?? undefined,
      genres: row.genres,
      categories: row.categories,
    };
  }
}