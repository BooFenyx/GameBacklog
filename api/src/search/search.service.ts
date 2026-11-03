import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  construireConditions,
  construireCriteres,
} from '../catalog/filters.js';
import { libellesGenresUtilisateur } from '../catalog/genres.js';
import { modesDepuisCategories, type ModeJeu } from '../catalog/modes.js';
import { DB, type Db } from '../db/db.module.js';
import type {
  LastActivityPrecision,
  LastActivitySource,
} from '../db/schema.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { QuotaReachedError } from '../embedding/rate-limiter.service.js';
import type { SearchMode, SearchQueryDto } from './dto/search-query.dto.js';
import { QueryEmbeddingCacheService } from './query-embedding-cache.service.js';

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
  /** Modes dérivés des catégories Steam. */
  modes: ModeJeu[];
  playtimeForever: number;
  lastActivityAt: Date | string | null;
  lastActivitySource: LastActivitySource | null;
  lastActivityPrecision: LastActivityPrecision | null;
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
  total: number;
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
  categoryIds: number[] | null;
  controllerSupport: 'none' | 'partial' | 'full';
  playtimeForever: number;
  lastActivityAt: Date | string | null;
  lastActivitySource: LastActivitySource | null;
  lastActivityPrecision: LastActivityPrecision | null;
  total: string | number;
}

/** Ligne brute renvoyée par la requête vectorielle. */
interface SemanticSearchRow extends NameSearchRow {
  score: number;
  seriesMatch: number;
}

const DEFAULT_EMBEDDING_MAX_WAIT_MS = 1500;
const DEGRADED_MESSAGE =
  'Recherche sémantique indisponible : résultats par nom.';

@Injectable()
export class SearchService {
  constructor(
    @Inject(DB) private readonly db: Db,
    private readonly embedding: EmbeddingService,
    private readonly cache: QueryEmbeddingCacheService,
    private readonly config: ConfigService,
  ) {}

  /** Point d'entrée unique appelé par le contrôleur. */
  search(userId: number, dto: SearchQueryDto): Promise<SearchResponse> {
    return dto.mode === 'semantic'
      ? this.searchSemantic(userId, dto)
      : this.searchByName(userId, dto);
  }

  /**
   * Recherche par nom dans la bibliothèque de l'utilisateur. `strpos` effectue
   * une recherche littérale : les `%` et `_` saisis ne sont pas des jokers.
   * Le classement privilégie l'égalité, puis le préfixe, puis la présence.
   * Les filtres communs (genres, modes, manette, état, durée) sont appliqués
   * dans la même requête.
   */
  async searchByName(
    userId: number,
    dto: SearchQueryDto,
  ): Promise<SearchResponse> {
    const q = dto.q.trim();
    const params: unknown[] = [userId, q];
    const conditions = [
      'le.user_id = $1',
      'strpos(lower(g.name), lower($2)) > 0',
    ];
    conditions.push(...construireConditions(dto, params));

    const criteres = await this.criteresPour(userId, dto);

    const paramsFiltres = [...params];

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
        g.category_ids AS "categoryIds",
        g.controller_support AS "controllerSupport",
        le.playtime_forever AS "playtimeForever",
        le.last_activity_at AS "lastActivityAt",
        le.last_activity_source AS "lastActivitySource",
        le.last_activity_precision AS "lastActivityPrecision",
        COUNT(*) OVER() AS total
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
    let total = rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0;
    if (rows.length === 0 && dto.offset > 0) {
      total = await this.compterResultatsNom(conditions, paramsFiltres);
    }

    return {
      mode: 'name',
      results: rows
        .slice(0, dto.limit)
        .map((row) => this.toNameResult(row, criteres)),
      offset: dto.offset,
      limit: dto.limit,
      hasMore,
      total,
      degraded: false,
    };
  }

  /** COUNT de secours quand OFFSET dépasse la fin des résultats par nom. */
  private async compterResultatsNom(
    conditions: string[],
    params: unknown[],
  ): Promise<number> {
    const result = await this.db.$client.query(
      `SELECT COUNT(*)::int AS total
       FROM library_entries le
       JOIN games g ON g.id = le.game_id
       WHERE ${conditions.join('\n       AND ')}`,
      params,
    );
    return Number(
      (result.rows[0] as { total?: string | number } | undefined)?.total ?? 0,
    );
  }

