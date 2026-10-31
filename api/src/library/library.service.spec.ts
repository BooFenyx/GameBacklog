import { ServiceUnavailableException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Db } from '../db/db.module.js';
import { LibraryService } from './library.service.js';

function makeService(env: Record<string, string> = {}): LibraryService {
  const config = {
    get: (key: string) => env[key],
  } as unknown as ConfigService;
  const db = {} as unknown as Db;
  return new LibraryService(config, db);
}

describe('LibraryService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const reponseSteam = {
    response: {
      game_count: 4,
      games: [
        {
          appid: 730,
          name: 'Counter-Strike 2',
          playtime_forever: 120,
          playtime_2weeks: 120,
        },
        // Jeu physique sans métadonnées : doit être ignoré.
        { appid: 999, name: '' },
        { appid: 10, name: 'Counter-Strike' },
        {
          appid: 570,
          name: 'Dota 2',
          playtime_forever: 60,
          playtime_2weeks: 60,
        },
      ],
    },
  };

  it("construit l'URL GetOwnedGames avec clé et steamid", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ response: {} }) });
    vi.stubGlobal('fetch', fetchMock);

    await makeService({ STEAM_API_KEY: 'cle-secrete' }).ownedGames(
      '76561199123456789',
    );

    const url = String(fetchMock.mock.calls[0]?.[0]);
    expect(url).toContain('IPlayerService/GetOwnedGames/v1/');
    expect(url).toContain('key=cle-secrete');
    expect(url).toContain('steamid=76561199123456789');
    expect(url).toContain('include_appinfo=true');
  });

  it('renvoie les jeux triés par nom, sans les entrées sans nom', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => reponseSteam }),
    );

    const jeux = await makeService({ STEAM_API_KEY: 'cle' }).ownedGames(
      '76561199123456789',
    );

    expect(jeux).toEqual([
      {
        appId: 10,
        name: 'Counter-Strike',
        playtimeForever: 0,
        playtimeLast2Weeks: 0,
      },
      {
        appId: 730,
        name: 'Counter-Strike 2',
        playtimeForever: 120,
        playtimeLast2Weeks: 120,
      },
      {
        appId: 570,
        name: 'Dota 2',
        playtimeForever: 60,
        playtimeLast2Weeks: 60,
      },
    ]);
  });

  it('mappe playtime_2weeks et retombe à 0 quand le champ est absent', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: true, json: async () => reponseSteam }),
    );

    const jeux = await makeService({ STEAM_API_KEY: 'cle' }).ownedGames(
      '76561199123456789',
    );

    const parAppId = new Map(jeux.map((jeu) => [jeu.appId, jeu]));
    expect(parAppId.get(730)?.playtimeLast2Weeks).toBe(120);
    expect(parAppId.get(570)?.playtimeLast2Weeks).toBe(60);
    expect(parAppId.get(10)?.playtimeLast2Weeks).toBe(0);
  });

  it('ignore rtime_last_played : aucune exception propriétaire', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          response: {
            games: [
              {
                appid: 730,
                name: 'Counter-Strike 2',
                playtime_forever: 120,
                playtime_2weeks: 45,
                rtime_last_played: 1700000000,
              },
            ],
          },
        }),
      }),
    );

    const [jeu] = await makeService({ STEAM_API_KEY: 'cle' }).ownedGames(
      '76561199123456789',
    );

    expect(jeu).toMatchObject({
      appId: 730,
      playtimeForever: 120,
      playtimeLast2Weeks: 45,
    });
    expect(jeu).not.toHaveProperty('lastPlayedAt');
  });

  it('lève 503 si la clé Steam est absente', async () => {
    await expect(makeService().ownedGames('76561199123456789')).rejects.toThrow(
      ServiceUnavailableException,
    );
  });

  it('lève 503 si Steam refuse la lecture (profil privé, clé invalide)', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({ ok: false, status: 403 }),
    );

    await expect(
      makeService({ STEAM_API_KEY: 'cle' }).ownedGames('76561199123456789'),
    ).rejects.toThrow(ServiceUnavailableException);
  });

  it('lève 503 si Steam est injoignable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new Error('ECONNREFUSED')),
    );

    await expect(
      makeService({ STEAM_API_KEY: 'cle' }).ownedGames('76561199123456789'),
    ).rejects.toThrow(ServiceUnavailableException);
  });
});
