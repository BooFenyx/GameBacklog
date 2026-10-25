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
});
