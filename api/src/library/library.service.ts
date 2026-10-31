import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { construireConditions } from '../catalog/filters.js';
import {
  agregerFacettes,
  type FacetRow,
  type FacettesBibliotheque,
} from '../catalog/facets.js';
import { modesDepuisCategories, type ModeJeu } from '../catalog/modes.js';
import { DB, type Db } from '../db/db.module.js';
import type {
  LastActivityPrecision,
  LastActivitySource,
} from '../db/schema.js';
import type { TriBibliotheque } from './dto/library-query.dto.js';

/** Base de la Steam Web API (authentifiée par `STEAM_API_KEY`). */
const STEAM_API_BASE = 'https://api.steampowered.com';
/** Abandon d'un appel externe après 5 s pour ne pas laisser la requête suspendue. */
const EXTERNAL_CALL_TIMEOUT_MS = 5000;

/** Jeu renvoyé au front pour la page bibliothèque. */
export interface BibliothequeGame {
  appId: number;
  name: string;
  /** Temps de jeu total en minutes (source `GetOwnedGames`). */
  playtimeForever: number;
  /** Temps de jeu sur les deux dernières semaines, en minutes. */
  playtimeLast2Weeks: number;
}

/** Jeu persisté en base (`library_entries ⋈ games`), enrichi pour la page. */
export interface BibliothequeGamePersiste extends BibliothequeGame {
  genres: string[];
  /** Modes dérivés des catégories Steam (solo, multi, coop…). */
  modes: ModeJeu[];
  controllerSupport: 'none' | 'partial' | 'full';
  /** Estimation d'activité dérivée, jamais une date exacte de partie. */
  lastActivityAt: Date | null;
  lastActivitySource: LastActivitySource | null;
  lastActivityPrecision: LastActivityPrecision | null;
  headerImageUrl: string | null;
  /** `null` tant que le schéma Steam n'a pas été récupéré. */
  achievementsTotal: number | null;
  /** `null` tant que la progression du joueur n'a pas été récupérée. */
  achievementsUnlocked: number | null;
}

/** Filtres, tri et pagination de `GET /api/library`. */
export interface BibliothequeQuery {
  q?: string;
  genres?: number[];
  modes?: ModeJeu[];
  manette?: 'full';
  etat?: 'jamais' | 'joue';
  duree?: ('0-2' | '2-10' | '10-50' | '50plus')[];
  tri: TriBibliotheque;
  limit: number;
  offset: number;
}

