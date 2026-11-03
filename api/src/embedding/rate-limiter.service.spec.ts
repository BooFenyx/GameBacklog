import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { DB } from '../db/db.module.js';
import { MinuteWindow, RateLimitService } from './rate-limiter.service.js';

describe('MinuteWindow', () => {
  it('laisse passer quand la fenêtre est libre', () => {
    const now = vi.fn().mockReturnValue(0);
    const window = new MinuteWindow(3, 60_000, now);
    expect(window.waitMillis()).toBe(0);
    window.record(0);
    window.record(1000);
    expect(window.waitMillis()).toBe(0);
  });

  it('retourne le temps exact d’attente quand la fenêtre est pleine', () => {
    const now = vi.fn().mockReturnValue(50_000);
    const window = new MinuteWindow(2, 60_000, now);
    window.record(0);
    window.record(30_000);
    // 2 appels dans la fenêtre : le premier expire à 60 000 ms.
    expect(window.waitMillis()).toBe(10_000);
  });

  it('purge les appels trop anciens', () => {
    const now = vi.fn().mockReturnValue(0);
    const window = new MinuteWindow(2, 60_000, now);
    window.record(0);
    window.record(10_000);
    now.mockReturnValue(70_000);
    // Les deux appels datent de plus d'une minute : la fenêtre est libre.
    expect(window.waitMillis()).toBe(0);
    window.record(70_000);
    expect(window.waitMillis()).toBe(0);
  });

  it('count ne compte que les appels de la fenêtre courante', () => {
    const now = vi.fn().mockReturnValue(10_000);
    const window = new MinuteWindow(5, 60_000, now);
    window.record(0);
    window.record(0);
    window.record(0);
    expect(window.count()).toBe(3);
    now.mockReturnValue(61_000);
    expect(window.count()).toBe(0);
  });

  it('waitMillis respecte une limite inférieure à la fenêtre', () => {
    const now = vi.fn().mockReturnValue(10_000);
    const window = new MinuteWindow(5, 60_000, now);
    window.record(0);
    window.record(0);
    window.record(0);
    expect(window.waitMillis(5)).toBe(0);
    expect(window.waitMillis(3)).toBe(50_000);
  });
});

