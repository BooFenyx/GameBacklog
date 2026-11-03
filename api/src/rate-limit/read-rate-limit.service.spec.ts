import type { ConfigService } from '@nestjs/config';
import { ReadRateLimitService } from './read-rate-limit.service.js';

function serviceAvecLimites(
  limites: Record<string, number>,
  horloge: () => number,
): ReadRateLimitService {
  const config = {
    get: (cle: string) => limites[cle],
  } as unknown as ConfigService;
  return new ReadRateLimitService(config, horloge);
}

describe('ReadRateLimitService', () => {
  it('autorise puis refuse au-delà du seuil de la route', () => {
    let maintenant = 0;
    const service = serviceAvecLimites(
      { LIBRARY_RATE_LIMIT_PER_MINUTE: 2 },
      () => maintenant,
    );

    expect(service.tryConsume('steam-1', 'library')).toEqual({
      allowed: true,
      retryAfterMs: 0,
    });
    expect(service.tryConsume('steam-1', 'library').allowed).toBe(true);

    const refuse = service.tryConsume('steam-1', 'library');
    expect(refuse.allowed).toBe(false);
    expect(refuse.retryAfterMs).toBeGreaterThan(0);

    maintenant = 60_001;
    expect(service.tryConsume('steam-1', 'library').allowed).toBe(true);
  });

  it('sépare les fenêtres par route et par utilisateur', () => {
    let maintenant = 0;
    const service = serviceAvecLimites(
      {
        LIBRARY_RATE_LIMIT_PER_MINUTE: 1,
        GAMES_RATE_LIMIT_PER_MINUTE: 1,
        HOME_RATE_LIMIT_PER_MINUTE: 1,
        SYNC_RATE_LIMIT_PER_MINUTE: 1,
      },
      () => maintenant,
    );

    expect(service.tryConsume('steam-1', 'library').allowed).toBe(true);
    expect(service.tryConsume('steam-1', 'library').allowed).toBe(false);
    expect(service.tryConsume('steam-1', 'games').allowed).toBe(true);
    expect(service.tryConsume('steam-1', 'home').allowed).toBe(true);
    expect(service.tryConsume('steam-1', 'sync').allowed).toBe(true);
    expect(service.tryConsume('steam-2', 'library').allowed).toBe(true);
  });

  it('utilise des valeurs par défaut si la configuration est absente', () => {
    const service = serviceAvecLimites({}, () => 0);
    for (let index = 0; index < 120; index += 1) {
      expect(service.tryConsume('steam-1', 'library').allowed).toBe(true);
    }
    expect(service.tryConsume('steam-1', 'library').allowed).toBe(false);
  });
});
