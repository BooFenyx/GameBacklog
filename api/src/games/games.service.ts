import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import {
  games,
  libraryEntries,
  type CaptureEcran,
  type DescriptionBlock,
  type LastActivityPrecision,
  type LastActivitySource,
  type Plateforme,
} from '../db/schema.js';
import type { EmbeddingInput } from '../embedding/embedding.service.js';

const STEAM_STORE_APPDETAILS = 'https://store.steampowered.com/api/appdetails';
const EXTERNAL_CALL_TIMEOUT_MS = 5000;
const MAX_SCREENSHOTS = 6;
/** Backoff sans `Retry-After` : 5 s, 15 s puis 60 s. */
const RATE_LIMIT_BACKOFF_MS = [5_000, 15_000, 60_000];
const RATE_LIMIT_BACKOFF_MAX_MS = 5 * 60 * 1000;

/**
 * Version du mapping appliqué aux fiches. À incrémenter quand on ajoute un
 * champ dérivé de `appdetails` : le sync reprend alors les fiches dont la
 * version est inférieure (`SyncService.stepDetails`).
 *
 * La version 2 ajoute la description longue, les captures, les développeurs,
 * les éditeurs, le site, les plateformes, Metacritic et l'image de fond.
 * La version 3 retire le préambule commercial placé avant « À propos du jeu ».
 */
export const FILTERS_VERSION = 3;

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

/**
 * Résultat discriminé d'un appel `appdetails` : un 429 ne doit jamais être
 * confondu avec un jeu délisté ou une erreur réseau.
 */
export type ResultatFiche =
  | { kind: 'ok'; details: AppDetails }
  | { kind: 'rate-limit'; retryAfterMs: number }
  | { kind: 'removed' }
  | { kind: 'network' };

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
  [/f[eé]v|feb/i, 1],
  [/mars|mar/i, 2],
  [/avr|apr/i, 3],
  [/mai|may/i, 4],
  [/juin|jun/i, 5],
  [/juil|jul/i, 6],
  [/ao[uû]t|aug/i, 7],
  [/sept|sep/i, 8],
  [/oct/i, 9],
  [/nov/i, 10],
  [/d[eé]c|dec/i, 11],
];

/** Construit une date UTC et vérifie qu'aucun jour n'a été « reporté ». */
function dateUtcValide(annee: number, mois: number, jour: number): Date | null {
  const date = new Date(Date.UTC(annee, mois, jour));
  if (
    date.getUTCFullYear() !== annee ||
    date.getUTCMonth() !== mois ||
    date.getUTCDate() !== jour
  ) {
    return null;
  }
  return date;
}

/**
 * Parse une date de sortie Steam uniquement quand Steam fournit un **jour**
 * précis. Les dates partielles (`2023`, `Oct 2023`, `2023-10`, `Q1 2023`) ne
 * doivent pas être transformées en date exacte : on renvoie `null`, et la
 * fiche affiche l'année ou « date inconnue » plutôt qu'un jour inventé.
 *
 * Formats acceptés : ISO complet, `26 Oct, 2023`, `Oct 26, 2023`,
 * `26 oct. 2023`, `26/10/2023`, `26-10-2023`.
 */
export function parseReleaseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (/coming|bientôt|bientot|à venir/i.test(trimmed)) return null;

  const iso = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) {
    return dateUtcValide(Number(iso[1]), Number(iso[2]) - 1, Number(iso[3]));
  }

  const numerique = trimmed.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numerique) {
    return dateUtcValide(
      Number(numerique[3]),
      Number(numerique[2]) - 1,
      Number(numerique[1]),
    );
  }

  const jourMoisAnnee = trimmed.match(
    /^(\d{1,2})\s+([a-zàâäéèêëîïôöùûüç]+)\.?,?\s*,?\s*(\d{4})$/i,
  );
  const moisJourAnnee = trimmed.match(
    /^([a-zàâäéèêëîïôöùûüç]+)\.?\s+(\d{1,2})\s*,?\s*(\d{4})$/i,
  );
  const match = jourMoisAnnee ?? moisJourAnnee;
  if (!match) return null;

  const moisTexte = jourMoisAnnee ? match[2] : match[1];
  const jour = Number(jourMoisAnnee ? match[1] : match[2]);
  const annee = Number(match[3]);
  const mois = FRENCH_MONTHS.find(([regex]) => regex.test(moisTexte));
  if (!mois) return null;

  return dateUtcValide(annee, mois[1], jour);
}

