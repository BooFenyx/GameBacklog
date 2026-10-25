import type { ConfigService } from '@nestjs/config';
import { SearchRateLimitService } from './search-rate-limit.service.js';

function makeService(
  now: () => number,
  env: Record<string, string | number> = {},
): SearchRateLimitService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  return new SearchRateLimitService(config, now);
}

describe('SearchRateLimitService', () => {
  let maintenant: number;

  beforeEach(() => {
    maintenant = 0;
  });

  const clock = () => maintenant;

  it('autorise les recherches sous le seuil sémantique', () => {
    const service = makeService(clock);

    for (let i = 0; i < 20; i += 1) {
      expect(service.tryConsume('joueur', 'semantic').allowed).toBe(true);
    }
  });

  it('bloque la 21e recherche sémantique avec le temps d’attente exact', () => {
    const service = makeService(clock);
    for (let i = 0; i < 20; i += 1) {
      service.tryConsume('joueur', 'semantic');
    }

    maintenant = 10_000;
    const decision = service.tryConsume('joueur', 'semantic');

    expect(decision.allowed).toBe(false);
    // Le premier appel date de 0 ms, il expire à 60 000 ms.
    expect(decision.retryAfterMs).toBe(50_000);
  });

  it('libère une place après expiration de la fenêtre', () => {
    const service = makeService(clock);
    for (let i = 0; i < 20; i += 1) {
      service.tryConsume('joueur', 'semantic');
    }

    maintenant = 60_000;
    expect(service.tryConsume('joueur', 'semantic').allowed).toBe(true);
  });

  it('sépare les limites du nom et de la description', () => {
    const service = makeService(clock);

    for (let i = 0; i < 20; i += 1) {
      service.tryConsume('joueur', 'semantic');
    }

    // Le mode nom possède sa propre fenêtre : l'aperçu reste disponible.
    expect(service.tryConsume('joueur', 'name').allowed).toBe(true);
  });

  it('applique la limite large du mode nom', () => {
    const service = makeService(clock, {
      SEARCH_NAME_RATE_LIMIT_PER_MINUTE: 3,
    });

    expect(service.tryConsume('joueur', 'name').allowed).toBe(true);
    expect(service.tryConsume('joueur', 'name').allowed).toBe(true);
    expect(service.tryConsume('joueur', 'name').allowed).toBe(true);
    expect(service.tryConsume('joueur', 'name').allowed).toBe(false);
  });

  it('isole les utilisateurs', () => {
    const service = makeService(clock);
    for (let i = 0; i < 20; i += 1) {
      service.tryConsume('joueur-a', 'semantic');
    }

    expect(service.tryConsume('joueur-a', 'semantic').allowed).toBe(false);
    expect(service.tryConsume('joueur-b', 'semantic').allowed).toBe(true);
  });

  it('respecte un seuil sémantique personnalisé', () => {
    const service = makeService(clock, {
      SEARCH_RATE_LIMIT_PER_MINUTE: 2,
    });

    expect(service.tryConsume('joueur', 'semantic').allowed).toBe(true);
    expect(service.tryConsume('joueur', 'semantic').allowed).toBe(true);
    expect(service.tryConsume('joueur', 'semantic').allowed).toBe(false);
  });

  it('retombe sur les défauts si la configuration est invalide', () => {
    const service = makeService(clock, {
      SEARCH_RATE_LIMIT_PER_MINUTE: 'beaucoup',
    });

    for (let i = 0; i < 20; i += 1) {
      expect(service.tryConsume('joueur', 'semantic').allowed).toBe(true);
    }
    expect(service.tryConsume('joueur', 'semantic').allowed).toBe(false);
  });
});
