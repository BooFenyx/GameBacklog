import { describe, expect, it, vi } from 'vitest';
import { IpRateLimit } from './ip-rate-limit.js';

describe('IpRateLimit', () => {
  it('laisse passer les requêtes sous la limite', () => {
    const limite = new IpRateLimit(2, 60_000, () => 0);
    expect(limite.retryAfterMs('1.2.3.4')).toBe(0);
    expect(limite.retryAfterMs('1.2.3.4')).toBe(0);
  });

  it('renvoie le temps d’attente quand la limite est atteinte', () => {
    const now = vi.fn().mockReturnValue(0);
    const limite = new IpRateLimit(2, 60_000, now);
    limite.retryAfterMs('1.2.3.4');
    now.mockReturnValue(10_000);
    limite.retryAfterMs('1.2.3.4');
    expect(limite.retryAfterMs('1.2.3.4')).toBe(50_000);
  });

  it('isole les clés', () => {
    const limite = new IpRateLimit(1, 60_000, () => 0);
    expect(limite.retryAfterMs('1.2.3.4')).toBe(0);
    expect(limite.retryAfterMs('5.6.7.8')).toBe(0);
    expect(limite.retryAfterMs('1.2.3.4')).toBeGreaterThan(0);
  });

  it('libère la place après la fenêtre', () => {
    const now = vi.fn().mockReturnValue(0);
    const limite = new IpRateLimit(1, 60_000, now);
    expect(limite.retryAfterMs('1.2.3.4')).toBe(0);
    now.mockReturnValue(60_000);
    expect(limite.retryAfterMs('1.2.3.4')).toBe(0);
  });
});

describe('IpRateLimit.cleClient', () => {
  it('privilégie la première entrée de X-Forwarded-For', () => {
    expect(
      IpRateLimit.cleClient({
        headers: { 'x-forwarded-for': '203.0.113.7, 10.0.0.1' },
        ip: '10.0.0.1',
      }),
    ).toBe('203.0.113.7');
  });

  it('accepte un en-tête sous forme de tableau', () => {
    expect(
      IpRateLimit.cleClient({
        headers: { 'x-forwarded-for': ['198.51.100.2, 10.0.0.1'] },
      }),
    ).toBe('198.51.100.2');
  });

  it('retombe sur req.ip puis sur la socket', () => {
    expect(IpRateLimit.cleClient({ ip: '192.0.2.4' })).toBe('192.0.2.4');
    expect(
      IpRateLimit.cleClient({ socket: { remoteAddress: '192.0.2.5' } }),
    ).toBe('192.0.2.5');
    expect(IpRateLimit.cleClient({})).toBe('inconnu');
  });
});
