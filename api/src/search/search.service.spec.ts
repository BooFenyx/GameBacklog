import 'reflect-metadata';
import type { ConfigService } from '@nestjs/config';
import type { Db } from '../db/db.module.js';
import type { EmbeddingService } from '../embedding/embedding.service.js';
import { QuotaReachedError } from '../embedding/rate-limiter.service.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import type { QueryEmbeddingCacheService } from './query-embedding-cache.service.js';
import { SearchService, type SearchResponse } from './search.service.js';

interface NameSearchRow {
  appId: number;
  name: string;
  shortDescription: string | null;
  headerImageUrl: string | null;
  genres: string[] | null;
  categoryIds: number[] | null;
  controllerSupport: 'none' | 'partial' | 'full';
  playtimeForever: number;
  lastPlayedAt: Date | string | null;
  total: string | number;
}

interface SemanticSearchRow extends NameSearchRow {
  score: number;
  seriesMatch: number;
}

const VECTOR = [1, 0, 0];

function dto(overrides: Partial<SearchQueryDto> = {}): SearchQueryDto {
  return Object.assign(new SearchQueryDto(), {
    q: 'portal',
    mode: 'name',
    limit: 20,
    offset: 0,
    ...overrides,
  });
}

function ligne(overrides: Partial<NameSearchRow> = {}): NameSearchRow {
  return {
    appId: 400,
    name: 'Portal',
    shortDescription: 'Des énigmes dans un centre de recherche.',
    headerImageUrl: 'https://cdn/portal.jpg',
    genres: ['Puzzle'],
    categoryIds: [2],
    controllerSupport: 'full',
    playtimeForever: 320,
    lastPlayedAt: new Date('2024-01-02T03:04:05.000Z'),
    total: 1,
    ...overrides,
  };
}

function ligneSemantique(
  overrides: Partial<SemanticSearchRow> = {},
): SemanticSearchRow {
  return {
    ...ligne(),
    score: 0.9,
    seriesMatch: 0,
    ...overrides,
  };
}

interface ServiceOptions {
  config?: Record<string, string | number>;
}

function makeService(options: ServiceOptions = {}) {
  const query = vi.fn();
  const db = { $client: { query } } as unknown as Db;
  const embed = vi.fn();
  const embedding = { embed } as unknown as EmbeddingService;
  const getOrCompute = vi.fn(
    async (
      _text: string,
      compute: () => Promise<number[] | null>,
    ): Promise<number[] | null> => compute(),
  );
  const cache = { getOrCompute } as unknown as QueryEmbeddingCacheService;
  const config = {
    get: vi.fn((key: string) => options.config?.[key]),
  } as unknown as ConfigService;
  const service = new SearchService(db, embedding, cache, config);

  return { service, query, embed, getOrCompute, config };
}

function reponseNom(): SearchResponse {
  return {
    mode: 'name',
    results: [],
    offset: 0,
    limit: 20,
    hasMore: false,
    total: 0,
    degraded: false,
  };
}

