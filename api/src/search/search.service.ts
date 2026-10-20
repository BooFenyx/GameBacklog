import { Inject, Injectable } from '@nestjs/common';
import { DB, type Db } from '../db/db.module.js';
import type { SearchMode, SearchQueryDto } from './dto/search-query.dto.js';

/** Provenance d'un résultat de recherche. */
export type SearchResultSource = 'name' | 'semantic' | 'series';

/** Résultat renvoyé au front, commun aux deux modes. */
export interface SearchResult {
  appId: number;
  name: string;
  shortDescription: string | null;
  headerImageUrl: string | null;
  genres: string[];
  controllerSupport: 'none' | 'partial' | 'full';
  playtimeForever: number;
  lastPlayedAt: Date | string | null;
  score: number | null;
  source: SearchResultSource;
  criteria: string[];
}

/** Enveloppe de réponse de `GET /api/search`. */
export interface SearchResponse {
  mode: SearchMode;
  results: SearchResult[];
  offset: number;
  limit: number;
  hasMore: boolean;
  degraded: boolean;
  message?: string;
}

/** Ligne brute renvoyée par la requête de recherche par nom. */
interface NameSearchRow {
  appId: number;
  name: string;
  shortDescription: string | null;
  headerImageUrl: string | null;
  genres: string[] | null;
  controllerSupport: 'none' | 'partial' | 'full';
  playtimeForever: number;
  lastPlayedAt: Date | string | null;
}

@Injectable()
export class SearchService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Recherche par nom dans la bibliothèque de l'utilisateur. `strpos` effectue
   * une recherche littérale : les `%` et `_` saisis ne sont pas des jokers.
   * Le classement privilégie l'égalité, puis le préfixe, puis la présence.
   */
  async searchByName(
    userId: number,
    dto: SearchQueryDto,
  ): Promise<SearchResponse> {
    const q = dto.q.trim();
    const conditions = [
      'le.user_id = $1',
      'strpos(lower(g.name), lower($2)) > 0',
    ];
    const criteria = ['Dans ta bibliothèque'];
    const params: unknown[] = [userId, q];

    if (dto.manette === 'full') {
      conditions.push("g.controller_support = 'full'");
      criteria.push('Manette complète');
    } else if (dto.manette === 'partial') {
      conditions.push("g.controller_support IN ('partial', 'full')");
      criteria.push('Manette partielle ou complète');
    }

    // On demande une ligne de plus que la page pour calculer `hasMore` sans
    // exécuter une requête COUNT supplémentaire.
    const limitIndex = params.length + 1;
    params.push(dto.limit + 1);
    const offsetIndex = params.length + 1;
    params.push(dto.offset);

    const sql = `
      SELECT
        g.app_id AS "appId",
        g.name,
        g.short_description AS "shortDescription",
        g.header_image_url AS "headerImageUrl",
        g.genres,
        g.controller_support AS "controllerSupport",
        le.playtime_forever AS "playtimeForever",
        le.last_played_at AS "lastPlayedAt"
      FROM library_entries le
      JOIN games g ON g.id = le.game_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY
        CASE
          WHEN lower(g.name) = lower($2) THEN 0
          WHEN strpos(lower(g.name), lower($2)) = 1 THEN 1
          ELSE 2
        END,
        length(g.name),
        g.name
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const result = await this.db.$client.query(sql, params);
    const rows = result.rows as NameSearchRow[];
    const hasMore = rows.length > dto.limit;

    return {
      mode: 'name',
      results: rows
        .slice(0, dto.limit)
        .map((row) => this.toNameResult(row, criteria)),
      offset: dto.offset,
      limit: dto.limit,
      hasMore,
      degraded: false,
    };
  }

  private toNameResult(row: NameSearchRow, criteria: string[]): SearchResult {
    return {
      appId: row.appId,
      name: row.name,
      shortDescription: row.shortDescription,
      headerImageUrl: row.headerImageUrl,
      genres: row.genres ?? [],
      controllerSupport: row.controllerSupport,
      playtimeForever: row.playtimeForever,
      lastPlayedAt: row.lastPlayedAt,
      score: null,
      source: 'name',
      criteria: [...criteria],
    };
  }
}
