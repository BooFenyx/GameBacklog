import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { DB, type Db } from '../db/db.module.js';
import {
  GamesService,
  mapControllerSupport,
  parseReleaseDate,
} from './games.service.js';

function fakeDb(returnedId = 7) {
  const insert = vi.fn();
  const update = vi.fn();
  const select = vi.fn();
  const values = vi.fn();
  const onConflictDoUpdate = vi.fn();
  const returning = vi.fn();
  const from = vi.fn();
  const whereChain = vi.fn();
  const limit = vi.fn();

  insert.mockReturnValue({ values });
  values.mockReturnValue({ onConflictDoUpdate });
  onConflictDoUpdate.mockReturnValue({ returning });
  returning.mockResolvedValue([{ id: returnedId }]);
  select.mockReturnValue({ from });
  from.mockReturnValue({ where: whereChain });
  whereChain.mockReturnValue({ limit });
  limit.mockResolvedValue([]);

  return {
    db: { insert, select, update } as unknown as Db,
    insert,
    values,
    onConflictDoUpdate,
    returning,
    whereChain,
    limit,
  };
}

const DATA_FULL = {
  name: 'Portal 2',
  short_description: '<b>Résolvez</b> des énigmes.',
  genres: [{ description: 'Puzzle' }],
  categories: [{ description: 'Single-player' }, { description: 'Full controller support' }],
  controller_support: 'full',
  release_date: { date: '26 oct. 2023' },
  header_image: 'https://cdn/header.jpg',
};

describe('parseReleaseDate', () => {
  it('parse une date anglaise', () => {
    const date = parseReleaseDate('26 Oct, 2023');
    expect(date?.getFullYear()).toBe(2023);
    expect(date?.getMonth()).toBe(9);
  });

  it('parse une date française', () => {
    const date = parseReleaseDate('26 oct. 2023');
    expect(date?.getFullYear()).toBe(2023);
    expect(date?.getMonth()).toBe(9);
  });

  it('renvoie null pour une date inconnue ou à venir', () => {
    expect(parseReleaseDate(undefined)).toBeNull();
    expect(parseReleaseDate('')).toBeNull();
    expect(parseReleaseDate('Coming soon')).toBeNull();
    expect(parseReleaseDate('à venir')).toBeNull();
  });
});

describe('mapControllerSupport', () => {
  it('donne la priorité au champ dédié', () => {
    expect(mapControllerSupport({ controller_support: 'full' } as never)).toBe('full');
    expect(mapControllerSupport({ controller_support: 'partial' } as never)).toBe('partial');
    expect(mapControllerSupport({ controller_support: 'none' } as never)).toBe('none');
  });

  it('se replie sur les catégories', () => {
    expect(
      mapControllerSupport({
        categories: [{ description: 'Full controller support' }],
      } as never),
    ).toBe('full');
    expect(
      mapControllerSupport({
        categories: [{ description: 'Partial Controller Support' }],
      } as never),
    ).toBe('partial');
    expect(
      mapControllerSupport({ categories: [{ description: 'Single-player' }] } as never),
    ).toBe('none');
  });
});

describe('GamesService', () => {
  let service: GamesService;

  beforeEach(async () => {
    const fake = fakeDb();
    const module: TestingModule = await Test.createTestingModule({
      providers: [GamesService, { provide: DB, useValue: fake.db }],
    }).compile();
    service = module.get<GamesService>(GamesService);
    (service as unknown as { __fake?: unknown }).__fake = fake;
  });

  const faireDbFake = () =>
    (service as unknown as { __fake: ReturnType<typeof fakeDb> }).__fake;

  it('upsertFromDetails persiste tous les champs et renvoie l’id', async () => {
    const { values, returning } = faireDbFake();
    const id = await service.upsertFromDetails({
      appId: 620,
      name: 'Portal 2',
      shortDescription: 'Résolvez des énigmes.',
      genres: ['Puzzle'],
      categories: ['Single-player', 'Full controller support'],
      controllerSupport: 'full',
      releaseDate: new Date('2023-10-26'),
      headerImageUrl: 'https://cdn/header.jpg',
    });
    expect(id).toBe(7);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 620,
        name: 'Portal 2',
        controllerSupport: 'full',
        detailsFetchedAt: expect.any(Date),
      }),
    );
    expect(returning).toHaveBeenCalled();
  });

  it('fetchAppDetails : null si la fiche est absente ou en échec', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    global.fetch = mockFetch;
    await expect(service.fetchAppDetails(123)).resolves.toBeNull();
  });

  it('fetchAppDetails : null si le Store répond ok:false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 620: { success: false } }),
    });
    global.fetch = mockFetch;
    await expect(service.fetchAppDetails(620)).resolves.toBeNull();
  });

  it('fetchAppDetails : parsifie la fiche complète', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 620: { success: true, data: DATA_FULL } }),
    });
    global.fetch = mockFetch;

    const details = await service.fetchAppDetails(620);
    expect(details).toMatchObject({
      appId: 620,
      name: 'Portal 2',
      shortDescription: 'Résolvez des énigmes.',
      genres: ['Puzzle'],
      controllerSupport: 'full',
      releaseDate: expect.any(Date),
      headerImageUrl: 'https://cdn/header.jpg',
    });
  });

  it('embeddingInputFor : null si aucune matière descriptive', async () => {
    const { whereChain, limit } = faireDbFake();
    limit.mockResolvedValue([
      { name: 'PixelJunk' as string, shortDescription: null as string | null, genres: [] as string[], categories: [] as string[] },
    ]);
    const input = await service.embeddingInputFor(999);
    expect(input).toBeNull();
    expect(whereChain).toHaveBeenCalled();
  });

  it('embeddingInputFor : texte d’entrée depuis la fiche', async () => {
    const { limit } = faireDbFake();
    limit.mockResolvedValue([
      { name: 'Portal 2' as string, shortDescription: 'Des énigmes.' as string | null, genres: ['Puzzle'] as string[], categories: ['Co-op'] as string[] },
    ]);
    const input = await service.embeddingInputFor(620);
    expect(input).toMatchObject({
      name: 'Portal 2',
      shortDescription: 'Des énigmes.',
      genres: ['Puzzle'],
    });
  });
});