describe('SearchService — recherche par nom', () => {
  it('mappe la ligne brute vers le résultat d’API', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [ligne()] });

    const reponse = await service.searchByName(7, dto());

    expect(reponse).toEqual({
      mode: 'name',
      results: [
        {
          appId: 400,
          name: 'Portal',
          shortDescription: 'Des énigmes dans un centre de recherche.',
          headerImageUrl: 'https://cdn/portal.jpg',
          genres: ['Puzzle'],
          controllerSupport: 'full',
          modes: ['solo'],
          playtimeForever: 320,
          lastPlayedAt: new Date('2024-01-02T03:04:05.000Z'),
          score: null,
          source: 'name',
          criteria: [],
        },
      ],
      offset: 0,
      limit: 20,
      hasMore: false,
      total: 1,
      degraded: false,
    });
  });

  it('dispatche le mode nom depuis le point d’entrée', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    const reponse = await service.search(7, dto({ mode: 'name' }));

    expect(reponse.mode).toBe('name');
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('filtre sur la bibliothèque et classe égalité, préfixe puis présence', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    await service.searchByName(7, dto());

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('le.user_id = $1');
    expect(sql).toContain('strpos(lower(g.name), lower($2)) > 0');
    expect(sql).toContain('WHEN lower(g.name) = lower($2) THEN 0');
    expect(sql).toContain('WHEN strpos(lower(g.name), lower($2)) = 1 THEN 1');
    expect(params).toEqual([7, 'portal', 21, 0]);
  });

  it('traite les jokers SQL comme des caractères littéraux', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    await service.searchByName(7, dto({ q: '100%_test' }));

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('LIKE');
    expect(params).toContain('100%_test');
  });

  it('demande une ligne de plus et tronque pour calculer hasMore', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({
      rows: [ligne(), ligne({ appId: 401 }), ligne({ appId: 402 })],
    });

    const reponse = await service.searchByName(7, dto({ limit: 2 }));

    expect(reponse.results).toHaveLength(2);
    expect(reponse.hasMore).toBe(true);
  });

  it('renvoie hasMore false quand toute la page tient', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [ligne()] });

    const reponse = await service.searchByName(7, dto({ limit: 20 }));

    expect(reponse.results).toHaveLength(1);
    expect(reponse.hasMore).toBe(false);
  });

  it('transmet l’offset et renvoie la pagination demandée', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    const reponse = await service.searchByName(7, dto({ offset: 40 }));

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7, 'portal', 21, 40]);
    expect(reponse.offset).toBe(40);
  });

  it('ajoute le filtre manette complète et son critère', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [ligne()] });

    const reponse = await service.searchByName(7, dto({ manette: 'full' }));

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("g.controller_support = 'full'");
    expect(reponse.results[0]?.criteria).toEqual(['Manette complète']);
  });

  it('trim la requête avant de la transmettre', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    await service.searchByName(7, dto({ q: '  portal  ' }));

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe('portal');
  });

  it('applique le filtre genres et expose les libellés dans les critères', async () => {
    const { service, query } = makeService();
    query
      .mockResolvedValueOnce({
        rows: [{ genreIds: [25], genres: ['Aventure'] }],
      })
      .mockResolvedValueOnce({
        rows: [ligne({ genres: ['Aventure'], categoryIds: [2] })],
      });

    const reponse = await service.searchByName(7, dto({ genres: [25] }));

    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('g.genre_ids && $3::int[]');
    expect(params[2]).toEqual([25]);
    expect(reponse.results[0]?.criteria).toEqual(['Genre : Aventure']);
  });

  it('applique le filtre modes avec les ids Steam correspondants', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    await service.searchByName(7, dto({ modes: ['coop'] }));

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('g.category_ids && $3::int[]');
    expect(params[2]).toEqual([9, 38, 39, 48]);
  });

  it('applique les filtres état et durée', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [] });

    await service.searchByName(7, dto({ etat: 'joue', duree: ['2-10'] }));

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('le.playtime_forever > 0');
    expect(sql).toContain(
      'le.playtime_forever >= 120 AND le.playtime_forever < 600',
    );
  });

  it('renvoie le total calculé par la fenêtre SQL', async () => {
    const { service, query } = makeService();
    query.mockResolvedValue({ rows: [ligne({ total: '12' })] });

    const reponse = await service.searchByName(7, dto());

    expect(reponse.total).toBe(12);
  });
});

