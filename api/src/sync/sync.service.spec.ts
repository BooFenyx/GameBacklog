import type { ConfigService } from '@nestjs/config';
import type { Db } from '../db/db.module.js';
import {
  AchievementsService,
  SteamRateLimitError,
} from '../achievements/achievements.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { GamesService } from '../games/games.service.js';
import { LibraryService, type BibliothequeGame } from '../library/library.service.js';
import { UsersService } from '../users/users.service.js';
import { SyncService } from './sync.service.js';

type JobRow = {
  id: number;
  userId: number;
  status: 'pending' | 'running' | 'done' | 'error';
  step: 'library' | 'details' | 'achievements' | 'embeddings' | 'done';
  totalGames: number;
  processedGames: number;
  error: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
};

function makeService(db: unknown): SyncService {
  const config = { get: () => undefined } as unknown as ConfigService;
  return new SyncService(
    db as Db,
    config,
    {} as LibraryService,
    {} as GamesService,
    {} as AchievementsService,
    {} as EmbeddingService,
    {} as UsersService,
  );
}

describe('SyncService', () => {
  it('needsFilters : vrai quand un jeu n’a pas le mapping courant', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: '3' }]),
          }),
        }),
      }),
    };

    await expect(makeService(db).needsFilters(1)).resolves.toBe(true);
  });

  it('needsFilters : faux quand tous les jeux sont à jour', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: '0' }]),
          }),
        }),
      }),
    };

    await expect(makeService(db).needsFilters(1)).resolves.toBe(false);
  });

  it('needsAchievements : vrai quand un jeu manque de compteurs', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: '2' }]),
          }),
        }),
      }),
    };

    await expect(makeService(db).needsAchievements(1)).resolves.toBe(true);
  });

  it('needsAchievements : faux quand tous les compteurs sont présents', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: '0' }]),
          }),
        }),
      }),
    };

    await expect(makeService(db).needsAchievements(1)).resolves.toBe(false);
  });

  it('needsLibraryActivity : vrai quand une entrée n’a jamais été vue', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ count: '1' }]),
        }),
      }),
    };

    await expect(makeService(db).needsLibraryActivity(1)).resolves.toBe(true);
  });

  it('needsLibraryActivity : faux quand toutes les entrées ont un last_seen_at', async () => {
    const db = {
      select: () => ({
        from: () => ({
          where: () => Promise.resolve([{ count: '0' }]),
        }),
      }),
    };

    await expect(makeService(db).needsLibraryActivity(1)).resolves.toBe(false);
  });

  it('enqueue : renvoie le job en cours sans réinitialiser sa progression', async () => {
    const job: JobRow = {
      id: 42,
      userId: 1,
      status: 'running',
      step: 'details',
      totalGames: 10,
      processedGames: 4,
      error: null,
      startedAt: new Date('2026-01-01'),
      finishedAt: null,
    };
    const insert = vi.fn();
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([job]) }),
        }),
      }),
      insert,
    };

    const response = await makeService(db).enqueue(1);

    expect(response).toMatchObject({
      id: 42,
      status: 'running',
      processedGames: 4,
    });
    expect(insert).not.toHaveBeenCalled();
  });

  it('syncLibrary : convertit une chaîne de dernier succès en Date', async () => {
    const ecrits: Array<Record<string, unknown>> = [];
    let selectAppels = 0;
    const db = {
      select: () => {
        selectAppels += 1;
        // 1er select : précédents (aucun) ; 2e : derniers succès, renvoyés en
        // chaîne comme le faisait Drizzle avec `sql<Date>`.
        const resultat =
          selectAppels === 1
            ? []
            : [{ gameId: 7, dernier: '2025-08-13 12:21:48' }];
        return {
          from: () => ({
            where: () => Promise.resolve(resultat),
            innerJoin: () => ({
              where: () => ({
                groupBy: () => Promise.resolve(resultat),
              }),
            }),
          }),
        };
      },
      insert: () => ({
        values: (valeurs: Record<string, unknown>) => {
          ecrits.push(valeurs);
          return { onConflictDoUpdate: () => Promise.resolve() };
        },
      }),
      update: () => ({
        set: () => ({ where: () => Promise.resolve() }),
      }),
    };
    const games = {
      upsertBasic: async () => 7,
    } as unknown as GamesService;
    const service = new SyncService(
      db as unknown as Db,
      { get: () => undefined } as unknown as ConfigService,
      {} as LibraryService,
      games,
      {} as AchievementsService,
      {} as EmbeddingService,
      {} as UsersService,
    );

    await (
      service as unknown as {
        syncLibrary: (
          jobId: number,
          userId: number,
          jeux: BibliothequeGame[],
        ) => Promise<void>;
      }
    ).syncLibrary(1, 1, [
      {
        appId: 10,
        name: 'Jeu',
        playtimeForever: 120,
        playtimeLast2Weeks: 0,
      },
    ]);

    expect(ecrits).toHaveLength(1);
    const ecrit = ecrits[0] as { lastActivityAt?: unknown };
    expect(ecrit.lastActivityAt).toBeInstanceOf(Date);
    expect((ecrit.lastActivityAt as Date).toISOString()).toBe(
      '2025-08-13T12:21:48.000Z',
    );
  });

  describe('reprise par étape', () => {
    function jobRow(step: JobRow['step']): JobRow {
      return {
        id: 1,
        userId: 1,
        status: 'pending',
        step,
        totalGames: 0,
        processedGames: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
      };
    }

    function dbProcessJob() {
      let appelsSelect = 0;
      const updates: Array<Record<string, unknown>> = [];
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => {
                appelsSelect += 1;
                return Promise.resolve(
                  appelsSelect === 1 ? [{ steamId: 'steam-1' }] : [],
                );
              },
            }),
          }),
        }),
        update: () => ({
          set: (valeurs: Record<string, unknown>) => {
            updates.push(valeurs);
            return { where: () => Promise.resolve() };
          },
        }),
      };
      return { db, updates };
    }

    function serviceOrchestration(
      db: unknown,
      deps: {
        ownedGames?: () => Promise<unknown[]>;
        setStatus?: () => Promise<void>;
      } = {},
    ): SyncService {
      return new SyncService(
        db as Db,
        { get: () => undefined } as unknown as ConfigService,
        {
          ownedGames: deps.ownedGames ?? (async () => []),
        } as unknown as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {
          setStatus: deps.setStatus ?? (async () => {}),
        } as unknown as UsersService,
      );
    }

    function espionnerEtapes(service: SyncService) {
      return {
        syncLibrary: vi
          .spyOn(service as never, 'syncLibrary')
          .mockResolvedValue(undefined),
        stepDetails: vi
          .spyOn(service as never, 'stepDetails')
          .mockResolvedValue({ paused: false, progressed: true }),
        stepAchievements: vi
          .spyOn(service as never, 'stepAchievements')
          .mockResolvedValue({ paused: false, progressed: true }),
        stepEmbeddings: vi
          .spyOn(service as never, 'stepEmbeddings')
          .mockResolvedValue({ paused: false, progressed: true }),
      };
    }

    it('depuis library : exécute les quatre étapes', async () => {
      const { db, updates } = dbProcessJob();
      const ownedGames = vi.fn(async () => []);
      const setStatus = vi.fn(async () => {});
      const service = serviceOrchestration(db, { ownedGames, setStatus });
      const etapes = espionnerEtapes(service);

      await (service as never as { processJob: (j: JobRow) => Promise<void> })
        .processJob(jobRow('library'));

      expect(ownedGames).toHaveBeenCalledWith('steam-1');
      expect(etapes.syncLibrary).toHaveBeenCalledTimes(1);
      expect(etapes.stepDetails).toHaveBeenCalledTimes(1);
      expect(etapes.stepAchievements).toHaveBeenCalledTimes(1);
      expect(etapes.stepEmbeddings).toHaveBeenCalledTimes(1);
      expect(setStatus).toHaveBeenCalledWith(1, 'done', expect.anything());
      expect(updates.some((u) => u.status === 'done')).toBe(true);
    });

    it('depuis details : saute library', async () => {
      const { db } = dbProcessJob();
      const ownedGames = vi.fn(async () => []);
      const service = serviceOrchestration(db, { ownedGames });
      const etapes = espionnerEtapes(service);

      await (service as never as { processJob: (j: JobRow) => Promise<void> })
        .processJob(jobRow('details'));

      expect(ownedGames).not.toHaveBeenCalled();
      expect(etapes.syncLibrary).not.toHaveBeenCalled();
      expect(etapes.stepDetails).toHaveBeenCalledTimes(1);
      expect(etapes.stepAchievements).toHaveBeenCalledTimes(1);
      expect(etapes.stepEmbeddings).toHaveBeenCalledTimes(1);
    });

    it('depuis achievements : saute details', async () => {
      const { db } = dbProcessJob();
      const service = serviceOrchestration(db);
      const etapes = espionnerEtapes(service);

      await (service as never as { processJob: (j: JobRow) => Promise<void> })
        .processJob(jobRow('achievements'));

      expect(etapes.stepDetails).not.toHaveBeenCalled();
      expect(etapes.stepAchievements).toHaveBeenCalledTimes(1);
      expect(etapes.stepEmbeddings).toHaveBeenCalledTimes(1);
    });

    it('depuis embeddings : ne lance que les embeddings', async () => {
      const { db } = dbProcessJob();
      const service = serviceOrchestration(db);
      const etapes = espionnerEtapes(service);

      await (service as never as { processJob: (j: JobRow) => Promise<void> })
        .processJob(jobRow('embeddings'));

      expect(etapes.stepDetails).not.toHaveBeenCalled();
      expect(etapes.stepAchievements).not.toHaveBeenCalled();
      expect(etapes.stepEmbeddings).toHaveBeenCalledTimes(1);
    });

    it('depuis done + pending : répare en repartant de library', async () => {
      const { db } = dbProcessJob();
      const ownedGames = vi.fn(async () => []);
      const service = serviceOrchestration(db, { ownedGames });
      const etapes = espionnerEtapes(service);

      await (service as never as { processJob: (j: JobRow) => Promise<void> })
        .processJob(jobRow('done'));

      expect(ownedGames).toHaveBeenCalledWith('steam-1');
      expect(etapes.syncLibrary).toHaveBeenCalledTimes(1);
      expect(etapes.stepDetails).toHaveBeenCalledTimes(1);
    });

    it('une étape en pause remet le job en pending sans le terminer', async () => {
      const { db, updates } = dbProcessJob();
      const setStatus = vi.fn(async () => {});
      const service = serviceOrchestration(db, { setStatus });
      const etapes = espionnerEtapes(service);
      etapes.stepDetails.mockResolvedValue({ paused: true, progressed: true });

      await (service as never as { processJob: (j: JobRow) => Promise<void> })
        .processJob(jobRow('details'));

      expect(updates).toContainEqual({
        status: 'pending',
        step: 'details',
        finishedAt: null,
      });
      expect(updates.some((u) => u.status === 'done')).toBe(false);
      expect(setStatus).not.toHaveBeenCalled();
      expect(etapes.stepAchievements).not.toHaveBeenCalled();
      expect(etapes.stepEmbeddings).not.toHaveBeenCalled();
    });
  });

  describe('budget d’étape', () => {
    function dbProgression() {
      const updates: Array<Record<string, unknown>> = [];
      return {
        updates,
        db: {
          update: () => ({
            set: (valeurs: Record<string, unknown>) => {
              updates.push(valeurs);
              return { where: () => Promise.resolve() };
            },
          }),
        },
      };
    }

    it('stepDetails : budget atteint avec progrès → pause', async () => {
      const { db } = dbProgression();
      const fetchAppDetails = vi.fn(async (appId: number) => ({
        kind: 'ok' as const,
        details: { appId, name: 'Jeu' },
      }));
      const upsertFromDetails = vi.fn(async () => 1);
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        { fetchAppDetails, upsertFromDetails } as unknown as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([
        1, 2, 3,
      ]);
      let verifications = 0;
      vi.spyOn(service as never, 'budgetDepasse').mockImplementation(() => {
        verifications += 1;
        return verifications > 1;
      });

      const resultat = await (
        service as never as {
          stepDetails: (j: number, u: number) => Promise<{
            paused: boolean;
            progressed: boolean;
          }>;
        }
      ).stepDetails(1, 1);

      expect(resultat).toEqual({ paused: true, progressed: true });
      expect(fetchAppDetails).toHaveBeenCalledTimes(1);
    });

    it('stepDetails : budget atteint sans progrès → pas de pause', async () => {
      const { db } = dbProgression();
      const fetchAppDetails = vi.fn(async () => null);
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        { fetchAppDetails } as unknown as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([
        1, 2, 3,
      ]);
      vi.spyOn(service as never, 'budgetDepasse').mockReturnValue(true);

      const resultat = await (
        service as never as {
          stepDetails: (j: number, u: number) => Promise<{
            paused: boolean;
            progressed: boolean;
          }>;
        }
      ).stepDetails(1, 1);

      expect(resultat).toEqual({ paused: false, progressed: false });
      expect(fetchAppDetails).not.toHaveBeenCalled();
    });

    it('SYNC_STEP_MAX_MS=0 désactive le budget', () => {
      const service = new SyncService(
        {} as Db,
        {
          get: (cle: string) =>
            cle === 'SYNC_STEP_MAX_MS' ? '0' : undefined,
        } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
      );

      expect(
        (service as never as { creerDeadline: () => number | null }).creerDeadline(),
      ).toBeNull();
    });

    it('processJob : budget atteint avec progrès → job pending, étape conservée', async () => {
      const updates: Array<Record<string, unknown>> = [];
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              limit: () => Promise.resolve([{ steamId: 'steam-1' }]),
            }),
          }),
        }),
        update: () => ({
          set: (valeurs: Record<string, unknown>) => {
            updates.push(valeurs);
            return { where: () => Promise.resolve() };
          },
        }),
      };
      const fetchAppDetails = vi.fn(async (appId: number) => ({
        kind: 'ok' as const,
        details: { appId, name: 'Jeu' },
      }));
      const upsertFromDetails = vi.fn(async () => 1);
      const setStatus = vi.fn(async () => {});
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        { fetchAppDetails, upsertFromDetails } as unknown as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        { setStatus } as unknown as UsersService,
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([
        1, 2, 3,
      ]);
      let verifications = 0;
      vi.spyOn(service as never, 'budgetDepasse').mockImplementation(() => {
        verifications += 1;
        return verifications > 1;
      });

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob({
        id: 1,
        userId: 1,
        status: 'pending',
        step: 'details',
        totalGames: 0,
        processedGames: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
      });

      expect(updates).toContainEqual({
        status: 'pending',
        step: 'details',
        finishedAt: null,
      });
      expect(updates.some((u) => u.status === 'done')).toBe(false);
      expect(setStatus).not.toHaveBeenCalled();
    });

    it('pauseJob : remet le job en pending et arme la reprise', async () => {
      const { db, updates } = dbProgression();
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
      );

      await (
        service as never as {
          pauseJob: (id: number, step: JobRow['step']) => Promise<void>;
        }
      ).pauseJob(5, 'details');

      expect(updates[0]).toEqual({
        status: 'pending',
        step: 'details',
        finishedAt: null,
      });
      expect((service as never as { rerun: boolean }).rerun).toBe(true);
    });
  });

  describe('fiches Steam', () => {
    type Resultat = { paused: boolean; progressed: boolean };

    function dbFiches(
      attemptsQueue: Array<Array<{ attempts: number }>> = [],
    ) {
      const file = [...attemptsQueue];
      const updates: Array<Record<string, unknown>> = [];
      return {
        updates,
        db: {
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve(file.shift() ?? []),
              }),
            }),
          }),
          update: () => ({
            set: (valeurs: Record<string, unknown>) => {
              updates.push(valeurs);
              return { where: () => Promise.resolve() };
            },
          }),
        },
      };
    }

    function serviceFiches(
      db: unknown,
      fetchAppDetails: (
        appId: number,
        tentative?: number,
      ) => Promise<unknown>,
      upsertFromDetails = async () => 1,
      config: Record<string, string> = {},
    ): SyncService {
      return new SyncService(
        db as Db,
        { get: (cle: string) => config[cle] } as unknown as ConfigService,
        {} as LibraryService,
        { fetchAppDetails, upsertFromDetails } as unknown as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
      );
    }

    async function lancer(service: SyncService): Promise<Resultat> {
      return (
        service as never as {
          stepDetails: (j: number, u: number) => Promise<Resultat>;
        }
      ).stepDetails(1, 1);
    }

    it('250 fiches dont 50 en 429 finissent par être récupérées', async () => {
      const { db } = dbFiches();
      const tentatives = new Map<number, number>();
      const fetchAppDetails = vi.fn(async (appId: number) => {
        const n = (tentatives.get(appId) ?? 0) + 1;
        tentatives.set(appId, n);
        if (appId <= 50 && n === 1) {
          return { kind: 'rate-limit', retryAfterMs: 0 };
        }
        return { kind: 'ok', details: { appId, name: `Jeu ${appId}` } };
      });
      const upsertFromDetails = vi.fn(async () => 1);
      const service = serviceFiches(db, fetchAppDetails, upsertFromDetails, {
        APPDETAILS_THROTTLE_MS: '0',
      });
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue(
        Array.from({ length: 250 }, (_, i) => i + 1),
      );

      const resultat = await lancer(service);

      expect(resultat).toEqual({ paused: false, progressed: true });
      expect(upsertFromDetails).toHaveBeenCalledTimes(250);
      expect(fetchAppDetails).toHaveBeenCalledTimes(300);
    });

    it('429 persistant : les fiches restent en attente avec next_retry', async () => {
      const { db, updates } = dbFiches();
      const fetchAppDetails = vi.fn(async (appId: number) =>
        appId % 5 === 0
          ? { kind: 'rate-limit', retryAfterMs: 0 }
          : { kind: 'ok', details: { appId, name: `Jeu ${appId}` } },
      );
      const upsertFromDetails = vi.fn(async () => 1);
      const service = serviceFiches(db, fetchAppDetails, upsertFromDetails, {
        APPDETAILS_THROTTLE_MS: '0',
      });
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue(
        Array.from({ length: 250 }, (_, i) => i + 1),
      );

      const resultat = await lancer(service);

      expect(resultat).toEqual({ paused: false, progressed: true });
      expect(upsertFromDetails).toHaveBeenCalledTimes(200);
      const echecs = updates.filter(
        (u) => u.detailsLastError === 'rate-limit',
      );
      expect(echecs).toHaveLength(50);
      for (const echec of echecs) {
        expect(echec.detailsNextRetryAt).toBeInstanceOf(Date);
      }
    });

    it('jeu délisté : 3 passages puis next_retry à ~30 jours', async () => {
      const { db, updates } = dbFiches([
        [{ attempts: 0 }],
        [{ attempts: 1 }],
        [{ attempts: 2 }],
      ]);
      const service = serviceFiches(
        db,
        vi.fn(async () => ({ kind: 'removed' })),
        vi.fn(async () => 1),
        { APPDETAILS_THROTTLE_MS: '0' },
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([1]);

      for (let passage = 0; passage < 3; passage += 1) {
        await lancer(service);
      }

      const echecs = updates.filter((u) => u.detailsAttempts !== undefined);
      expect(echecs.map((u) => u.detailsAttempts)).toEqual([1, 2, 3]);
      const delai =
        (echecs[2].detailsNextRetryAt as Date).getTime() - Date.now();
      expect(delai).toBeGreaterThan(29 * 24 * 60 * 60 * 1000);
    });

    it('erreur réseau : next_retry à ~5 min, sans incrémenter attempts', async () => {
      const { db, updates } = dbFiches();
      const service = serviceFiches(
        db,
        vi.fn(async () => ({ kind: 'network' })),
        vi.fn(async () => 1),
        { APPDETAILS_THROTTLE_MS: '0' },
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([1]);

      const resultat = await lancer(service);

      expect(resultat).toEqual({ paused: false, progressed: false });
      const echec = updates.find((u) => u.detailsLastError === 'network');
      if (!echec) throw new Error('échec réseau non enregistré');
      expect(echec.detailsAttempts).toBeUndefined();
      const delai = (echec.detailsNextRetryAt as Date).getTime() - Date.now();
      expect(delai).toBeGreaterThan(4 * 60 * 1000);
      expect(delai).toBeLessThanOrEqual(5 * 60 * 1000 + 1000);
    });

    it('3 × 429 consécutifs avec progrès : pause de la passe', async () => {
      const { db } = dbFiches();
      const fetchAppDetails = vi.fn(async (appId: number) =>
        appId === 1
          ? { kind: 'ok', details: { appId, name: 'Jeu 1' } }
          : { kind: 'rate-limit', retryAfterMs: 0 },
      );
      const service = serviceFiches(
        db,
        fetchAppDetails,
        vi.fn(async () => 1),
        { APPDETAILS_THROTTLE_MS: '0' },
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([
        1, 2, 3, 4, 5,
      ]);

      const resultat = await lancer(service);

      expect(resultat).toEqual({ paused: true, progressed: true });
      // 1 succès + 3 jeux × 2 tentatives ; le 5e n'est pas tenté.
      expect(fetchAppDetails).toHaveBeenCalledTimes(7);
    });

    it('3 × 429 consécutifs sans progrès : done avec reliquat', async () => {
      const { db } = dbFiches();
      const fetchAppDetails = vi.fn(async () => ({
        kind: 'rate-limit',
        retryAfterMs: 0,
      }));
      const service = serviceFiches(
        db,
        fetchAppDetails,
        vi.fn(async () => 1),
        { APPDETAILS_THROTTLE_MS: '0' },
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([
        1, 2, 3, 4,
      ]);

      const resultat = await lancer(service);

      expect(resultat).toEqual({ paused: false, progressed: false });
      expect(fetchAppDetails).toHaveBeenCalledTimes(6);
    });

    it('stepAchievements : 3 × 429 consécutifs arrêtent la passe', async () => {
      const db = {
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
        $client: {
          query: () => Promise.resolve({ rowCount: 0, rows: [] }),
        },
      };
      const refreshForSync = vi.fn(async () => {
        throw new SteamRateLimitError(0);
      });
      const service = new SyncService(
        db as unknown as Db,
        {
          get: (cle: string) =>
            cle === 'ACHIEVEMENTS_THROTTLE_MS' ? '0' : undefined,
        } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        { refreshForSync } as unknown as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
      );
      vi.spyOn(service as never, 'compterSuccesManquants').mockResolvedValue(5);
      vi.spyOn(
        service as never,
        'selectionnerSuccesManquants',
      ).mockResolvedValue([
        { gameId: 1, appId: 11 },
        { gameId: 2, appId: 12 },
        { gameId: 3, appId: 13 },
        { gameId: 4, appId: 14 },
        { gameId: 5, appId: 15 },
      ]);

      const resultat = await (
        service as never as {
          stepAchievements: (
            j: number,
            u: number,
            s: string,
          ) => Promise<Resultat>;
        }
      ).stepAchievements(1, 1, 'steam-1');

      expect(resultat).toEqual({ paused: false, progressed: false });
      expect(refreshForSync).toHaveBeenCalledTimes(3);
    });
  });
});
