import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import {
  games,
  libraryEntries,
  type CaptureEcran,
  type DescriptionBlock,
  type Plateforme,
} from '../db/schema.js';
import type { EmbeddingInput } from '../embedding/embedding.service.js';

const STEAM_STORE_APPDETAILS = 'https://store.steampowered.com/api/appdetails';
const EXTERNAL_CALL_TIMEOUT_MS = 5000;
const MAX_SCREENSHOTS = 6;

/**
 * Version du mapping appliqué aux fiches. À incrémenter quand on ajoute un
 * champ dérivé de `appdetails` : le sync reprend alors les fiches dont la
 * version est inférieure (`SyncService.stepDetails`).
 *
 * La version 2 ajoute la description longue, les captures, les développeurs,
 * les éditeurs, le site, les plateformes, Metacritic et l'image de fond.
 */
export const FILTERS_VERSION = 2;

/** Fiche Steam telle que persistée dans `games`. */
export interface AppDetails {
  appId: number;
  name: string;
  shortDescription: string | null;
  descriptionBlocks: DescriptionBlock[];
  screenshots: CaptureEcran[];
  developers: string[];
  publishers: string[];
  website: string | null;
  platforms: Plateforme[];
  metacriticScore: number | null;
  metacriticUrl: string | null;
  backgroundImageUrl: string | null;
  genres: string[];
  genreIds: number[];
  categories: string[];
  categoryIds: number[];
  controllerSupport: 'none' | 'partial' | 'full';
  releaseDate: Date | null;
  headerImageUrl: string | null;
}

interface AppdetailsData {
  success?: boolean;
  data?: {
    name?: string;
    short_description?: string;
    detailed_description?: string;
    developers?: string[];
    publishers?: string[];
    website?: string;
    screenshots?: Array<{
      id?: number;
      path_thumbnail?: string;
      path_full?: string;
    }>;
    background?: string;
    background_raw?: string;
    platforms?: { windows?: boolean; mac?: boolean; linux?: boolean };
    metacritic?: { score?: number; url?: string };
    /** `id` est une chaîne dans la réponse réelle de Steam. */
    genres?: Array<{ id?: string; description?: string }>;
    /** `id` est un nombre dans la réponse réelle de Steam. */
    categories?: Array<{ id?: number; description?: string }>;
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

  const date = new Date(Number(match[3]), month[1], Number(match[1]));
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
  const categories = (data.categories ?? []).map(
    (category) => category.description?.toLowerCase() ?? '',
  );
  if (categories.some((c) => c.includes('full controller support'))) {
    return 'full';
  }
  if (categories.some((c) => c.includes('partial controller'))) {
    return 'partial';
  }
  return 'none';
}

const ENTITES_HTML: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  ndash: '–',
  mdash: '—',
  rsquo: '’',
  lsquo: '‘',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Décode les entités HTML usuelles et numériques. */
export function decodeEntities(value: string): string {
  return value.replace(
    /&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]+);/gi,
    (match, raw: string) => {
      if (raw[0] === '#') {
        const hexadecimal = raw[1] === 'x' || raw[1] === 'X';
        const code = Number.parseInt(raw.slice(hexadecimal ? 2 : 1), hexadecimal ? 16 : 10);
        if (Number.isInteger(code) && code >= 0 && code <= 0x10ffff) {
          try {
            return String.fromCodePoint(code);
          } catch {
            return match;
          }
        }
        return match;
      }
      return ENTITES_HTML[raw.toLowerCase()] ?? match;
    },
  );
}

