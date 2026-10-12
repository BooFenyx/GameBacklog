import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';

const STEAM_ID = '76561199123456789';
const FRONTEND_URL = 'http://localhost:5173';

/** Requête de retour OpenID, telle que Steam la renvoie au callback. */
const RETURN_QUERY = [
  'openid.ns=http://specs.openid.net/auth/2.0',
  'openid.mode=id_res',
  `openid.claimed_id=https://steamcommunity.com/openid/id/${STEAM_ID}`,
  `openid.identity=https://steamcommunity.com/openid/id/${STEAM_ID}`,
].join('&');

/** Réponse factice de `GetOwnedGames`, dans l'ordre brut de Steam. */
const JEUX_STEAM = {
  response: {
    game_count: 2,
    games: [
      { appid: 730, name: 'Counter-Strike 2', playtime_forever: 120 },
      { appid: 570, name: 'Dota 2', playtime_forever: 60 },
    ],
  },
};

describe('Bibliothèque (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    process.env.STEAM_API_KEY = 'cle-de-test';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('steamcommunity.com/openid')) {
          return { text: async () => 'is_valid:true\n' };
        }
        if (url.includes('GetPlayerSummaries')) {
          return {
            ok: true,
            json: async () => ({
              response: {
                players: [{ steamid: STEAM_ID, personaname: 'Test Steam' }],
              },
            }),
          };
        }
        if (url.includes('GetOwnedGames')) {
          return { ok: true, json: async () => JEUX_STEAM };
        }
        throw new Error(`Appel réseau inattendu : ${url}`);
      }),
    );

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const expressApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(expressApp, FRONTEND_URL, 'test-session-secret');
    await expressApp.init();
    app = expressApp;
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.STEAM_API_KEY;
  });

  it('renvoie 401 sans session ouverte', async () => {
    await request(app.getHttpServer()).get('/api/library').expect(401);
  });

  it('renvoie les jeux possédés, triés par nom, pour un utilisateur connecté', async () => {
    const agent = request.agent(app.getHttpServer());

    // Ouvre une vraie session en passant par le callback OpenID Steam.
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const res = await agent.get('/api/library').expect(200);

    expect(res.body).toEqual([
      {
        appId: 730,
        name: 'Counter-Strike 2',
        playtimeForever: 120,
        playtimeLast2Weeks: 0,
        lastPlayedAt: null,
      },
      {
        appId: 570,
        name: 'Dota 2',
        playtimeForever: 60,
        playtimeLast2Weeks: 0,
        lastPlayedAt: null,
      },
    ]);
  });
});
