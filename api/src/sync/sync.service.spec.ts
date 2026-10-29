import type { ConfigService } from '@nestjs/config';
import type { Db } from '../db/db.module.js';
import { AchievementsService } from '../achievements/achievements.service.js';
import { EmbeddingService } from '../embedding/embedding.service.js';
import { GamesService } from '../games/games.service.js';
import { LibraryService } from '../library/library.service.js';
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
});