  /**
   * COUNT de secours pour la recherche sémantique. Les paramètres `$1`
   * (vecteur) et `$3` (référence) sont référencés pour respecter le nombre de
   * paramètres déjà liés, même s'ils ne filtrent pas le COUNT.
   */
  private async compterResultatsSemantiques(
    conditions: string[],
    params: unknown[],
  ): Promise<number> {
    const result = await this.db.$client.query(
      `SELECT COUNT(*)::int AS total
       FROM library_entries le
       JOIN games g ON g.id = le.game_id
       WHERE ${conditions.join('\n       AND ')}
         AND ($1::vector IS NOT NULL)
         AND ($3::text IS NULL OR $3::text IS NOT NULL)`,
      params,
    );
    return Number(
      (result.rows[0] as { total?: string | number } | undefined)?.total ?? 0,
    );
  }

  /**
   * Recherche sémantique : embedding de la requête puis tri cosinus dans la
   * bibliothèque. Un jeu cité dans la phrase permet de remonter les titres qui
   * s'en rapprochent. Tout échec d'embedding bascule en repli par nom.
   */
  private async searchSemantic(
    userId: number,
    dto: SearchQueryDto,
  ): Promise<SearchResponse> {
    const q = dto.q.trim();

    let vector: number[] | null;
    try {
      vector = await this.cache.getOrCompute(q, () =>
        this.embedding.embed(q, {
          maxWaitMs: this.embeddingMaxWaitMs(),
          userId,
        }),
      );
    } catch (error) {
      if (error instanceof QuotaReachedError) {
        return this.degraded(userId, dto, q);
      }
      throw error;
    }

    if (!vector) {
      return this.degraded(userId, dto, q);
    }

    const criteres = await this.criteresPour(userId, dto);
    const reference = await this.findReferencedGameName(userId, q);
    return this.querySemantic(userId, dto, vector, reference, criteres);
  }