/** Page renvoyée au front : les filtres sont appliqués côté SQL. */
export interface BibliothequePage {
  items: BibliothequeGamePersiste[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

/** Ligne brute de la requête paginée. */
interface BibliothequeRow {
  appId: number;
  name: string;
  headerImageUrl: string | null;
  genres: string[] | null;
  categoryIds: number[] | null;
  controllerSupport: 'none' | 'partial' | 'full';
  playtimeForever: number;
  playtimeLast2Weeks: number;
  lastActivityAt: Date | null;
  lastActivitySource: LastActivitySource | null;
  lastActivityPrecision: LastActivityPrecision | null;
  achievementsUnlocked: number | null;
  achievementsTotal: number | null;
  total: string | number;
}

/** Forme de la réponse de `IPlayerService/GetOwnedGames`. */
interface GetOwnedGamesResponse {
  response?: {
    game_count?: number;
    games?: Array<{
      appid: number;
      name?: string;
      playtime_forever?: number;
      /** Champ réel de l'API Steam (14 derniers jours). */
      playtime_2weeks?: number;
    }>;
  };
}

@Injectable()
export class LibraryService {
  private readonly logger = new Logger(LibraryService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(DB) private readonly db: Db,
  ) {}

  /**
   * Bibliothèque persistée de l'utilisateur (`library_entries ⋈ games`), filtrée,
   * triée et paginée. Les jeux ne sont récupérés depuis Steam qu'à l'import
   * (voir `SyncService`) : cette lecture ne recontacte jamais Steam.
   */
  async savedLibrary(
    userId: number,
    query: BibliothequeQuery,
  ): Promise<BibliothequePage> {
    const params: unknown[] = [userId];
    const conditions = ['le.user_id = $1'];

    const q = query.q?.trim();
    if (q) {
      params.push(q);
      conditions.push(`strpos(lower(g.name), lower($${params.length})) > 0`);
    }

    conditions.push(...construireConditions(query, params));

    // Une ligne de plus que la page demandée pour calculer `hasMore` sans
    // requête COUNT supplémentaire ; `total` vient de la fenêtre SQL.
    const limitIndex = params.length + 1;
    params.push(query.limit + 1);
    const offsetIndex = params.length + 1;
    params.push(query.offset);

    const sql = `
      SELECT
        g.app_id AS "appId",
        g.name,
        g.header_image_url AS "headerImageUrl",
        g.genres,
        g.category_ids AS "categoryIds",
        g.controller_support AS "controllerSupport",
        le.playtime_forever AS "playtimeForever",
        le.playtime_last_2_weeks AS "playtimeLast2Weeks",
        le.last_activity_at AS "lastActivityAt",
        le.last_activity_source AS "lastActivitySource",
        le.last_activity_precision AS "lastActivityPrecision",
        CASE
          WHEN le.achievements_fetched_at IS NULL THEN NULL
          ELSE le.achievements_unlocked
        END AS "achievementsUnlocked",
        CASE
          WHEN g.achievements_fetched_at IS NULL THEN NULL
          ELSE g.achievements_total
        END AS "achievementsTotal",
        COUNT(*) OVER() AS total
      FROM library_entries le
      JOIN games g ON g.id = le.game_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY ${this.orderBy(query.tri)}
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const result = await this.db.$client.query(sql, params);
    const rows = result.rows as BibliothequeRow[];
    const hasMore = rows.length > query.limit;
    const page = rows.slice(0, query.limit);
    const total = rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0;

    return {
      items: page.map((row) => ({
        appId: row.appId,
        name: row.name,
        headerImageUrl: row.headerImageUrl,
        genres: row.genres ?? [],
        modes: modesDepuisCategories(row.categoryIds ?? []),
        controllerSupport: row.controllerSupport,
        playtimeForever: row.playtimeForever,
        playtimeLast2Weeks: row.playtimeLast2Weeks,
        lastActivityAt: row.lastActivityAt,
        lastActivitySource: row.lastActivitySource,
        lastActivityPrecision: row.lastActivityPrecision,
        achievementsUnlocked: row.achievementsUnlocked,
        achievementsTotal: row.achievementsTotal,
      })),
      total,
      limit: query.limit,
      offset: query.offset,
      hasMore,
    };
  }

  /**
   * Compteurs des filtres de la bibliothèque (genres, modes, manette, état,
   * durée). Une seule lecture, agrégée en mémoire : pas de requête par facette.
   */
  async facets(userId: number): Promise<FacettesBibliotheque> {
    const result = await this.db.$client.query(
      `
        SELECT
          g.genre_ids AS "genreIds",
          g.genres,
          g.category_ids AS "categoryIds",
          g.controller_support AS "controllerSupport",
          le.playtime_forever AS "playtimeForever",
          le.last_activity_at AS "lastActivityAt"
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1
      `,
      [userId],
    );

    return agregerFacettes(result.rows as FacetRow[]);
  }

  /** Clause `ORDER BY` d'une page de bibliothèque (valeurs contrôlées). */
  private orderBy(tri: TriBibliotheque): string {
    switch (tri) {
      case 'temps':
        return 'le.playtime_forever DESC, lower(g.name), g.app_id';
      case 'recent':
        return 'le.last_activity_at DESC NULLS LAST, le.playtime_last_2_weeks DESC, lower(g.name), g.app_id';
      case 'nom':
      default:
        return 'lower(g.name), g.app_id';
    }
  }

  /**
   * Récupère les jeux possédés d'un joueur (`GetOwnedGames`) et les renvoie
   * triés par nom. La clé Steam reste côté serveur : jamais transmise au front.
   */
  async ownedGames(steamId: string): Promise<BibliothequeGame[]> {
    const key = this.config.get<string>('STEAM_API_KEY');
    if (!key) {
      throw new ServiceUnavailableException(
        'STEAM_API_KEY absente : import Steam impossible',
      );
    }

    const url =
      `${STEAM_API_BASE}/IPlayerService/GetOwnedGames/v1/` +
      `?key=${encodeURIComponent(key)}&steamid=${encodeURIComponent(steamId)}` +
      '&include_appinfo=true&include_played_free_games=true&format=json';

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(EXTERNAL_CALL_TIMEOUT_MS),
      });
    } catch (error) {
      this.logger.error('Steam injoignable', error as Error);
      throw new ServiceUnavailableException('Steam est injoignable');
    }

    if (!response.ok) {
      // 401/403 : profil privé ou clé invalide.
      this.logger.warn(`GetOwnedGames a répondu ${response.status}`);
      throw new ServiceUnavailableException(
        `Steam a refusé l'accès (${response.status}) : profil privé ou clé invalide`,
      );
    }

    const data = (await response.json()) as GetOwnedGamesResponse;

    return (data.response?.games ?? [])
      .filter((game) => typeof game.name === 'string' && game.name.length > 0)
      .map((game) => ({
        appId: game.appid,
        name: game.name as string,
        playtimeForever: game.playtime_forever ?? 0,
        playtimeLast2Weeks: game.playtime_2weeks ?? 0,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, 'fr'));
  }
}