/** Retire toutes les balises, décode les entités et normalise les espaces. */
function nettoyerTexte(value: string): string {
  return decodeEntities(value.replace(/<[^>]*>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vérifie qu'une chaîne est une URL HTTP(S) exploitable côté front. */
export function estUrlHttp(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

type SteamPlatforms = {
  windows?: boolean;
  mac?: boolean;
  linux?: boolean;
};

/**
 * Convertit la description HTML de Steam en blocs de texte sûrs.
 *
 * Le front ne reçoit jamais de HTML : les balises de structure deviennent des
 * paragraphes, titres ou listes, les balises inline sont retirées et les
 * entités sont décodées. Les balises inconnues (script, style, img, iframe)
 * sont supprimées comme n'importe quelle balise.
 */
export function htmlToBlocks(html: string | undefined): DescriptionBlock[] {
  if (!html) return [];

  const propre = html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, ' ');

  const tokens = propre.split(
    /(<\/?(?:p|div|br|h[1-4]|ul|ol|li)\b[^>]*>)/gi,
  );
  const blocks: DescriptionBlock[] = [];
  let mode: 'paragraphe' | 'titre' | 'liste' | null = null;
  let texte = '';
  let items: string[] = [];

  const viderTexte = () => {
    const contenu = nettoyerTexte(texte);
    texte = '';
    if (!contenu) return;
    if (mode === 'titre') {
      blocks.push({ type: 'titre', texte: contenu });
    } else if (mode === 'liste') {
      items.push(contenu);
    } else {
      blocks.push({ type: 'paragraphe', texte: contenu });
    }
  };

  const viderListe = () => {
    if (items.length > 0) {
      blocks.push({ type: 'liste', items });
      items = [];
    }
    mode = null;
  };

  for (const token of tokens) {
    if (!token) continue;
    const bas = token.toLowerCase();

    if (/^<br\s*\/?>$/.test(bas)) {
      if (mode === 'liste') {
        texte += ' ';
      } else {
        viderTexte();
        mode = null;
      }
      continue;
    }

    if (/^<li\b/.test(bas)) {
      viderTexte();
      if (mode !== 'liste') {
        viderListe();
        mode = 'liste';
      }
      continue;
    }

    if (bas.startsWith('</li>')) {
      viderTexte();
      continue;
    }

    if (bas.startsWith('<p') || bas.startsWith('<div')) {
      viderTexte();
      viderListe();
      mode = 'paragraphe';
      continue;
    }

    if (bas.startsWith('</p>') || bas.startsWith('</div>')) {
      viderTexte();
      mode = null;
      continue;
    }

    if (['<h1', '<h2', '<h3', '<h4'].some((tag) => bas.startsWith(tag))) {
      viderTexte();
      viderListe();
      mode = 'titre';
      continue;
    }

    if (['</h1>', '</h2>', '</h3>', '</h4>'].some((tag) => bas.startsWith(tag))) {
      viderTexte();
      mode = null;
      continue;
    }

    if (bas.startsWith('<ul') || bas.startsWith('<ol')) {
      viderTexte();
      viderListe();
      mode = 'liste';
      continue;
    }

    if (bas.startsWith('</ul>') || bas.startsWith('</ol>')) {
      viderTexte();
      viderListe();
      continue;
    }

    if (mode === null) mode = 'paragraphe';
    texte += token;
  }

  viderTexte();
  viderListe();
  return blocks;
}

/** Filtre, déduplique et limite les captures d'écran Steam. */
export function mapScreenshots(
  entries: Array<{ path_thumbnail?: string; path_full?: string }> | undefined,
): CaptureEcran[] {
  const captures: CaptureEcran[] = [];
  const dejaVu = new Set<string>();

  for (const entry of entries ?? []) {
    const miniature = entry.path_thumbnail?.trim();
    const pleine = entry.path_full?.trim();
    if (
      !miniature ||
      !pleine ||
      !estUrlHttp(miniature) ||
      !estUrlHttp(pleine) ||
      dejaVu.has(pleine)
    ) {
      continue;
    }
    dejaVu.add(pleine);
    captures.push({ miniature, pleine });
    if (captures.length >= MAX_SCREENSHOTS) break;
  }

  return captures;
}

/** Plateformes Steam, dans l'ordre d'affichage Windows → macOS → Linux. */
export function mapPlatforms(platforms: SteamPlatforms | undefined): Plateforme[] {
  const resultat: Plateforme[] = [];
  if (platforms?.windows) resultat.push('windows');
  if (platforms?.mac) resultat.push('mac');
  if (platforms?.linux) resultat.push('linux');
  return resultat;
}

function mapListeTextes(values: string[] | undefined): string[] {
  return [
    ...new Set(
      (values ?? [])
        .map((valeur) => valeur.trim())
        .filter((valeur) => valeur.length > 0),
    ),
  ];
}

function mapMetacritic(
  metacritic: { score?: number; url?: string } | undefined,
): { score: number; url: string | null } | null {
  const score = metacritic?.score;
  if (typeof score !== 'number' || !Number.isInteger(score)) return null;
  const url = metacritic?.url?.trim();
  return { score, url: url && estUrlHttp(url) ? url : null };
}

/**
 * Extrait les ids et les libellés d'un tableau de taxonomie Steam en gardant
 * les deux tableaux **alignés index par index** (les filtres utilisent les ids,
 * l'affichage et les embeddings utilisent les libellés).
 *
 * Les doublons d'id sont ignorés en conservant le premier libellé rencontré.
 */
function mapTaxonomie(
  entries: Array<{ id?: string | number; description?: string }> | undefined,
): { ids: number[]; labels: string[] } {
  const ids: number[] = [];
  const labels: string[] = [];
  const dejaVu = new Set<number>();

  for (const entry of entries ?? []) {
    const id = Number(entry.id);
    if (!Number.isInteger(id) || id <= 0 || dejaVu.has(id)) {
      continue;
    }
    dejaVu.add(id);
    ids.push(id);
    labels.push(entry.description?.trim() ?? '');
  }

  return { ids, labels };
}

export function mapAppDetails(
  appId: number,
  data: NonNullable<AppdetailsData['data']>,
): AppDetails {
  const genres = mapTaxonomie(data.genres);
  const categories = mapTaxonomie(data.categories);
  const metacritic = mapMetacritic(data.metacritic);
  const background = (data.background_raw ?? data.background)?.trim();
  const website = data.website?.trim();

  return {
    appId,
    name: data.name as string,
    shortDescription: data.short_description
      ? nettoyerTexte(data.short_description)
      : null,
    descriptionBlocks: htmlToBlocks(data.detailed_description),
    screenshots: mapScreenshots(data.screenshots),
    developers: mapListeTextes(data.developers),
    publishers: mapListeTextes(data.publishers),
    website: website && estUrlHttp(website) ? website : null,
    platforms: mapPlatforms(data.platforms),
    metacriticScore: metacritic?.score ?? null,
    metacriticUrl: metacritic?.url ?? null,
    backgroundImageUrl:
      background && estUrlHttp(background) ? background : null,
    genres: genres.labels,
    genreIds: genres.ids,
    categories: categories.labels,
    categoryIds: categories.ids,
    controllerSupport: mapControllerSupport(data),
    releaseDate: parseReleaseDate(data.release_date?.date),
    headerImageUrl: data.header_image ?? null,
  };
}

/** Concaténation d'une fiche `games` et de sa ligne `library_entries`. */
export interface UserGameDetail {
  id: number;
  appId: number;
  name: string;
  shortDescription: string | null;
  descriptionBlocks: DescriptionBlock[];
  screenshots: CaptureEcran[];
  developers: string[];
  publishers: string[];
  website: string | null;
  platforms: Plateforme[];
  metacriticScore: number | null;
  metacriticUrl: string | null;
  backgroundImageUrl: string | null;
  genres: string[];
  categories: string[];
  controllerSupport: 'none' | 'partial' | 'full';
  releaseDate: Date | null;
  headerImageUrl: string | null;
  playtimeForever: number;
  playtimeLast2Weeks: number;
  lastPlayedAt: Date | null;
  achievementsUnlocked: number;
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
        descriptionBlocks: details.descriptionBlocks,
        screenshots: details.screenshots,
        developers: details.developers,
        publishers: details.publishers,
        website: details.website ?? '',
        platforms: details.platforms,
        metacriticScore: details.metacriticScore,
        metacriticUrl: details.metacriticUrl,
        backgroundImageUrl: details.backgroundImageUrl,
        genres: details.genres,
        genreIds: details.genreIds,
        categories: details.categories,
        categoryIds: details.categoryIds,
        filtersVersion: FILTERS_VERSION,
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
          descriptionBlocks: details.descriptionBlocks,
          screenshots: details.screenshots,
          developers: details.developers,
          publishers: details.publishers,
          website: details.website ?? '',
          platforms: details.platforms,
          metacriticScore: details.metacriticScore,
          metacriticUrl: details.metacriticUrl,
          backgroundImageUrl: details.backgroundImageUrl,
          genres: details.genres,
          genreIds: details.genreIds,
          categories: details.categories,
          categoryIds: details.categoryIds,
          filtersVersion: FILTERS_VERSION,
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
    if (
      !row.shortDescription &&
      row.genres.length === 0 &&
      row.categories.length === 0
    ) {
      return null;
    }
    return {
      name: row.name,
      shortDescription: row.shortDescription ?? undefined,
      genres: row.genres,
      categories: row.categories,
    };
  }

  /**
   * Fiche d'un jeu de la bibliothèque de l'utilisateur (jointure
   * `library_entries ⋈ games`). Renvoie `null` si le jeu n'est pas possédé.
   */
  async userGameDetail(
    appId: number,
    userId: number,
  ): Promise<UserGameDetail | null> {
    const [row] = await this.db
      .select({
        id: games.id,
        appId: games.appId,
        name: games.name,
        shortDescription: games.shortDescription,
        descriptionBlocks: games.descriptionBlocks,
        screenshots: games.screenshots,
        developers: games.developers,
        publishers: games.publishers,
        website: games.website,
        platforms: games.platforms,
        metacriticScore: games.metacriticScore,
        metacriticUrl: games.metacriticUrl,
        backgroundImageUrl: games.backgroundImageUrl,
        genres: games.genres,
        categories: games.categories,
        controllerSupport: games.controllerSupport,
        releaseDate: games.releaseDate,
        headerImageUrl: games.headerImageUrl,
        playtimeForever: libraryEntries.playtimeForever,
        playtimeLast2Weeks: libraryEntries.playtimeLast2Weeks,
        lastPlayedAt: libraryEntries.lastPlayedAt,
        achievementsUnlocked: libraryEntries.achievementsUnlocked,
      })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(and(eq(games.appId, appId), eq(libraryEntries.userId, userId)))
      .limit(1);
    if (!row) return null;
    return {
      ...row,
      website: row.website || null,
      platforms: row.platforms as Plateforme[],
    };
  }
}