  private async querySemantic(
    userId: number,
    dto: SearchQueryDto,
    vector: number[],
    reference: string | null,
    criteres: string[],
  ): Promise<SearchResponse> {
    const conditions = ['le.user_id = $2', 'g.embedding IS NOT NULL'];
    const params: unknown[] = [JSON.stringify(vector), userId, reference];

    conditions.push(...construireConditions(dto, params));

    const minScore = this.minScore();
    if (minScore !== null) {
      const index = params.length + 1;
      conditions.push(`1 - (g.embedding <=> $1::vector) >= $${index}`);
      params.push(minScore);
    }

    const paramsFiltres = [...params];

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
        g.category_ids AS "categoryIds",
        g.controller_support AS "controllerSupport",
        le.playtime_forever AS "playtimeForever",
        le.last_activity_at AS "lastActivityAt",
        le.last_activity_source AS "lastActivitySource",
        le.last_activity_precision AS "lastActivityPrecision",
        1 - (g.embedding <=> $1::vector) AS score,
        CASE
          WHEN $3::text IS NOT NULL
            AND strpos(lower(g.name), lower($3)) > 0
          THEN 1 ELSE 0
        END AS "seriesMatch",
        COUNT(*) OVER() AS total
      FROM library_entries le
      JOIN games g ON g.id = le.game_id
      WHERE ${conditions.join('\n        AND ')}
      ORDER BY
        CASE
          WHEN $3::text IS NOT NULL
            AND strpos(lower(g.name), lower($3)) > 0
          THEN 1 ELSE 0
        END DESC,
        1 - (g.embedding <=> $1::vector) DESC,
        g.app_id
      LIMIT $${limitIndex} OFFSET $${offsetIndex}
    `;

    const result = await this.db.$client.query(sql, params);
    const rows = result.rows as SemanticSearchRow[];
    const hasMore = rows.length > dto.limit;
    let total = rows.length > 0 ? Number(rows[0]?.total ?? 0) : 0;
    if (rows.length === 0 && dto.offset > 0) {
      total = await this.compterResultatsSemantiques(conditions, paramsFiltres);
    }

    return {
      mode: 'semantic',
      results: rows.slice(0, dto.limit).map((row) => {
        const isSeries = Number(row.seriesMatch) > 0;
        const rowCriteria = [...criteres];
        if (isSeries && reference) {
          rowCriteria.push(`Se rapproche de ${reference}`);
        }
        return {
          ...this.toCommonResult(row),
          score: Number(row.score),
          source: isSeries ? 'series' : 'semantic',
          criteria: rowCriteria,
        };
      }),
      offset: dto.offset,
      limit: dto.limit,
      hasMore,
      total,
      degraded: false,
    };
  }

  /**
   * Repli dégradé : recherche par nom du jeu cité s'il y en a un, sinon de la
   * requête entière. Les résultats restent paginés et filtrables.
   */
  private async degraded(
    userId: number,
    dto: SearchQueryDto,
    q: string,
  ): Promise<SearchResponse> {
    const reference = await this.findReferencedGameName(userId, q);
    const requeteNom = reference ?? q;
    const dtoNom: SearchQueryDto = {
      q: requeteNom,
      mode: 'name',
      limit: dto.limit,
      offset: dto.offset,
      genres: dto.genres,
      modes: dto.modes,
      manette: dto.manette,
      etat: dto.etat,
      duree: dto.duree,
    };
    const response = await this.searchByName(userId, dtoNom);

    return {
      ...response,
      mode: 'semantic',
      degraded: true,
      message: DEGRADED_MESSAGE,
    };
  }

  /**
   * Cherche le plus long nom de jeu de la bibliothèque présent dans la requête.
   * C'est la référence utilisée pour rapprocher les titres d'une même série.
   */
  private async findReferencedGameName(
    userId: number,
    q: string,
  ): Promise<string | null> {
    const result = await this.db.$client.query(
      `
        SELECT g.name
        FROM library_entries le
        JOIN games g ON g.id = le.game_id
        WHERE le.user_id = $1
          AND length(g.name) >= 4
          AND strpos(lower($2), lower(g.name)) > 0
        ORDER BY length(g.name) DESC, g.name
        LIMIT 1
      `,
      [userId, q],
    );
    const row = result.rows[0] as { name: string } | undefined;
    return row?.name ?? null;
  }

  /**
   * Critères lisibles des filtres actifs, communs à tous les résultats.
   * Les libellés de genres sont lus dans la bibliothèque de l'utilisateur.
   */
  private async criteresPour(
    userId: number,
    dto: SearchQueryDto,
  ): Promise<string[]> {
    const libelles = await libellesGenresUtilisateur(
      this.db,
      userId,
      dto.genres,
    );
    return construireCriteres(dto, libelles);
  }
  private embeddingMaxWaitMs(): number {
    const raw = this.config.get<string | number>(
      'SEARCH_EMBEDDING_MAX_WAIT_MS',
    );
    const parsed =
      raw === undefined || String(raw).trim() === ''
        ? DEFAULT_EMBEDDING_MAX_WAIT_MS
        : Number(raw);
    return Number.isFinite(parsed) && parsed >= 0
      ? parsed
      : DEFAULT_EMBEDDING_MAX_WAIT_MS;
  }

  private minScore(): number | null {
    const raw = this.config.get<string | number>('SEARCH_MIN_SCORE');
    if (raw === undefined || String(raw).trim() === '') {
      return null;
    }
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  private toNameResult(row: NameSearchRow, criteria: string[]): SearchResult {
    return {
      ...this.toCommonResult(row),
      score: null,
      source: 'name',
      criteria: [...criteria],
    };
  }

  private toCommonResult(
    row: NameSearchRow,
  ): Omit<SearchResult, 'score' | 'source' | 'criteria'> {
    return {
      appId: row.appId,
      name: row.name,
      shortDescription: row.shortDescription,
      headerImageUrl: row.headerImageUrl,
      genres: row.genres ?? [],
      controllerSupport: row.controllerSupport,
      modes: modesDepuisCategories(row.categoryIds ?? []),
      playtimeForever: row.playtimeForever,
      lastActivityAt: row.lastActivityAt,
      lastActivitySource: row.lastActivitySource,
      lastActivityPrecision: row.lastActivityPrecision,
    };
  }
}
