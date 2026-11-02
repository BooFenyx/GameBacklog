import { Test, TestingModule } from '@nestjs/testing';
import { vi } from 'vitest';
import { DB, type Db } from '../db/db.module.js';
import {
  FILTERS_VERSION,
  GamesService,
  decodeEntities,
  htmlToBlocks,
  mapAppDetails,
  mapControllerSupport,
  mapPlatforms,
  mapScreenshots,
  parseReleaseDate,
  retirerPreambuleCommercial,
} from './games.service.js';

function fakeDb(returnedId = 7) {
  const insert = vi.fn();
  const update = vi.fn();
  const select = vi.fn();
  const values = vi.fn();
  const onConflictDoUpdate = vi.fn();
  const returning = vi.fn();
  const from = vi.fn();
  const innerJoin = vi.fn();
  const whereChain = vi.fn();
  const limit = vi.fn();

  insert.mockReturnValue({ values });
  values.mockReturnValue({ onConflictDoUpdate });
  onConflictDoUpdate.mockReturnValue({ returning });
  returning.mockResolvedValue([{ id: returnedId }]);
  select.mockReturnValue({ from });
  from.mockReturnValue({ where: whereChain, innerJoin });
  innerJoin.mockReturnValue({ where: whereChain });
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

/** Récupère une fiche et échoue explicitement si Steam ne l'a pas renvoyée. */
async function ficheOk(service: GamesService, appId: number) {
  const resultat = await service.fetchAppDetails(appId);
  if (resultat.kind !== 'ok') {
    throw new Error(`fiche ${appId} non récupérée: ${resultat.kind}`);
  }
  return resultat.details;
}

const DATA_FULL = {
  name: 'Portal 2',
  short_description: '<b>Résolvez</b> des énigmes.',
  detailed_description:
    '<p>Bonjour &amp; bienvenue.</p><h3>Points forts</h3><ul><li>Un</li><li>Deux</li></ul>',
  developers: ['Valve'],
  publishers: ['Valve'],
  website: 'https://www.thinkwithportals.com/',
  screenshots: [
    {
      path_thumbnail: 'https://cdn.example/mini.jpg',
      path_full: 'https://cdn.example/full.jpg',
    },
  ],
  background_raw: 'https://cdn.example/background.jpg',
  platforms: { windows: true, mac: false, linux: true },
  metacritic: { score: 95, url: 'https://www.metacritic.com/game/pc/portal-2' },
  genres: [
    { id: '1', description: 'Action' },
    { id: '25', description: 'Aventure' },
  ],
  categories: [
    { id: 2, description: 'Solo' },
    { id: 28, description: 'Compat. contrôleurs complète' },
  ],
  controller_support: 'full',
  release_date: { date: '26 oct. 2023' },
  header_image: 'https://cdn/header.jpg',
};

describe('parseReleaseDate', () => {
  it('parse une date anglaise à minuit UTC', () => {
    const date = parseReleaseDate('26 Oct, 2023');
    expect(date?.getUTCFullYear()).toBe(2023);
    expect(date?.getUTCMonth()).toBe(9);
    expect(date?.getUTCDate()).toBe(26);
    expect(date?.toISOString()).toBe('2023-10-26T00:00:00.000Z');
  });

  it('parse une date française à minuit UTC', () => {
    const date = parseReleaseDate('26 oct. 2023');
    expect(date?.getUTCFullYear()).toBe(2023);
    expect(date?.getUTCMonth()).toBe(9);
    expect(date?.getUTCDate()).toBe(26);
  });

  it('parse les dates françaises abrégées', () => {
    expect(parseReleaseDate('18 avr. 2011')?.toISOString()).toBe(
      '2011-04-18T00:00:00.000Z',
    );
    expect(parseReleaseDate('4 sept. 2025')?.toISOString()).toBe(
      '2025-09-04T00:00:00.000Z',
    );
  });

  it('accepte déjà une date ISO', () => {
    expect(parseReleaseDate('2011-04-18')?.toISOString()).toBe(
      '2011-04-18T00:00:00.000Z',
    );
  });

  it('renvoie null pour une date inconnue ou à venir', () => {
    expect(parseReleaseDate(undefined)).toBeNull();
    expect(parseReleaseDate('')).toBeNull();
    expect(parseReleaseDate('Coming soon')).toBeNull();
    expect(parseReleaseDate('Bientôt disponible')).toBeNull();
    expect(parseReleaseDate('à venir')).toBeNull();
  });
});

describe('mapControllerSupport', () => {
  it('donne la priorité au champ dédié', () => {
    expect(mapControllerSupport({ controller_support: 'full' } as never)).toBe(
      'full',
    );
    expect(
      mapControllerSupport({ controller_support: 'partial' } as never),
    ).toBe('partial');
    expect(mapControllerSupport({ controller_support: 'none' } as never)).toBe(
      'none',
    );
  });

  it('se replie sur les ids de catégories traduites', () => {
    expect(
      mapControllerSupport({
        categories: [
          { id: 28, description: 'Compat. contrôleurs complète' },
        ],
      } as never),
    ).toBe('full');
    expect(
      mapControllerSupport({
        categories: [
          { id: 18, description: 'Compat. partielle des contrôleurs' },
        ],
      } as never),
    ).toBe('partial');
  });

  it('privilégie le support complet quand les deux ids sont présents', () => {
    expect(
      mapControllerSupport({
        categories: [
          { id: 18, description: 'Compat. partielle des contrôleurs' },
          { id: 28, description: 'Compat. contrôleurs complète' },
        ],
      } as never),
    ).toBe('full');
  });

  it('renvoie none sans catégorie ou avec un libellé anglais sans id', () => {
    expect(mapControllerSupport({} as never)).toBe('none');
    expect(
      mapControllerSupport({
        categories: [{ description: 'Full controller support' }],
      } as never),
    ).toBe('none');
  });
});

describe('decodeEntities', () => {
  it('décode les entités nommées et numériques', () => {
    expect(decodeEntities('A &amp; B &lt; C &#39;ok&#39; &#x1F600;')).toBe(
      "A & B < C 'ok' 😀",
    );
  });
});

describe('htmlToBlocks', () => {
  it('convertit les paragraphes et les br', () => {
    expect(htmlToBlocks('<p>Bonjour</p><p>Monde</p>')).toEqual([
      { type: 'paragraphe', texte: 'Bonjour' },
      { type: 'paragraphe', texte: 'Monde' },
    ]);
    expect(htmlToBlocks('Un<br><br>Deux')).toEqual([
      { type: 'paragraphe', texte: 'Un' },
      { type: 'paragraphe', texte: 'Deux' },
    ]);
  });

  it('convertit les titres et les listes', () => {
    expect(
      htmlToBlocks('<h3>Points forts</h3><ul><li>Un</li><li>Deux</li></ul>'),
    ).toEqual([
      { type: 'titre', texte: 'Points forts' },
      { type: 'liste', items: ['Un', 'Deux'] },
    ]);
  });

  it('retire les balises inline et décode les entités', () => {
    expect(
      htmlToBlocks('<p><strong>Bonjour</strong> &amp; <a href="#">lien</a></p>'),
    ).toEqual([{ type: 'paragraphe', texte: 'Bonjour & lien' }]);
  });

  it('supprime les balises dangereuses', () => {
    expect(
      htmlToBlocks('<p>Texte</p><script>alert(1)</script><img onerror="x">'),
    ).toEqual([{ type: 'paragraphe', texte: 'Texte' }]);
  });

  it('renvoie un tableau vide pour une entrée absente', () => {
    expect(htmlToBlocks(undefined)).toEqual([]);
    expect(htmlToBlocks('')).toEqual([]);
  });
});

describe('mapScreenshots', () => {
  it('filtre les URL invalides, déduplique et limite à 6', () => {
    const captures = mapScreenshots(
      Array.from({ length: 8 }, (_, index) => ({
        path_thumbnail: `https://cdn.example/${index}.mini.jpg`,
        path_full: `https://cdn.example/${index}.full.jpg`,
      })).concat([
        // URL invalide
        {
          path_thumbnail: 'pas-une-url',
          path_full: 'pas-une-url',
        },
        // doublon
        {
          path_thumbnail: 'https://cdn.example/0.mini.jpg',
          path_full: 'https://cdn.example/0.full.jpg',
        },
      ]),
    );
    expect(captures).toHaveLength(6);
    expect(captures[0]).toEqual({
      miniature: 'https://cdn.example/0.mini.jpg',
      pleine: 'https://cdn.example/0.full.jpg',
    });
  });
});

describe('mapPlatforms', () => {
  it('respecte l’ordre Windows, macOS, Linux', () => {
    expect(
      mapPlatforms({ windows: true, mac: true, linux: true }),
    ).toEqual(['windows', 'mac', 'linux']);
    expect(mapPlatforms({ linux: true, windows: false })).toEqual(['linux']);
    expect(mapPlatforms(undefined)).toEqual([]);
  });
});

describe('mapAppDetails', () => {
  it('mappe les champs riches et les valeurs par défaut', () => {
    const details = mapAppDetails(620, DATA_FULL);
    expect(details.descriptionBlocks).toEqual([
      { type: 'paragraphe', texte: 'Bonjour & bienvenue.' },
      { type: 'titre', texte: 'Points forts' },
      { type: 'liste', items: ['Un', 'Deux'] },
    ]);
    expect(details.screenshots).toHaveLength(1);
    expect(details.developers).toEqual(['Valve']);
    expect(details.publishers).toEqual(['Valve']);
    expect(details.website).toBe('https://www.thinkwithportals.com/');
    expect(details.platforms).toEqual(['windows', 'linux']);
    expect(details.metacriticScore).toBe(95);
    expect(details.metacriticUrl).toContain('metacritic.com');
    expect(details.backgroundImageUrl).toBe(
      'https://cdn.example/background.jpg',
    );
    expect(details.releaseDate?.toISOString()).toBe('2023-10-26T00:00:00.000Z');
  });

  it('conserve une image d’en-tête HTTP(S) valide', () => {
    const details = mapAppDetails(620, {
      name: 'Portal 2',
      header_image: 'https://cdn/header.jpg',
    });
    expect(details.headerImageUrl).toBe('https://cdn/header.jpg');
  });

  it('rejette une image d’en-tête vide ou non HTTP(S)', () => {
    expect(
      mapAppDetails(620, { name: 'Vide', header_image: '' }).headerImageUrl,
    ).toBeNull();
    expect(
      mapAppDetails(620, { name: 'Blanche', header_image: '   ' })
        .headerImageUrl,
    ).toBeNull();
    expect(
      mapAppDetails(620, { name: 'JS', header_image: 'javascript:alert(1)' })
        .headerImageUrl,
    ).toBeNull();
  });

  it('renvoie des valeurs vides quand les champs manquent', () => {
    const details = mapAppDetails(621, { name: 'Sans fiche' });
    expect(details.descriptionBlocks).toEqual([]);
    expect(details.screenshots).toEqual([]);
    expect(details.developers).toEqual([]);
    expect(details.publishers).toEqual([]);
    expect(details.website).toBeNull();
    expect(details.platforms).toEqual([]);
    expect(details.metacriticScore).toBeNull();
    expect(details.metacriticUrl).toBeNull();
    expect(details.backgroundImageUrl).toBeNull();
  });

  it('retire le préambule commercial avant « À propos du jeu »', () => {
    const details = mapAppDetails(1808500, {
      name: 'ARC Raiders',
      detailed_description:
        '<h3>ARC Raiders Deluxe Edition</h3><p>Includes the base game and cosmetics.</p><h3>À propos du jeu</h3><p>Un jeu d’extraction dans un monde futuriste ravagé par les ARC.</p>',
    });
    expect(details.descriptionBlocks).toEqual([
      {
        type: 'paragraphe',
        texte: 'Un jeu d’extraction dans un monde futuriste ravagé par les ARC.',
      },
    ]);
  });
});

describe('retirerPreambuleCommercial', () => {
  const paragrapheLong = {
    type: 'paragraphe' as const,
    texte:
      'Un long paragraphe qui décrit réellement le jeu, ses mécaniques, son monde et ses personnages.',
  };

  it('coupe avant « À propos du jeu » quand le premier titre est commercial', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'ARC Raiders Deluxe Edition' },
      { type: 'paragraphe' as const, texte: 'Includes the base game.' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toEqual([paragrapheLong]);
  });

  it('reconnaît les variantes anglaises et la casse', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'DIGITAL DELUXE EDITION' },
      { type: 'paragraphe' as const, texte: 'Includes the base game.' },
      { type: 'titre' as const, texte: 'ABOUT THIS GAME' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toEqual([paragrapheLong]);
  });

  it('reconnaît les pluriels et les renvois vers d’autres jeux', () => {
    expect(
      retirerPreambuleCommercial([
        { type: 'titre', texte: 'Explore our Special Editions!' },
        { type: 'titre', texte: 'À propos du jeu' },
        paragrapheLong,
      ]),
    ).toEqual([paragrapheLong]);

    expect(
      retirerPreambuleCommercial([
        { type: 'titre', texte: 'Our games you might like' },
        { type: 'titre', texte: 'À propos du jeu' },
        paragrapheLong,
      ]),
    ).toEqual([paragrapheLong]);
  });

  it('coupe un préambule composé uniquement de titres commerciaux', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'INTRODUCING: KING OF THE CASTLE' },
      { type: 'titre' as const, texte: 'Join the Discord Community' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toEqual([paragrapheLong]);
  });

  it('garde un titre non commercial isolé', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'Apex Legends : Traque' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toBe(blocs);
  });

  it('ne coupe pas sans titre « À propos »', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'Édition collector' },
      { type: 'paragraphe' as const, texte: 'Contenu de l’édition.' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toBe(blocs);
  });

  it('retire un titre « À propos » déjà en tête', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toEqual([paragrapheLong]);
  });

  it('ne coupe pas un vrai contenu de mise à jour', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'BROFORCE FOREVER' },
      { type: 'paragraphe' as const, texte: 'La mise à jour gratuite ajoute du contenu.' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toBe(blocs);
  });

  it('ne coupe pas si le reste ne contient plus de texte descriptif', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'ARC Raiders Deluxe Edition' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
    ];
    expect(retirerPreambuleCommercial(blocs)).toBe(blocs);
  });

  it('reconnaît les titres accentués commençant par « Édition »', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'Édition numérique de luxe' },
      { type: 'paragraphe' as const, texte: 'Cette édition comprend le jeu de base.' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toEqual([paragrapheLong]);
  });

  it('ne confond pas un mot contenant « edition » avec une édition', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'Expedition 33' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toBe(blocs);
  });

  it('ne confond pas un titre sur le studio avec « À propos du jeu »', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'Édition numérique de luxe' },
      { type: 'titre' as const, texte: 'À PROPOS DE HAZELIGHT' },
      paragrapheLong,
    ];
    expect(retirerPreambuleCommercial(blocs)).toBe(blocs);
  });

  it('est idempotent', () => {
    const blocs = [
      { type: 'titre' as const, texte: 'Édition numérique de luxe' },
      { type: 'paragraphe' as const, texte: 'Cette édition comprend le jeu de base.' },
      { type: 'titre' as const, texte: 'À propos du jeu' },
      paragrapheLong,
    ];
    const uneFois = retirerPreambuleCommercial(blocs);
    expect(retirerPreambuleCommercial(uneFois)).toEqual(uneFois);
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
    const { values, onConflictDoUpdate, returning } = faireDbFake();
    const id = await service.upsertFromDetails({
      appId: 620,
      name: 'Portal 2',
      shortDescription: 'Résolvez des énigmes.',
      descriptionBlocks: [{ type: 'paragraphe', texte: 'Bonjour' }],
      screenshots: [
        {
          miniature: 'https://cdn.example/mini.jpg',
          pleine: 'https://cdn.example/full.jpg',
        },
      ],
      developers: ['Valve'],
      publishers: ['Valve'],
      website: 'https://www.thinkwithportals.com/',
      platforms: ['windows', 'linux'],
      metacriticScore: 95,
      metacriticUrl: 'https://www.metacritic.com/game/pc/portal-2',
      backgroundImageUrl: 'https://cdn.example/background.jpg',
      genres: ['Action', 'Aventure'],
      genreIds: [1, 25],
      categories: ['Solo', 'Compat. contrôleurs complète'],
      categoryIds: [2, 28],
      controllerSupport: 'full',
      releaseDate: new Date('2023-10-26'),
      headerImageUrl: 'https://cdn/header.jpg',
    });
    expect(id).toBe(7);
    expect(values).toHaveBeenCalledWith(
      expect.objectContaining({
        appId: 620,
        name: 'Portal 2',
        descriptionBlocks: [{ type: 'paragraphe', texte: 'Bonjour' }],
        developers: ['Valve'],
        publishers: ['Valve'],
        platforms: ['windows', 'linux'],
        metacriticScore: 95,
        genreIds: [1, 25],
        categoryIds: [2, 28],
        filtersVersion: FILTERS_VERSION,
        controllerSupport: 'full',
        detailsFetchedAt: expect.any(Date),
        detailsAttempts: 0,
        detailsNextRetryAt: null,
        detailsLastError: null,
      }),
    );
    expect(onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        set: expect.objectContaining({
          detailsAttempts: 0,
          detailsNextRetryAt: null,
          detailsLastError: null,
        }),
      }),
    );
    expect(returning).toHaveBeenCalled();
  });

  it('fetchAppDetails convertit les ids Steam (chaînes ou nombres)', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 620: { success: true, data: DATA_FULL } }),
    });

    const details = await ficheOk(service, 620);

    expect(details.genreIds).toEqual([1, 25]);
    expect(details.genres).toEqual(['Action', 'Aventure']);
    expect(details.categoryIds).toEqual([2, 28]);
    expect(details.categories).toEqual([
      'Solo',
      'Compat. contrôleurs complète',
    ]);
  });

  it('fetchAppDetails ignore les ids invalides et dédoublonne par id', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        621: {
          success: true,
          data: {
            name: 'Test',
            genres: [
              { id: '1', description: 'Action' },
              { id: '1', description: 'Action (doublon)' },
              { id: 'abc', description: 'Invalide' },
              { id: '0', description: 'Zéro' },
              { id: '25', description: 'Aventure' },
            ],
            categories: [
              { id: 2, description: 'Solo' },
              { id: 2, description: 'Solo (doublon)' },
            ],
          },
        },
      }),
    });

    const details = await ficheOk(service, 621);

    expect(details.genreIds).toEqual([1, 25]);
    expect(details.genres).toEqual(['Action', 'Aventure']);
    expect(details.categoryIds).toEqual([2]);
    expect(details.categories).toEqual(['Solo']);
  });

  it('fetchAppDetails renvoie des tableaux vides quand Steam ne fournit rien', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        622: { success: true, data: { name: 'Sans taxonomie' } },
      }),
    });

    const details = await ficheOk(service, 622);

    expect(details.genreIds).toEqual([]);
    expect(details.genres).toEqual([]);
    expect(details.categoryIds).toEqual([]);
    expect(details.categories).toEqual([]);
  });

  it('fetchAppDetails : network si la fiche est absente ou en échec', async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 404 });
    global.fetch = mockFetch;
    await expect(service.fetchAppDetails(123)).resolves.toEqual({
      kind: 'network',
    });
  });

  it('fetchAppDetails : removed si le Store répond ok:false', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 620: { success: false } }),
    });
    global.fetch = mockFetch;
    await expect(service.fetchAppDetails(620)).resolves.toEqual({
      kind: 'removed',
    });
  });

  it('fetchAppDetails : rate-limit avec Retry-After', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ 'retry-after': '30' }),
    });
    await expect(service.fetchAppDetails(123)).resolves.toEqual({
      kind: 'rate-limit',
      retryAfterMs: 30_000,
    });
  });

  it('fetchAppDetails : rate-limit avec backoff sans Retry-After', async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers(),
    });
    const resultat = await service.fetchAppDetails(123, 1);
    expect(resultat.kind).toBe('rate-limit');
    if (resultat.kind === 'rate-limit') {
      expect(resultat.retryAfterMs).toBeGreaterThan(0);
    }
  });

  it('fetchAppDetails : network sur 500 ou exception réseau', async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });
    await expect(service.fetchAppDetails(123)).resolves.toEqual({
      kind: 'network',
    });

    global.fetch = vi.fn().mockRejectedValue(new Error('timeout'));
    await expect(service.fetchAppDetails(123)).resolves.toEqual({
      kind: 'network',
    });
  });

  it('fetchAppDetails : parsifie la fiche complète', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ 620: { success: true, data: DATA_FULL } }),
    });
    global.fetch = mockFetch;

    const details = await ficheOk(service, 620);
    expect(details).toMatchObject({
      appId: 620,
      name: 'Portal 2',
      shortDescription: 'Résolvez des énigmes.',
      genres: ['Action', 'Aventure'],
      genreIds: [1, 25],
      controllerSupport: 'full',
      releaseDate: expect.any(Date),
      headerImageUrl: 'https://cdn/header.jpg',
    });
  });

  it('embeddingInputFor : null si aucune matière descriptive', async () => {
    const { whereChain, limit } = faireDbFake();
    limit.mockResolvedValue([
      {
        name: 'PixelJunk' as string,
        shortDescription: null as string | null,
        genres: [] as string[],
        categories: [] as string[],
      },
    ]);
    const input = await service.embeddingInputFor(999);
    expect(input).toBeNull();
    expect(whereChain).toHaveBeenCalled();
  });

  it('embeddingInputFor : texte d’entrée depuis la fiche', async () => {
    const { limit } = faireDbFake();
    limit.mockResolvedValue([
      {
        name: 'Portal 2' as string,
        shortDescription: 'Des énigmes.' as string | null,
        genres: ['Puzzle'] as string[],
        categories: ['Co-op'] as string[],
      },
    ]);
    const input = await service.embeddingInputFor(620);
    expect(input).toMatchObject({
      name: 'Portal 2',
      shortDescription: 'Des énigmes.',
      genres: ['Puzzle'],
    });
  });

  it('userGameDetail renvoie la date de sortie en YYYY-MM-DD', async () => {
    const { limit } = faireDbFake();
    limit.mockResolvedValue([
      {
        id: 1,
        appId: 620,
        name: 'Portal 2',
        shortDescription: 'Des énigmes.',
        descriptionBlocks: [],
        screenshots: [],
        developers: ['Valve'],
        publishers: ['Valve'],
        website: '',
        platforms: ['windows'],
        metacriticScore: 95,
        metacriticUrl: null,
        backgroundImageUrl: null,
        genres: ['Puzzle'],
        categories: ['Solo'],
        controllerSupport: 'full',
        releaseDate: new Date('2011-04-18T00:00:00.000Z'),
        headerImageUrl: null,
        playtimeForever: 10,
        playtimeLast2Weeks: 0,
        lastActivityAt: new Date('2024-01-02T03:04:05.000Z'),
        lastActivitySource: 'sync_delta',
        lastActivityPrecision: 'upper_bound',
        achievementsTotal: null,
        gameAchievementsFetchedAt: null,
        achievementsUnlocked: null,
        progressFetchedAt: null,
      },
    ]);

    const detail = await service.userGameDetail(620, 1);

    expect(detail?.releaseDate).toBe('2011-04-18');
    expect(detail?.shortDescription).toBe('Des énigmes.');
    expect(detail?.lastActivitySource).toBe('sync_delta');
  });

  it('userGameDetail renvoie null sans date de sortie', async () => {
    const { limit } = faireDbFake();
    limit.mockResolvedValue([
      {
        releaseDate: null,
        gameAchievementsFetchedAt: null,
        progressFetchedAt: null,
      },
    ]);

    const detail = await service.userGameDetail(621, 1);

    expect(detail?.releaseDate).toBeNull();
  });
});