describe('RateLimitService', () => {
  const KEY = 'embedding_gemini';
  let service: RateLimitService;
  let pool: { query: ReturnType<typeof vi.fn> };
  let config: { get: ReturnType<typeof vi.fn> };

  const row = (count: number, windowStartedAt: Date) => ({
    rows: [{ count, window_started_at: windowStartedAt }],
  });

  beforeEach(async () => {
    pool = { query: vi.fn() };
    config = { get: vi.fn() };
    config.get.mockImplementation((key: string) => {
      if (key === 'EMBEDDING_RATE_LIMIT_PER_DAY') return 2;
      if (key === 'EMBEDDING_RATE_LIMIT_PER_MINUTE') return 10;
      if (key === 'EMBEDDING_USER_RATE_LIMIT_PER_DAY') return 3;
      return undefined;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RateLimitService,
        { provide: ConfigService, useValue: config },
        { provide: DB, useValue: { $client: pool } },
      ],
    }).compile();

    service = module.get<RateLimitService>(RateLimitService);
  });

  it('insère le compteur au premier appel', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(service.acquire()).resolves.toBe('ok');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO rate_limits'),
      expect.anything(),
    );
  });

  it('incrémente le compteur tant qu’il reste sous le quota', async () => {
    pool.query.mockResolvedValue(row(1, new Date()));
    await expect(service.acquire()).resolves.toBe('ok');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rate_limits SET count = count + 1'),
      [KEY],
    );
  });

  it('renvoie quota-journalier quand le compteur du jour est épuisé', async () => {
    pool.query.mockResolvedValue(row(2, new Date()));
    await expect(service.acquire()).resolves.toBe('quota-journalier');
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rate_limits SET count = count + 1'),
      [KEY],
    );
  });

  it("renvoie busy sans toucher à la base quand l'attente dépasse maxWaitMs", async () => {
    pool.query.mockResolvedValue(row(1, new Date()));

    for (let i = 0; i < 10; i += 1) {
      await expect(service.acquire()).resolves.toBe('ok');
    }
    const appelsBase = pool.query.mock.calls.length;

    // La fenêtre minute est pleine : une attente nulle renvoie immédiatement
    // `busy`, sans consommer de créneau ni interroger la base.
    await expect(service.acquire(0)).resolves.toBe('busy');
    expect(pool.query).toHaveBeenCalledTimes(appelsBase);
  });

  it('réinitialise la fenêtre journalière après 24 heures', async () => {
    const ilYaPlusDe24h = new Date(Date.now() - 25 * 60 * 60 * 1000);
    pool.query.mockResolvedValue(row(2, ilYaPlusDe24h));
    await expect(service.acquire()).resolves.toBe('ok');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT (key) DO UPDATE SET count = 1'),
      [KEY, expect.any(Date)],
    );
  });

  it('remainingToday : max quand aucun compteur n’existe', async () => {
    pool.query.mockResolvedValue({ rows: [] });
    await expect(service.remainingToday()).resolves.toBe(2);
  });

  it('remainingToday : max moins le compteur frais', async () => {
    pool.query.mockResolvedValue(row(1, new Date()));
    await expect(service.remainingToday()).resolves.toBe(1);
  });

  it('remainingToday : max quand la fenêtre a plus de 24 h', async () => {
    const ilYaPlusDe24h = new Date(Date.now() - 25 * 60 * 60 * 1000);
    pool.query.mockResolvedValue(row(2, ilYaPlusDe24h));
    await expect(service.remainingToday()).resolves.toBe(2);
  });

  it('remainingToday : zéro quand le quota du jour est épuisé', async () => {
    pool.query.mockResolvedValue(row(2, new Date()));
    await expect(service.remainingToday()).resolves.toBe(0);
  });

  it('réserve 20 % de la fenêtre minute à la recherche pendant l’import', async () => {
    pool.query.mockResolvedValue(row(1, new Date()));

    // 10 appels/min : l'import s'arrête à 8, la recherche peut encore appeler.
    for (let i = 0; i < 8; i += 1) {
      await expect(service.acquire(0, 'import')).resolves.toBe('ok');
    }
    await expect(service.acquire(0, 'import')).resolves.toBe('busy');
    await expect(service.acquire(0, 'search')).resolves.toBe('ok');
  });

  it('renvoie quota-utilisateur quand le compteur personnel est épuisé', async () => {
    pool.query.mockImplementation((_sql: string, params: unknown[]) => {
      if (params?.[0] === 'embedding_user:42') {
        return Promise.resolve(row(3, new Date()));
      }
      return Promise.resolve(row(1, new Date()));
    });

    await expect(service.acquire(0, 'search', 42)).resolves.toBe(
      'quota-utilisateur',
    );
    // Le quota global ne doit pas être consommé par un utilisateur bloqué.
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rate_limits SET count = count + 1'),
      [KEY],
    );
  });

  it('incrémente le compteur personnel sous le quota', async () => {
    pool.query.mockImplementation((_sql: string, params: unknown[]) => {
      if (params?.[0] === 'embedding_user:42') {
        return Promise.resolve(row(1, new Date()));
      }
      return Promise.resolve(row(1, new Date()));
    });

    await expect(service.acquire(0, 'search', 42)).resolves.toBe('ok');
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rate_limits SET count = count + 1'),
      ['embedding_user:42'],
    );
  });

  it('ne compte pas l’import dans le quota personnel', async () => {
    pool.query.mockResolvedValue(row(1, new Date()));

    await expect(service.acquire(0, 'import', 42)).resolves.toBe('ok');
    expect(pool.query).not.toHaveBeenCalledWith(
      expect.stringContaining('UPDATE rate_limits SET count = count + 1'),
      ['embedding_user:42'],
    );
  });
});