describe('SearchService — recherche sémantique', () => {
  it('embedde la requête, interroge pgvector et mappe le score', async () => {
    const { service, query, embed } = makeService();
    embed.mockResolvedValue(VECTOR);
    query
      .mockResolvedValueOnce({ rows: [{ name: 'Portal' }] })
      .mockResolvedValueOnce({
        rows: [ligneSemantique({ score: 0.9123, seriesMatch: 1 })],
      });

    const reponse = await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu comme Portal' }),
    );

    expect(embed).toHaveBeenCalledWith('jeu comme Portal', {
      maxWaitMs: 1500,
    });
    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain('g.embedding <=> $1::vector');
    expect(sql).toContain('seriesMatch');
    expect(params).toEqual([JSON.stringify(VECTOR), 7, 'Portal', 21, 0]);
    expect(reponse.mode).toBe('semantic');
    expect(reponse.results[0]).toMatchObject({
      score: 0.9123,
      source: 'series',
      criteria: ['Se rapproche de Portal'],
    });
    expect(reponse.degraded).toBe(false);
  });

  it('conserve un score négatif sans le clamper', async () => {
    const { service, query, embed } = makeService();
    embed.mockResolvedValue(VECTOR);
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [ligneSemantique({ score: -0.2, seriesMatch: 0 })],
    });

    const reponse = await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu calme' }),
    );

    expect(reponse.results[0]?.score).toBe(-0.2);
    expect(reponse.results[0]?.source).toBe('semantic');
    const [, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params[2]).toBeNull();
  });

  it('applique le filtre manette et le seuil de score', async () => {
    const { service, query, embed } = makeService({
      config: { SEARCH_MIN_SCORE: '0.4' },
    });
    embed.mockResolvedValue(VECTOR);
    query
      .mockResolvedValueOnce({ rows: [{ name: 'Portal' }] })
      .mockResolvedValueOnce({ rows: [] });

    await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu comme Portal', manette: 'full' }),
    );

    const [sql, params] = query.mock.calls[1] as [string, unknown[]];
    expect(sql).toContain("g.controller_support = 'full'");
    expect(sql).toContain('>= $4');
    expect(params).toEqual([JSON.stringify(VECTOR), 7, 'Portal', 0.4, 21, 0]);
  });

  it('pagine les résultats sémantiques comme les résultats par nom', async () => {
    const { service, query, embed } = makeService();
    embed.mockResolvedValue(VECTOR);
    query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({
      rows: [
        ligneSemantique({ appId: 1 }),
        ligneSemantique({ appId: 2 }),
        ligneSemantique({ appId: 3 }),
      ],
    });

    const reponse = await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu calme', limit: 2 }),
    );

    expect(reponse.results).toHaveLength(2);
    expect(reponse.hasMore).toBe(true);
  });

  it('bascule en repli quand l’embedding est indisponible', async () => {
    const { service, query, embed } = makeService();
    embed.mockResolvedValue(null);
    query.mockResolvedValueOnce({ rows: [{ name: 'Portal' }] });
    const repli = vi
      .spyOn(service, 'searchByName')
      .mockResolvedValue(reponseNom());

    const reponse = await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu comme Portal' }),
    );

    expect(repli).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ q: 'Portal', mode: 'name' }),
    );
    expect(reponse).toMatchObject({
      mode: 'semantic',
      degraded: true,
      message: expect.stringContaining('indisponible'),
    });
  });

  it('bascule en repli quand le quota Gemini est atteint', async () => {
    const { service, query, embed } = makeService();
    embed.mockRejectedValue(new QuotaReachedError());
    query.mockResolvedValueOnce({ rows: [{ name: 'Portal' }] });
    const repli = vi
      .spyOn(service, 'searchByName')
      .mockResolvedValue(reponseNom());

    const reponse = await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu comme Portal' }),
    );

    expect(repli).toHaveBeenCalled();
    expect(reponse.degraded).toBe(true);
  });

  it('utilise la requête entière en repli sans jeu cité', async () => {
    const { service, query, embed } = makeService();
    embed.mockResolvedValue(null);
    query.mockResolvedValueOnce({ rows: [] });
    const repli = vi
      .spyOn(service, 'searchByName')
      .mockResolvedValue(reponseNom());

    await service.search(7, dto({ mode: 'semantic', q: 'jeu très calme' }));

    expect(repli).toHaveBeenCalledWith(
      7,
      expect.objectContaining({ q: 'jeu très calme' }),
    );
  });

  it('retombe sur 1500 ms si la configuration d’attente est invalide', async () => {
    const { service, query, embed } = makeService({
      config: { SEARCH_EMBEDDING_MAX_WAIT_MS: 'beaucoup' },
    });
    embed.mockResolvedValue(VECTOR);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await service.search(7, dto({ mode: 'semantic', q: 'jeu calme' }));

    expect(embed).toHaveBeenCalledWith('jeu calme', { maxWaitMs: 1500 });
  });

  it('transmet l’offset à la requête vectorielle', async () => {
    const { service, query, embed } = makeService();
    embed.mockResolvedValue(VECTOR);
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [] });

    await service.search(
      7,
      dto({ mode: 'semantic', q: 'jeu calme', offset: 40 }),
    );

    const [, params] = query.mock.calls[1] as [string, unknown[]];
    expect(params).toEqual([JSON.stringify(VECTOR), 7, null, 21, 40]);
  });
});
