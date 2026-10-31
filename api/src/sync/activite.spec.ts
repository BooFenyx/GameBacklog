import type { EntreePrecedente } from './activite.js';
import { deriverActivite, normaliserDernierSucces } from './activite.js';

const MAINTENANT = new Date('2024-06-01T12:00:00.000Z');
const SUCCES = new Date('2024-05-20T08:00:00.000Z');
const ACTIVITE_ANCIENNE = new Date('2024-04-01T08:00:00.000Z');

function precedent(
  overrides: Partial<EntreePrecedente> = {},
): EntreePrecedente {
  return {
    playtimeForever: 100,
    lastActivityAt: null,
    lastActivitySource: null,
    lastActivityPrecision: null,
    lastSeenAt: new Date('2024-05-01T12:00:00.000Z'),
    ...overrides,
  };
}

describe('normaliserDernierSucces', () => {
  it('renvoie null quand aucun succès n’est connu', () => {
    expect(normaliserDernierSucces(null)).toBeNull();
    expect(normaliserDernierSucces(undefined)).toBeNull();
  });

  it('conserve une Date déjà typée', () => {
    expect(normaliserDernierSucces(SUCCES)).toBe(SUCCES);
  });

  it('convertit une chaîne de type timestamp UTC', () => {
    expect(normaliserDernierSucces('2025-08-13 12:21:48')).toEqual(
      new Date('2025-08-13T12:21:48.000Z'),
    );
  });

  it('lève une erreur explicite pour une chaîne invalide', () => {
    expect(() => normaliserDernierSucces('pas une date')).toThrow(
      'dernierSuccesAt doit être une Date',
    );
  });

  it('lève une erreur explicite pour un type inattendu', () => {
    expect(() =>
      normaliserDernierSucces(42 as unknown as Date),
    ).toThrow('dernierSuccesAt doit être une Date (reçu: number)');
  });
});

describe('deriverActivite', () => {
  it('ne dérive rien à la première synchronisation sans signal', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 0 },
        precedent({ lastSeenAt: null }),
        null,
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it('dérive sync_delta quand le temps de jeu augmente', () => {
    expect(
      deriverActivite(
        { playtimeForever: 150, playtime2Weeks: 0 },
        precedent(),
        null,
        MAINTENANT,
      ),
    ).toEqual({
      at: MAINTENANT,
      source: 'sync_delta',
      precision: 'upper_bound',
    });
  });

  it('dérive recent_window quand playtime_2weeks est positif', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 30 },
        precedent(),
        null,
        MAINTENANT,
      ),
    ).toEqual({
      at: MAINTENANT,
      source: 'recent_window',
      precision: 'upper_bound',
    });
  });

  it('dérive achievement comme borne basse à partir du dernier succès', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 0 },
        precedent(),
        SUCCES,
        MAINTENANT,
      ),
    ).toEqual({
      at: SUCCES,
      source: 'achievement',
      precision: 'lower_bound',
    });
  });

  it('conserve sync_delta face à recent_window', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 30 },
        precedent({
          lastActivitySource: 'sync_delta',
          lastActivityAt: ACTIVITE_ANCIENNE,
        }),
        null,
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it('remplace recent_window par sync_delta sur une hausse', () => {
    expect(
      deriverActivite(
        { playtimeForever: 150, playtime2Weeks: 30 },
        precedent({
          lastActivitySource: 'recent_window',
          lastActivityAt: ACTIVITE_ANCIENNE,
        }),
        null,
        MAINTENANT,
      ),
    ).toEqual({
      at: MAINTENANT,
      source: 'sync_delta',
      precision: 'upper_bound',
    });
  });

  it('conserve recent_window face à un succès', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 0 },
        precedent({
          lastActivitySource: 'recent_window',
          lastActivityAt: ACTIVITE_ANCIENNE,
        }),
        SUCCES,
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it('met à jour achievement quand le succès est plus récent', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 0 },
        precedent({
          lastActivitySource: 'achievement',
          lastActivityAt: ACTIVITE_ANCIENNE,
        }),
        SUCCES,
        MAINTENANT,
      ),
    ).toEqual({
      at: SUCCES,
      source: 'achievement',
      precision: 'lower_bound',
    });
  });

  it('ne dérive pas sync_delta quand le temps de jeu baisse', () => {
    expect(
      deriverActivite(
        { playtimeForever: 50, playtime2Weeks: 0 },
        precedent({ playtimeForever: 100 }),
        null,
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it('conserve sync_delta quand aucun signal ne le remplace', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 0 },
        precedent({
          lastActivitySource: 'sync_delta',
          lastActivityAt: ACTIVITE_ANCIENNE,
        }),
        null,
        MAINTENANT,
      ),
    ).toBeNull();
  });

  it('conserve achievement quand le succès n’est pas plus récent', () => {
    expect(
      deriverActivite(
        { playtimeForever: 100, playtime2Weeks: 0 },
        precedent({
          lastActivitySource: 'achievement',
          lastActivityAt: SUCCES,
        }),
        SUCCES,
        MAINTENANT,
      ),
    ).toBeNull();
  });
});
