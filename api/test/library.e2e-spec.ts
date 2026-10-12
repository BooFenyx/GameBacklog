import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Db } from '../src/db/db.module.js';
import { games, libraryEntries, users } from '../src/db/schema.js';

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
  let moduleFixture: TestingModule;

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
        // `appdetails` (import en tâche de fond) : pas de fiche → l'import
        // poursuit sans échouer.
        if (url.includes('appdetails')) {
          return { ok: true, json: async () => ({}) };
        }
        throw new Error(`Appel réseau inattendu : ${url}`);
      }),
    );

    moduleFixture = await Test.createTestingModule({
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

  it('renvoie les jeux persistés en base, enrichis pour la page', async () => {
    const agent = request.agent(app.getHttpServer());

    // Ouvre une vraie session en passant par le callback OpenID Steam : cela
    // crée l'utilisateur et déclenche l'import en tâche de fond.
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const db = moduleFixture.get<Db>(DB);
    const [utilisateur] = await db
      .select()
      .from(users)
      .where(eq(users.steamId, STEAM_ID))
      .limit(1);
    expect(utilisateur).toBeDefined();
    if (!utilisateur) throw new Error('Utilisateur non créé par le callback');

    // Semé directement : `GET /api/library` lit désormais la base, pas Steam.
    const appId = 424242;
    const [jeu] = await db
      .insert(games)
      .values({
        appId,
        name: 'Jeu Semé',
        shortDescription: 'Un jeu de test',
        genres: ['Action'],
        categories: ['Solo'],
        controllerSupport: 'full',
        headerImageUrl: 'http://img/cover.jpg',
        detailsFetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: games.appId,
        set: { name: 'Jeu Semé' },
      })
      .returning();

    const lastPlayedAt = new Date('2024-01-02T03:04:05.000Z');
    await db
      .insert(libraryEntries)
      .values({
        userId: utilisateur.id,
        gameId: jeu.id,
        playtimeForever: 42,
        playtimeLast2Weeks: 7,
        lastPlayedAt,
        achievementsUnlocked: 3,
      })
      .onConflictDoUpdate({
        target: [libraryEntries.userId, libraryEntries.gameId],
        set: {
          playtimeForever: 42,
          playtimeLast2Weeks: 7,
          lastPlayedAt,
          achievementsUnlocked: 3,
        },
      });

    const res = await agent.get('/api/library').expect(200);

    expect(res.body).toEqual(
      expect.arrayContaining([
        {
          appId,
          name: 'Jeu Semé',
          playtimeForever: 42,
          playtimeLast2Weeks: 7,
          lastPlayedAt: lastPlayedAt.toISOString(),
          genres: ['Action'],
          categories: ['Solo'],
          controllerSupport: 'full',
          shortDescription: 'Un jeu de test',
          headerImageUrl: 'http://img/cover.jpg',
          achievementsUnlocked: 3,
        },
      ]),
    );
  });
});