/** Déduit le support manette du champ dédié puis des catégories Steam. */
export function mapControllerSupport(
  data: NonNullable<AppdetailsData['data']>,
): 'none' | 'partial' | 'full' {
  const direct = data.controller_support?.trim().toLowerCase();
  if (direct === 'full' || direct === 'partial' || direct === 'none') {
    return direct;
  }
  // Ids stables même quand `l=french` traduit les libellés :
  // 28 = Full controller support, 18 = Partial Controller Support.
  const ids = new Set(
    (data.categories ?? []).map((categorie) => Number(categorie.id)),
  );
  if (ids.has(28)) return 'full';
  if (ids.has(18)) return 'partial';
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
        const code = Number.parseInt(
          raw.slice(hexadecimal ? 2 : 1),
          hexadecimal ? 16 : 10,
        );
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

  const tokens = propre.split(/(<\/?(?:p|div|br|h[1-4]|ul|ol|li)\b[^>]*>)/gi);
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

    if (
      ['</h1>', '</h2>', '</h3>', '</h4>'].some((tag) => bas.startsWith(tag))
    ) {
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

/** Titre qui ouvre la vraie description éditoriale d'un jeu. */
const TITRE_A_PROPOS =
  /^\s*(?:à\s+propos\s+du\s+jeu|a\s+propos\s+du\s+jeu|about\s+(?:this|the)\s+game)\s*[:.!]?\s*$/i;

/**
 * Titres d'introduction commerciale : éditions, DLC, wishlist, Discord,
 * feuille de route, critiques… Steam les place parfois avant « À propos du jeu ».
 *
 * Volontairement restrictif : « mise à jour » / « update » n'en fait pas partie,
 * car ces sections décrivent du contenu réel du jeu et ne doivent pas être
 * supprimées (ex. Broforce, Make Way).
 */
const TITRE_PREAMBULE_COMMERCIAL =
  /(?<![\p{L}\p{N}_])(?:éditions?|editions?|deluxe|collector|ultimate|gold|anniversary|collections?|dlc|extension|add-?on|wishlist|souhaits?|discord|communaut[ée]|community|roadmap|feuille\s+de\s+route|reviews?|avis|workshop|pr[ée]commande|pre-?order|season\s+pass|pass\s+de\s+saison|offre\s+sp[ée]ciale|special\s+offers?|version\s+comparison|game\s+of\s+(?:a|the)\s+generation|our\s+games|you\s+might\s+(?:also\s+)?like|check\s+out|more\s+games|from\s+the\s+makers)(?![\p{L}\p{N}_])/iu;

/** Vrai si les blocs restants contiennent encore du texte descriptif réel. */
function contientTexteDescriptif(blocks: DescriptionBlock[]): boolean {
  const texte = blocks
    .map((bloc) => (bloc.type === 'liste' ? bloc.items.join(' ') : bloc.texte))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  return texte.length >= 40;
}

/**
 * Retire le préambule commercial que Steam place avant le titre
 * « À propos du jeu » (édition Deluxe, DLC, wishlist, Discord, roadmap…).
 *
 * La coupe n'est faite que si :
 * - un titre « À propos du jeu » / « About this game » existe ;
 * - il n'y a rien à couper (titre déjà en tête) ou le préambule est commercial :
 *   soit son premier bloc est un titre explicitement commercial, soit il n'est
 *   composé que de titres et l'un d'eux l'est (ex. « INTRODUCING… » puis
 *   « Join the Discord Community ») ;
 * - ce qui reste après la coupe contient encore du texte descriptif.
 *
 * Le titre d'ouverture « À propos du jeu » est retiré au passage : la page
 * affiche déjà ce titre de section, le garder produirait un doublon.
 *
 * Sinon les blocs sont renvoyés inchangés : mieux vaut garder un préambule que
 * supprimer la vraie description.
 */
export function retirerPreambuleCommercial(
  blocks: DescriptionBlock[],
): DescriptionBlock[] {
  const indexAbout = blocks.findIndex(
    (bloc) => bloc.type === 'titre' && TITRE_A_PROPOS.test(bloc.texte),
  );
  if (indexAbout < 0) return blocks;

  if (indexAbout > 0) {
    const preambule = blocks.slice(0, indexAbout);
    const premier = preambule[0];
    if (premier.type !== 'titre') return blocks;

    const premierEstCommercial = TITRE_PREAMBULE_COMMERCIAL.test(premier.texte);
    const seulementDesTitres = preambule.every((bloc) => bloc.type === 'titre');
    const titreCommercialDansPreambule = seulementDesTitres
      ? preambule.some(
          (bloc) =>
            bloc.type === 'titre' &&
            TITRE_PREAMBULE_COMMERCIAL.test(bloc.texte),
        )
      : false;

    if (!premierEstCommercial && !titreCommercialDansPreambule) return blocks;
  }

  // La page rend déjà un titre de section « À propos du jeu » : on retire le
  // titre Steam équivalent pour ne pas l'afficher deux fois de suite.
  const suite = blocks.slice(indexAbout).slice(1);
  return contientTexteDescriptif(suite) ? suite : blocks;
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
export function mapPlatforms(
  platforms: SteamPlatforms | undefined,
): Plateforme[] {
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
  const header = data.header_image?.trim();

  return {
    appId,
    name: data.name as string,
    shortDescription: data.short_description
      ? nettoyerTexte(data.short_description)
      : null,
    descriptionBlocks: retirerPreambuleCommercial(
      htmlToBlocks(data.detailed_description),
    ),
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
    headerImageUrl: header && estUrlHttp(header) ? header : null,
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
  /** Faux tant que `appdetails` n'a pas été récupéré : le support manette est inconnu. */
  detailsAvailable: boolean;
  /** Date seule `YYYY-MM-DD`, à minuit UTC côté base. */
  releaseDate: string | null;
  headerImageUrl: string | null;
  playtimeForever: number;
  playtimeLast2Weeks: number;
  /** Estimation d'activité dérivée, jamais une date exacte de partie. */
  lastActivityAt: Date | null;
  lastActivitySource: LastActivitySource | null;
  lastActivityPrecision: LastActivityPrecision | null;
  /** `null` tant que le schéma Steam n'a pas été récupéré. */
  achievementsTotal: number | null;
  /** `null` tant que la progression du joueur n'a pas été récupérée. */
  achievementsUnlocked: number | null;
}

/** Lit `Retry-After` (secondes ou date HTTP) et renvoie un délai en ms. */
export function lireRetryAfter(headers: Headers | undefined): number | null {
  const valeur = headers?.get('retry-after')?.trim();
  if (!valeur) return null;
  if (/^\d+$/.test(valeur)) return Number(valeur) * 1000;
  const date = Date.parse(valeur);
  if (Number.isNaN(date)) return null;
  return Math.max(0, date - Date.now());
}

/** Backoff exponentiel borné quand Steam ne fournit pas `Retry-After`. */
export function backoffRateLimitMs(tentative: number): number {
  const index = Math.min(
    Math.max(0, Math.trunc(tentative)),
    RATE_LIMIT_BACKOFF_MS.length - 1,
  );
  return Math.min(RATE_LIMIT_BACKOFF_MS[index], RATE_LIMIT_BACKOFF_MAX_MS);
}

@Injectable()
export class GamesService {
  private readonly logger = new Logger(GamesService.name);

  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Récupère la fiche Steam d'un jeu. Ne lève jamais : renvoie un résultat
   * discriminé pour que l'import distingue un 429, un jeu délisté et une erreur
   * réseau. `tentative` ne sert qu'à calculer le backoff sans `Retry-After`.
   */
  async fetchAppDetails(appId: number, tentative = 0): Promise<ResultatFiche> {
    const url = `${STEAM_STORE_APPDETAILS}?appids=${appId}&l=french`;
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
      if (response.status === 429) {
        const retryAfterMs =
          lireRetryAfter(response.headers) ?? backoffRateLimitMs(tentative);
        this.logger.warn(
          `appdetails ${appId} limité (429), nouvel essai dans ${retryAfterMs} ms`,
        );
        return { kind: 'rate-limit', retryAfterMs };
      }
      if (response.status === 404 || response.status === 410) {
        // Fiche supprimée du Store : ce n'est pas une erreur réseau
        // transitoire. Elle doit pouvoir entrer en quarantaine.
        return { kind: 'removed' };
      }
      if (!response.ok) {
        this.logger.warn(`appdetails a répondu ${response.status}`);
        return { kind: 'network' };
      }
      const body = (await response.json()) as Record<string, AppdetailsData>;
      const entry = body[String(appId)];
      if (!entry?.success || !entry.data?.name) {
        return { kind: 'removed' };
      }
      return { kind: 'ok', details: mapAppDetails(appId, entry.data) };
    } catch (error) {
      this.logger.warn(
        `appdetails ${appId} injoignable: ${error instanceof Error ? error.message : 'erreur inconnue'}`,
      );
      return { kind: 'network' };
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
        detailsAttempts: 0,
        detailsNextRetryAt: null,
        detailsLastError: null,
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
          detailsAttempts: 0,
          detailsNextRetryAt: null,
          detailsLastError: null,
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
        detailsFetchedAt: games.detailsFetchedAt,
        releaseDate: games.releaseDate,
        headerImageUrl: games.headerImageUrl,
        playtimeForever: libraryEntries.playtimeForever,
        playtimeLast2Weeks: libraryEntries.playtimeLast2Weeks,
        lastActivityAt: libraryEntries.lastActivityAt,
        lastActivitySource: libraryEntries.lastActivitySource,
        lastActivityPrecision: libraryEntries.lastActivityPrecision,
        achievementsTotal: games.achievementsTotal,
        gameAchievementsFetchedAt: games.achievementsFetchedAt,
        achievementsUnlocked: libraryEntries.achievementsUnlocked,
        progressFetchedAt: libraryEntries.achievementsFetchedAt,
      })
      .from(libraryEntries)
      .innerJoin(games, eq(libraryEntries.gameId, games.id))
      .where(and(eq(games.appId, appId), eq(libraryEntries.userId, userId)))
      .limit(1);
    if (!row) return null;
    const {
      gameAchievementsFetchedAt,
      progressFetchedAt,
      detailsFetchedAt,
      releaseDate,
      ...reste
    } = row;
    return {
      ...reste,
      detailsAvailable: detailsFetchedAt !== null,
      releaseDate: releaseDate ? releaseDate.toISOString().slice(0, 10) : null,
      website: row.website || null,
      platforms: row.platforms as Plateforme[],
      achievementsTotal: gameAchievementsFetchedAt
        ? row.achievementsTotal
        : null,
      achievementsUnlocked: progressFetchedAt ? row.achievementsUnlocked : null,
    };
  }
}
