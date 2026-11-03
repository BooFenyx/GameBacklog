import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Db } from '../db/db.module.js';
import {
  AchievementsService,
  SteamRateLimitError,
} from '../achievements/achievements.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import {
  QuotaReachedError,
  type RateLimitService,
} from '../embedding/rate-limiter.service.js';
import { GamesService } from '../games/games.service.js';
import {
  LibraryService,
  type BibliothequeGame,
} from '../library/library.service.js';
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
    {} as RateLimitService,
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

  it('needsDetails : vrai quand une fiche manquante est due', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: '2' }]),
          }),
        }),
      }),
    };

    await expect(makeService(db).needsDetails(1)).resolves.toBe(true);
  });

  it('needsDetails : faux quand aucune fiche n’est due', async () => {
    const db = {
      select: () => ({
        from: () => ({
          innerJoin: () => ({
            where: () => Promise.resolve([{ count: '0' }]),
          }),
        }),
      }),
    };

    await expect(makeService(db).needsDetails(1)).resolves.toBe(false);
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

    const service = makeService(db);
    const drain = vi
      .spyOn(service as never, 'drain')
      .mockResolvedValue(undefined);
    const response = await service.enqueue(1);

    expect(response).toMatchObject({
      id: 42,
      status: 'running',
      processedGames: 4,
    });
    expect(insert).not.toHaveBeenCalled();
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('enqueue : réarme drain sur un job pending orphelin', async () => {
    const job: JobRow = {
      id: 43,
      userId: 1,
      status: 'pending',
      step: 'details',
      totalGames: 10,
      processedGames: 2,
      error: null,
      startedAt: null,
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

    const service = makeService(db);
    const drain = vi
      .spyOn(service as never, 'drain')
      .mockResolvedValue(undefined);
    const response = await service.enqueue(1);

    expect(response).toMatchObject({ id: 43, status: 'pending' });
    expect(insert).not.toHaveBeenCalled();
    expect(drain).toHaveBeenCalledTimes(1);
  });

  it('enqueue : refuse une seconde relance manuelle dans le cooldown', async () => {
    const job: JobRow = {
      id: 44,
      userId: 1,
      status: 'pending',
      step: 'library',
      totalGames: 0,
      processedGames: 0,
      error: null,
      startedAt: null,
      finishedAt: null,
    };
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = {
      $client: { query },
      select: () => ({
        from: () => ({
          where: () => ({ limit: () => Promise.resolve([]) }),
        }),
      }),
      insert: () => ({
        values: () => ({
          onConflictDoUpdate: () => ({
            returning: () => Promise.resolve([job]),
          }),
        }),
      }),
    };
    const service = makeService(db);
    const drain = vi
      .spyOn(service as never, 'drain')
      .mockResolvedValue(undefined);

    await expect(
      service.enqueue(1, { forcerFiches: true }),
    ).resolves.toMatchObject({ id: 44 });

    const erreur = await service
      .enqueue(1, { forcerFiches: true })
      .catch((error: unknown) => error);
    expect(erreur).toBeInstanceOf(HttpException);
    expect((erreur as HttpException).getStatus()).toBe(429);

    // La relance refusée ne doit pas avoir touché au backoff des fiches.
    expect(query).toHaveBeenCalledTimes(1);
    expect(drain).toHaveBeenCalledTimes(1);
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
      upsertBasicMany: async (
        jeux: ReadonlyArray<{ appId: number; name: string }>,
      ) => new Map(jeux.map((jeu) => [jeu.appId, 7])),
    } as unknown as GamesService;
    const service = new SyncService(
      db as unknown as Db,
      { get: () => undefined } as unknown as ConfigService,
      {} as LibraryService,
      games,
      {} as AchievementsService,
      {} as EmbeddingService,
      {} as UsersService,
      {} as RateLimitService,
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
    const lot = ecrits[0] as Array<{ lastActivityAt?: unknown }>;
    const ecrit = lot[0];
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
      const service = new SyncService(
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
        {} as RateLimitService,
      );
      vi.spyOn(service as never, 'planifierReprise').mockResolvedValue(
        undefined,
      );
      return service;
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

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('library'));

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

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('details'));

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

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('achievements'));

      expect(etapes.stepDetails).not.toHaveBeenCalled();
      expect(etapes.stepAchievements).toHaveBeenCalledTimes(1);
      expect(etapes.stepEmbeddings).toHaveBeenCalledTimes(1);
    });

    it('depuis embeddings : ne lance que les embeddings', async () => {
      const { db } = dbProcessJob();
      const service = serviceOrchestration(db);
      const etapes = espionnerEtapes(service);

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('embeddings'));

      expect(etapes.stepDetails).not.toHaveBeenCalled();
      expect(etapes.stepAchievements).not.toHaveBeenCalled();
      expect(etapes.stepEmbeddings).toHaveBeenCalledTimes(1);
    });

    it('depuis done + pending : répare en repartant de library', async () => {
      const { db } = dbProcessJob();
      const ownedGames = vi.fn(async () => []);
      const service = serviceOrchestration(db, { ownedGames });
      const etapes = espionnerEtapes(service);

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('done'));

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

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('details'));

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

    it('utilisateur absent : marque le job en error, pas en pending', async () => {
      const updates: Array<Record<string, unknown>> = [];
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
        update: () => ({
          set: (valeurs: Record<string, unknown>) => {
            updates.push(valeurs);
            return { where: () => Promise.resolve() };
          },
        }),
      };
      const setStatus = vi.fn(async () => {});
      const service = serviceOrchestration(db, { setStatus });

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob(jobRow('library'));

      expect(updates.some((u) => u.status === 'error')).toBe(true);
      expect(updates.some((u) => u.status === 'pending')).toBe(false);
      expect(setStatus).toHaveBeenCalledWith(1, 'error');
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
        {} as RateLimitService,
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
          stepDetails: (
            j: number,
            u: number,
          ) => Promise<{
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
        {} as RateLimitService,
      );
      vi.spyOn(service as never, 'appIdsSansDetails').mockResolvedValue([
        1, 2, 3,
      ]);
      vi.spyOn(service as never, 'budgetDepasse').mockReturnValue(true);

      const resultat = await (
        service as never as {
          stepDetails: (
            j: number,
            u: number,
          ) => Promise<{
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
          get: (cle: string) => (cle === 'SYNC_STEP_MAX_MS' ? '0' : undefined),
        } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
        {} as RateLimitService,
      );

      expect(
        (
          service as never as { creerDeadline: () => number | null }
        ).creerDeadline(),
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
        {} as RateLimitService,
      );
      vi.spyOn(service as never, 'planifierReprise').mockResolvedValue(
        undefined,
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
        {} as RateLimitService,
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

  describe('reprises automatiques', () => {
    afterEach(() => {
      vi.useRealTimers();
      vi.restoreAllMocks();
    });

    function servicePlanification(): SyncService {
      return new SyncService(
        {} as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        {} as UsersService,
        {} as RateLimitService,
      );
    }

    it('programme une reprise à l’échéance puis enfile le job', async () => {
      vi.useFakeTimers();
      const service = servicePlanification();
      const echeance = new Date(Date.now() + 60_000);
      vi.spyOn(service as never, 'prochaineRepriseFiche').mockResolvedValue(
        echeance,
      );
      const enqueue = vi
        .spyOn(service, 'enqueue')
        .mockResolvedValue({} as never);

      await (
        service as never as {
          planifierReprise: (userId: number) => Promise<void>;
        }
      ).planifierReprise(7);

      expect(
        (service as never as { reprises: Map<number, unknown> }).reprises.size,
      ).toBe(1);

      await vi.advanceTimersByTimeAsync(60_000);

      expect(enqueue).toHaveBeenCalledWith(7, { depart: 'details' });
    });

    it('ne programme rien quand aucune fiche n’a d’échéance', async () => {
      const service = servicePlanification();
      vi.spyOn(service as never, 'prochaineRepriseFiche').mockResolvedValue(
        null,
      );

      await (
        service as never as {
          planifierReprise: (userId: number) => Promise<void>;
        }
      ).planifierReprise(7);

      expect(
        (service as never as { reprises: Map<number, unknown> }).reprises.size,
      ).toBe(0);
    });

    it('ne replanifie pas une échéance déjà due (anti-boucle)', async () => {
      const service = servicePlanification();
      vi.spyOn(service as never, 'prochaineRepriseFiche').mockResolvedValue(
        new Date(Date.now() - 1_000),
      );

      await (
        service as never as {
          planifierReprise: (
            userId: number,
            options: { autoriserEcheanceDue?: boolean },
          ) => Promise<void>;
        }
      ).planifierReprise(7, { autoriserEcheanceDue: false });

      expect(
        (service as never as { reprises: Map<number, unknown> }).reprises.size,
      ).toBe(0);
    });

    it('replanifie une échéance due quand le job a terminé sans erreur', async () => {
      vi.useFakeTimers();
      const service = servicePlanification();
      vi.spyOn(service as never, 'prochaineRepriseFiche').mockResolvedValue(
        new Date(Date.now() - 1_000),
      );

      await (
        service as never as {
          planifierReprise: (
            userId: number,
            options: { autoriserEcheanceDue?: boolean },
          ) => Promise<void>;
        }
      ).planifierReprise(7, { autoriserEcheanceDue: true });

      expect(
        (service as never as { reprises: Map<number, unknown> }).reprises.size,
      ).toBe(1);
      service.onModuleDestroy();
      vi.useRealTimers();
    });

    it('onModuleDestroy annule les timers programmés', async () => {
      vi.useFakeTimers();
      const service = servicePlanification();
      vi.spyOn(service as never, 'prochaineRepriseFiche').mockResolvedValue(
        new Date(Date.now() + 60_000),
      );

      await (
        service as never as {
          planifierReprise: (userId: number) => Promise<void>;
        }
      ).planifierReprise(7);
      service.onModuleDestroy();

      expect(
        (service as never as { reprises: Map<number, unknown> }).reprises.size,
      ).toBe(0);
    });

    it('drain marque le job en error si processJob jette', async () => {
      const job: JobRow = {
        id: 1,
        userId: 1,
        status: 'pending',
        step: 'details',
        totalGames: 0,
        processedGames: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
      };
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => Promise.resolve([job]),
              }),
            }),
          }),
        }),
      };
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        { setStatus: async () => {} } as unknown as UsersService,
        {} as RateLimitService,
      );
      vi.spyOn(service as never, 'processJob').mockRejectedValue(
        new Error('boom'),
      );
      const finish = vi
        .spyOn(service as never, 'finish')
        .mockResolvedValue(undefined);

      await (service as never as { drain: () => Promise<void> }).drain();

      expect(finish).toHaveBeenCalledWith(
        1,
        'error',
        'details',
        'boom',
        expect.any(Date),
      );
    });

    it('drain traite tous les jobs pending du tour', async () => {
      const jobs: JobRow[] = [
        {
          id: 1,
          userId: 1,
          status: 'pending',
          step: 'library',
          totalGames: 0,
          processedGames: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
        {
          id: 2,
          userId: 2,
          status: 'pending',
          step: 'details',
          totalGames: 0,
          processedGames: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      ];
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => {
                  const suivant = jobs.shift();
                  return Promise.resolve(suivant ? [suivant] : []);
                },
              }),
            }),
          }),
        }),
      };
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        { setStatus: async () => {} } as unknown as UsersService,
        {} as RateLimitService,
      );
      const processJob = vi
        .spyOn(service as never, 'processJob')
        .mockResolvedValue(undefined);

      await (service as never as { drain: () => Promise<void> }).drain();

      expect(processJob).toHaveBeenCalledTimes(2);
    });

    it('relance un drain quand un job est enfilé pendant la boucle', async () => {
      const jobs: JobRow[] = [
        {
          id: 1,
          userId: 1,
          status: 'pending',
          step: 'library',
          totalGames: 0,
          processedGames: 0,
          error: null,
          startedAt: null,
          finishedAt: null,
        },
      ];
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({
              orderBy: () => ({
                limit: () => {
                  const suivant = jobs.shift();
                  return Promise.resolve(suivant ? [suivant] : []);
                },
              }),
            }),
          }),
        }),
      };
      const service = new SyncService(
        db as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        {} as GamesService,
        {} as AchievementsService,
        {} as EmbeddingService,
        { setStatus: async () => {} } as unknown as UsersService,
        {} as RateLimitService,
      );
      const drain = vi.spyOn(
        service as never as { drain: () => Promise<void> },
        'drain',
      );
      vi.spyOn(service as never, 'processJob').mockImplementation(async () => {
        // Simule un `enqueue` concurrent : le drain doit se relancer.
        (service as never as { rerun: boolean }).rerun = true;
      });

      await (service as never as { drain: () => Promise<void> }).drain();

      expect(drain).toHaveBeenCalledTimes(2);
    });
  });

  describe('fiches Steam', () => {
    type Resultat = { paused: boolean; progressed: boolean };

    function dbFiches(attemptsQueue: Array<Array<{ attempts: number }>> = []) {
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
      fetchAppDetails: (appId: number, tentative?: number) => Promise<unknown>,
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
        {} as RateLimitService,
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
      const echecs = updates.filter((u) => u.detailsLastError === 'rate-limit');
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
        {} as RateLimitService,
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

    it('stepAchievements : attend Retry-After après 3 429 avec progrès', async () => {
      vi.useFakeTimers();
      try {
        const db = {
          update: () => ({
            set: () => ({ where: () => Promise.resolve() }),
          }),
          $client: {
            query: () => Promise.resolve({ rowCount: 0, rows: [] }),
          },
        };
        let appels = 0;
        const refreshForSync = vi.fn(async () => {
          appels += 1;
          if (appels === 1) return;
          throw new SteamRateLimitError(1_000);
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
          {} as RateLimitService,
        );
        vi.spyOn(service as never, 'compterSuccesManquants').mockResolvedValue(
          5,
        );
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

        const promesse = (
          service as never as {
            stepAchievements: (
              j: number,
              u: number,
              s: string,
            ) => Promise<Resultat>;
          }
        ).stepAchievements(1, 1, 'steam-1');
        let terminee = false;
        void promesse.then(() => {
          terminee = true;
        });

        await vi.advanceTimersByTimeAsync(0);
        expect(terminee).toBe(false);

        await vi.advanceTimersByTimeAsync(1_000);
        await expect(promesse).resolves.toEqual({
          paused: true,
          progressed: true,
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('succès volumineux', () => {
    type Resultat = { paused: boolean; progressed: boolean };

    it('1 000 jeux dont 50 en échec : tous tentés, 950 compteurs, 50 en attente', async () => {
      const db = {
        update: () => ({
          set: () => ({ where: () => Promise.resolve() }),
        }),
        $client: {
          query: () => Promise.resolve({ rowCount: 0, rows: [] }),
        },
      };
      const pool = Array.from({ length: 1000 }, (_, index) => ({
        gameId: index + 1,
        appId: 940001 + index,
      }));
      // Un échec tous les 20 jeux : jamais trois 429 consécutifs, donc pas de
      // pause, et exactement 50 jeux restent manquants.
      const echecs = new Set(
        pool.filter((_, index) => index % 20 === 0).map((jeu) => jeu.gameId),
      );
      const refreshForSync = vi.fn(
        async (_steamId: string, _userId: number, gameId: number) => {
          if (echecs.has(gameId)) throw new SteamRateLimitError(0);
        },
      );
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
        {} as RateLimitService,
      );
      const compter = vi
        .spyOn(service as never, 'compterSuccesManquants')
        .mockResolvedValue(1000);
      const selectionner = vi.fn(
        async (_userId: number, dejaTentes: number[], limite: number) =>
          pool
            .filter((jeu) => !dejaTentes.includes(jeu.gameId))
            .slice(0, limite),
      );
      vi.spyOn(
        service as never,
        'selectionnerSuccesManquants',
      ).mockImplementation(selectionner as never);

      const resultat = await (
        service as never as {
          stepAchievements: (
            j: number,
            u: number,
            s: string,
          ) => Promise<Resultat>;
        }
      ).stepAchievements(1, 1, 'steam-1');

      expect(resultat).toEqual({ paused: false, progressed: true });
      expect(selectionner).toHaveBeenCalledTimes(5);
      expect(refreshForSync).toHaveBeenCalledTimes(1000);
      expect(
        new Set(refreshForSync.mock.calls.map((appel) => appel[2])).size,
      ).toBe(1000);
      expect(echecs.size).toBe(50);

      // Les 50 échecs restent manquants : `pendingAchievements` vaut 50 et une
      // nouvelle sync est nécessaire.
      compter.mockResolvedValue(50);
      await expect(service.needsAchievements(1)).resolves.toBe(true);
    });
  });

  describe('embeddings et quota', () => {
    type Resultat = { paused: boolean; progressed: boolean };

    function serviceEmbeddings(
      db: unknown,
      deps: {
        embeddingInputFor?: (appId: number) => Promise<unknown>;
        embedGame?: (input: unknown, options: unknown) => Promise<unknown>;
        remainingToday?: () => Promise<number>;
      } = {},
      config: Record<string, string | undefined> = {
        EMBEDDING_API_KEY: 'cle-de-test',
      },
    ): SyncService {
      return new SyncService(
        db as Db,
        {
          get: (cle: string) => config[cle],
        } as unknown as ConfigService,
        {} as LibraryService,
        {
          embeddingInputFor: deps.embeddingInputFor ?? (async () => null),
        } as unknown as GamesService,
        {} as AchievementsService,
        {
          embedGame: deps.embedGame ?? (async () => null),
          modelName: 'modele-test',
          textVersion: 2,
        } as unknown as EmbeddingService,
        {} as UsersService,
        {
          remainingToday: deps.remainingToday ?? (async () => 1000),
        } as unknown as RateLimitService,
      );
    }

    function dbMiseAJour() {
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

    it('saute les jeux sans texte et passe la source import', async () => {
      const { db, updates } = dbMiseAJour();
      const embeddingInputFor = vi.fn(async (appId: number) =>
        appId === 1 ? null : { name: `Jeu ${appId}` },
      );
      const embedGame = vi.fn(async () => [0.1, 0.2]);
      const service = serviceEmbeddings(db, {
        embeddingInputFor,
        embedGame,
      });
      vi.spyOn(service as never, 'appIdsSansEmbedding').mockResolvedValue([
        1, 2,
      ]);

      const resultat = await (
        service as never as {
          stepEmbeddings: (j: number, u: number) => Promise<Resultat>;
        }
      ).stepEmbeddings(1, 1);

      expect(resultat).toEqual({ paused: false, progressed: true });
      expect(embeddingInputFor).toHaveBeenCalledTimes(2);
      expect(embedGame).toHaveBeenCalledTimes(1);
      expect(embedGame).toHaveBeenCalledWith(
        { name: 'Jeu 2' },
        { source: 'import' },
      );
      expect(updates.some((u) => Array.isArray(u.embedding))).toBe(true);
    });

    it('quota atteint : la passe s’arrête sans relancer, le reliquat reste', async () => {
      const { db } = dbMiseAJour();
      const embedGame = vi.fn(async (input: unknown) => {
        if ((input as { name: string }).name === 'Jeu 3') {
          throw new QuotaReachedError();
        }
        return [0.1, 0.2];
      });
      const service = serviceEmbeddings(db, {
        embeddingInputFor: async (appId) => ({ name: `Jeu ${appId}` }),
        embedGame,
      });
      vi.spyOn(service as never, 'appIdsSansEmbedding').mockResolvedValue([
        1, 2, 3, 4,
      ]);

      const resultat = await (
        service as never as {
          stepEmbeddings: (j: number, u: number) => Promise<Resultat>;
        }
      ).stepEmbeddings(1, 1);

      expect(resultat).toEqual({ paused: false, progressed: false });
      expect(embedGame).toHaveBeenCalledTimes(3);
    });

    it('quota épuisé : processJob termine en done, jamais en error', async () => {
      const { db, updates } = dbMiseAJour();
      const setStatus = vi.fn(async () => {});
      const service = new SyncService(
        {
          ...db,
          select: () => ({
            from: () => ({
              where: () => ({
                limit: () => Promise.resolve([{ steamId: 'steam-1' }]),
              }),
            }),
          }),
        } as unknown as Db,
        { get: () => undefined } as unknown as ConfigService,
        {} as LibraryService,
        {
          embeddingInputFor: async () => ({ name: 'Jeu' }),
        } as unknown as GamesService,
        {} as AchievementsService,
        {
          embedGame: async () => {
            throw new QuotaReachedError();
          },
          modelName: 'modele-test',
          textVersion: 2,
        } as unknown as EmbeddingService,
        { setStatus } as unknown as UsersService,
        { remainingToday: async () => 0 } as unknown as RateLimitService,
      );
      vi.spyOn(service as never, 'planifierReprise').mockResolvedValue(
        undefined,
      );
      vi.spyOn(service as never, 'appIdsSansEmbedding').mockResolvedValue([1]);

      await (
        service as never as { processJob: (j: JobRow) => Promise<void> }
      ).processJob({
        id: 1,
        userId: 1,
        status: 'pending',
        step: 'embeddings',
        totalGames: 0,
        processedGames: 0,
        error: null,
        startedAt: null,
        finishedAt: null,
      });

      expect(updates.some((u) => u.status === 'done')).toBe(true);
      expect(updates.some((u) => u.status === 'error')).toBe(false);
      expect(setStatus).toHaveBeenCalledWith(1, 'done', expect.anything());
    });

    it('needsEmbeddings : vrai quand il reste des embeddings et du quota', async () => {
      const remainingToday = vi.fn(async () => 5);
      const service = serviceEmbeddings({}, { remainingToday });
      vi.spyOn(
        service as never,
        'compterEmbeddingsManquants',
      ).mockResolvedValue(3);

      await expect(service.needsEmbeddings(1)).resolves.toBe(true);
      expect(remainingToday).toHaveBeenCalledTimes(1);
    });

    it('needsEmbeddings : faux quand le quota du jour est épuisé', async () => {
      const remainingToday = vi.fn(async () => 0);
      const service = serviceEmbeddings({}, { remainingToday });
      vi.spyOn(
        service as never,
        'compterEmbeddingsManquants',
      ).mockResolvedValue(3);

      await expect(service.needsEmbeddings(1)).resolves.toBe(false);
    });

    it('needsEmbeddings : faux sans clé, sans consulter le quota', async () => {
      const remainingToday = vi.fn(async () => 5);
      const service = serviceEmbeddings({}, { remainingToday }, {});
      const compter = vi.spyOn(service as never, 'compterEmbeddingsManquants');

      await expect(service.needsEmbeddings(1)).resolves.toBe(false);
      expect(compter).not.toHaveBeenCalled();
      expect(remainingToday).not.toHaveBeenCalled();
    });

    it('needsEmbeddings : faux sans reliquat, sans consulter le quota', async () => {
      const remainingToday = vi.fn(async () => 5);
      const service = serviceEmbeddings({}, { remainingToday });
      vi.spyOn(
        service as never,
        'compterEmbeddingsManquants',
      ).mockResolvedValue(0);

      await expect(service.needsEmbeddings(1)).resolves.toBe(false);
      expect(remainingToday).not.toHaveBeenCalled();
    });

    it('currentJob : renvoie les quatre compteurs de reliquat', async () => {
      const job: JobRow = {
        id: 7,
        userId: 1,
        status: 'done',
        step: 'done',
        totalGames: 10,
        processedGames: 10,
        error: null,
        startedAt: new Date('2026-01-01'),
        finishedAt: new Date('2026-01-02'),
      };
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([job]) }),
          }),
        }),
      };
      const service = serviceEmbeddings(db);
      vi.spyOn(service as never, 'compterDetailsEnAttente').mockResolvedValue(
        3,
      );
      vi.spyOn(
        service as never,
        'compterDetailsIndisponibles',
      ).mockResolvedValue(1);
      vi.spyOn(service as never, 'compterSuccesManquants').mockResolvedValue(2);
      vi.spyOn(
        service as never,
        'compterEmbeddingsManquants',
      ).mockResolvedValue(4);

      await expect(service.currentJob(1)).resolves.toMatchObject({
        pendingDetails: 3,
        detailsUnavailable: 1,
        pendingAchievements: 2,
        pendingEmbeddings: 4,
      });
    });

    it('currentJob : null sans job, sans compter le reliquat', async () => {
      const db = {
        select: () => ({
          from: () => ({
            where: () => ({ limit: () => Promise.resolve([]) }),
          }),
        }),
      };
      const service = serviceEmbeddings(db);
      const compteur = vi.spyOn(service as never, 'compterEmbeddingsManquants');

      await expect(service.currentJob(1)).resolves.toBeNull();
      expect(compteur).not.toHaveBeenCalled();
    });
  });
});
