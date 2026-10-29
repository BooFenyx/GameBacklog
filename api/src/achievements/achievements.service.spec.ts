import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DB, type Db } from '../db/db.module.js';
import { AchievementsService } from './achievements.service.js';

function makeConfig(env: Record<string, unknown> = {}): ConfigService {
  return { get: (key: string) => env[key] } as unknown as ConfigService;
}

/** Lignes `achievements` persistées, telles que relues par la base. */
const LIGNE_DETAIL = [
  {
    id: 1,
    gameId: 7,
    apiName: 'PORTAL_PUZZLE',
    displayName: 'Les bases',
    description: 'Résolvez la première énigme.',
    iconUrl: 'http://cdn/1.jpg',
  },
  {
    id: 2,
    gameId: 7,
    apiName: 'PORTAL_FRIEND',
    displayName: 'Coop',
    description: 'Terminez en coopération.',
    iconUrl: 'http://cdn/2.jpg',
  },
];

/**
 * Base factice : `SELECT` répond via une file de résultats consommée dans
 * l'ordre des requêtes (les requêtes Drizzle sont appelées soit avec
 * `.limit(1)`, soit avec `.then()`).
 */
function fakeDb(reponses: unknown[][]) {
  const select = vi.fn();
  const from = vi.fn();
  const whereChain = vi.fn();
  const innerJoin = vi.fn();
  const limit = vi.fn();
  const insert = vi.fn();
  const values = vi.fn();
  const onConflictDoUpdate = vi.fn();
  const update = vi.fn();
  const set = vi.fn();
  const whereSet = vi.fn();

  const file = [...reponses];
  const suivant = (): Promise<unknown[]> => Promise.resolve(file.shift() ?? []);
  // Le builder Drizzle est thenable (`loadAll`) : le mock l'imite pour les
  // requêtes sans `.limit()`.
  const builder = {
    // oxlint-disable-next-line unicorn/no-thenable
    then: (
      onFulfilled: (value: unknown[]) => unknown,
    ): Promise<unknown> => suivant().then(onFulfilled),
    limit,
  };
  limit.mockImplementation(suivant);
  whereChain.mockReturnValue(builder);
  innerJoin.mockReturnValue({ where: whereChain });
  select.mockReturnValue({ from });
  from.mockReturnValue({ where: whereChain, innerJoin });

  insert.mockReturnValue({ values });
  values.mockReturnValue({ onConflictDoUpdate });
  onConflictDoUpdate.mockResolvedValue(undefined);

  update.mockReturnValue({ set });
  set.mockReturnValue({ where: whereSet });
  whereSet.mockResolvedValue(undefined);

  return {
    db: { select, insert, update } as unknown as Db,
    insert,
    values,
    onConflictDoUpdate,
    set,
    limit,
    select,
  };
}

