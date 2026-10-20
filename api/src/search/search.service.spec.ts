import 'reflect-metadata';
import type { Db } from '../db/db.module.js';
import { SearchQueryDto } from './dto/search-query.dto.js';
import { SearchService } from './search.service.js';

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
    controllerSupport: 'full',
    playtimeForever: 320,
    lastPlayedAt: new Date('2024-01-02T03:04:05.000Z'),
    ...overrides,
  };
}

function fakeDb(rows: NameSearchRow[]) {
  const query = vi.fn().mockResolvedValue({ rows });
  return {
    db: { $client: { query } } as unknown as Db,
    query,
  };
}

describe('SearchService — recherche par nom', () => {
  it('mappe la ligne brute vers le résultat d’API', async () => {
    const { db } = fakeDb([ligne()]);
    const service = new SearchService(db);

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
          playtimeForever: 320,
          lastPlayedAt: new Date('2024-01-02T03:04:05.000Z'),
          score: null,
          source: 'name',
          criteria: ['Dans ta bibliothèque'],
        },
      ],
      offset: 0,
      limit: 20,
      hasMore: false,
      degraded: false,
    });
  });

  it('filtre sur la bibliothèque et classe égalité, préfixe puis présence', async () => {
    const { db, query } = fakeDb([]);
    const service = new SearchService(db);

    await service.searchByName(7, dto());

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain('le.user_id = $1');
    expect(sql).toContain('strpos(lower(g.name), lower($2)) > 0');
    expect(sql).toContain('WHEN lower(g.name) = lower($2) THEN 0');
    expect(sql).toContain('WHEN strpos(lower(g.name), lower($2)) = 1 THEN 1');
    expect(params).toEqual([7, 'portal', 21, 0]);
  });

  it('traite les jokers SQL comme des caractères littéraux', async () => {
    const { db, query } = fakeDb([]);
    const service = new SearchService(db);

    await service.searchByName(7, dto({ q: '100%_test' }));

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).not.toContain('LIKE');
    expect(params).toContain('100%_test');
  });

  it('demande une ligne de plus et tronque pour calculer hasMore', async () => {
    const { db } = fakeDb([
      ligne(),
      ligne({ appId: 401 }),
      ligne({ appId: 402 }),
    ]);
    const service = new SearchService(db);

    const reponse = await service.searchByName(7, dto({ limit: 2 }));

    expect(reponse.results).toHaveLength(2);
    expect(reponse.hasMore).toBe(true);
  });

  it('renvoie hasMore false quand toute la page tient', async () => {
    const { db } = fakeDb([ligne()]);
    const service = new SearchService(db);

    const reponse = await service.searchByName(7, dto({ limit: 20 }));

    expect(reponse.results).toHaveLength(1);
    expect(reponse.hasMore).toBe(false);
  });

  it('transmet l’offset et renvoie la pagination demandée', async () => {
    const { db, query } = fakeDb([]);
    const service = new SearchService(db);

    const reponse = await service.searchByName(7, dto({ offset: 40 }));

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params).toEqual([7, 'portal', 21, 40]);
    expect(reponse.offset).toBe(40);
  });

  it('ajoute le filtre manette complète', async () => {
    const { db, query } = fakeDb([]);
    const service = new SearchService(db);

    const reponse = await service.searchByName(7, dto({ manette: 'full' }));

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("g.controller_support = 'full'");
    expect(reponse.results).toEqual([]);
  });

  it('accepte le support partiel comme au moins partiel', async () => {
    const { db, query } = fakeDb([ligne({ controllerSupport: 'partial' })]);
    const service = new SearchService(db);

    const reponse = await service.searchByName(7, dto({ manette: 'partial' }));

    const [sql] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("g.controller_support IN ('partial', 'full')");
    expect(reponse.results[0]?.criteria).toEqual([
      'Dans ta bibliothèque',
      'Manette partielle ou complète',
    ]);
  });

  it('trim la requête avant de la transmettre', async () => {
    const { db, query } = fakeDb([]);
    const service = new SearchService(db);

    await service.searchByName(7, dto({ q: '  portal  ' }));

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect(params[1]).toBe('portal');
  });
});