describe('AchievementsService', () => {
  let service: AchievementsService;

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('getGameAchievements', () => {
    it('ne rappelle pas Steam quand le cache est déjà rempli', async () => {
      const fake = fakeDb([
        [{ fetchedAt: new Date(), total: 2 }],
        LIGNE_DETAIL,
      ]);
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AchievementsService,
          { provide: DB, useValue: fake.db },
          { provide: ConfigService, useValue: makeConfig({ STEAM_API_KEY: 'cle' }) },
        ],
      }).compile();
      service = module.get<AchievementsService>(AchievementsService);

      const result = await service.getGameAchievements(7, 620);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        apiName: 'PORTAL_PUZZLE',
        displayName: 'Les bases',
      });
    });

    it('récupère puis persiste le schéma quand le cache est vide', async () => {
      const fake = fakeDb([
        [{ fetchedAt: null, total: 0 }],
        [],
        LIGNE_DETAIL,
      ]);
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            game: {
              availableGameStats: {
                achievements: [
                  {
                    name: 'PORTAL_PUZZLE',
                    displayName: 'Les bases',
                    description: 'Résolvez la première énigme.',
                    icon: 'http://cdn/1.jpg',
                  },
                  {
                    name: 'PORTAL_FRIEND',
                    displayName: 'Coop',
                  },
                ],
              },
            },
          }),
        }),
      );

      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AchievementsService,
          { provide: DB, useValue: fake.db },
          { provide: ConfigService, useValue: makeConfig({ STEAM_API_KEY: 'cle' }) },
        ],
      }).compile();
      service = module.get<AchievementsService>(AchievementsService);

      await service.getGameAchievements(7, 620);

      expect(fake.values).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({
          gameId: 7,
          apiName: 'PORTAL_PUZZLE',
          displayName: 'Les bases',
          description: 'Résolvez la première énigme.',
          iconUrl: 'http://cdn/1.jpg',
        }),
      );
      expect(fake.values).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          gameId: 7,
          apiName: 'PORTAL_FRIEND',
          displayName: 'Coop',
          description: null,
          iconUrl: null,
        }),
      );
    });
  });

  describe('getUserAchievements', () => {
    const env = { STEAM_API_KEY: 'cle' };

    const creerService = async (fake: ReturnType<typeof fakeDb>) => {
      const module: TestingModule = await Test.createTestingModule({
        providers: [
          AchievementsService,
          { provide: DB, useValue: fake.db },
          { provide: ConfigService, useValue: makeConfig(env) },
        ],
      }).compile();
      service = module.get<AchievementsService>(AchievementsService);
    };

    const schemaEnCache = [
      [{ fetchedAt: new Date(), total: 2 }],
      LIGNE_DETAIL,
      [{ playtimeForever: 60, achievementsFetchedAt: null }],
    ];

    it('upsert les réussites débloquées et met à jour le compteur', async () => {
      const fake = fakeDb(schemaEnCache);
      await creerService(fake);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            playerstats: {
              success: true,
              achievements: [
                { apiname: 'PORTAL_PUZZLE', achieved: 1, unlocktime: 1_700_000_000 },
                { apiname: 'PORTAL_FRIEND', achieved: 0 },
              ],
            },
          }),
        }),
      );

      const result = await service.getUserAchievements('7656119', 3, 7, 620);

      expect(fake.values).toHaveBeenCalledTimes(1);
      expect(fake.values).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 3,
          achievementId: 1,
          unlockedAt: new Date(1_700_000_000 * 1000),
        }),
      );
      expect(fake.set).toHaveBeenCalledWith(
        expect.objectContaining({
          achievementsUnlocked: 1,
          achievementsFetchedAt: expect.any(Date),
        }),
      );

      expect(result).toHaveLength(2);
      expect(result[0].unlockedAt).toEqual(new Date(1_700_000_000 * 1000));
      expect(result[1].unlockedAt).toBeNull();
    });

    it('renvoie une liste verrouillée si le profil est privé (success:false)', async () => {
      const fake = fakeDb(schemaEnCache);
      await creerService(fake);

      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({ playerstats: { success: false } }),
        }),
      );

      const result = await service.getUserAchievements('7656119', 3, 7, 620);
      expect(result).toHaveLength(2);
      expect(result.every((succes) => succes.unlockedAt === null)).toBe(true);
      expect(fake.set).toHaveBeenCalledWith(
        expect.objectContaining({
          achievementsUnlocked: 0,
          achievementsFetchedAt: expect.any(Date),
        }),
      );
    });

    it('ne rappelle pas Steam quand la progression est fraîche', async () => {
      const fake = fakeDb([
        [{ fetchedAt: new Date(), total: 2 }],
        LIGNE_DETAIL,
        [{ playtimeForever: 60, achievementsFetchedAt: new Date() }],
        [{ apiName: 'PORTAL_PUZZLE', unlockedAt: new Date('2024-01-01') }],
      ]);
      await creerService(fake);

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getUserAchievements('7656119', 3, 7, 620);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result[0].unlockedAt).toEqual(new Date('2024-01-01'));
      expect(result[1].unlockedAt).toBeNull();
    });

    it('ne demande pas les succès joueur pour un jeu jamais lancé', async () => {
      const fake = fakeDb([
        [{ fetchedAt: new Date(), total: 2 }],
        LIGNE_DETAIL,
        [{ playtimeForever: 0, achievementsFetchedAt: null }],
      ]);
      await creerService(fake);

      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);

      const result = await service.getUserAchievements('7656119', 3, 7, 620);

      expect(fetchMock).not.toHaveBeenCalled();
      expect(result).toHaveLength(2);
      expect(result.every((succes) => succes.unlockedAt === null)).toBe(true);
      expect(fake.set).toHaveBeenCalledWith(
        expect.objectContaining({
          achievementsUnlocked: 0,
          achievementsFetchedAt: expect.any(Date),
        }),
      );
    });
  });
});