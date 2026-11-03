import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ouvrirSessionTest } from './session-test.js';

const STEAM_ID = '76561199123456789';
const FRONTEND_URL = 'http://localhost:5173';
const PROFILE = {
  steamId: STEAM_ID,
  displayName: 'Test Steam',
  avatarFull: 'https://cdn.example/avatar.jpg',
  profileUrl: 'https://steamcommunity.com/id/test-steam',
};

describe('Persistance de la session Steam (e2e)', () => {
  let app: NestExpressApplication;

  beforeEach(async () => {
    // À définir avant `compile()` : `ConfigModule` lit l'environnement au
    // démarrage du module. Le vrai Steam est remplacé par un fetch factice.
    process.env.STEAM_API_KEY = 'cle-de-test';

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: unknown) => {
        const url = String(input);
        if (url.includes('steamcommunity.com/openid')) {
          return {
            text: async () =>
              'ns:http://specs.openid.net/auth/2.0\nis_valid:true\n',
          };
        }
        if (url.includes('GetPlayerSummaries')) {
          return {
            ok: true,
            json: async () => ({
              response: {
                players: [
                  {
                    steamid: PROFILE.steamId,
                    personaname: PROFILE.displayName,
                    avatarfull: PROFILE.avatarFull,
                    profileurl: PROFILE.profileUrl,
                  },
                ],
              },
            }),
          };
        }
        if (url.includes('GetOwnedGames')) {
          return {
            ok: true,
            json: async () => ({ response: { game_count: 0 } }),
          };
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

  it('GET /api/auth/me renvoie { user: null } hors session', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/me')
      .expect(200);

    expect(res.body).toEqual({ user: null });
    expect(res.headers['cache-control']).toBe('no-store');
  });

  it('GET /api/auth/steam redirige vers la page OpenID de Steam', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/auth/steam')
      .redirects(0)
      .expect(302);

    expect(res.headers.location).toMatch(
      /^https:\/\/steamcommunity\.com\/openid\/login\?/,
    );
  });

  it('ouvre une session, la retrouve à chaque requête puis la détruit', async () => {
    const server = app.getHttpServer();
    const agent = request.agent(server);

    const retour = await ouvrirSessionTest(agent, FRONTEND_URL, STEAM_ID);
    expect(retour.status).toBe(302);

    expect(retour.headers.location).toBe(`${FRONTEND_URL}/?auth=success`);

    const setCookie = (retour.headers['set-cookie'] ?? []) as string[];
    const sessionCookie = setCookie.find((cookie) =>
      cookie.startsWith('connect.sid='),
    );
    expect(sessionCookie).toBeDefined();
    expect(sessionCookie).toContain('HttpOnly');
    expect(sessionCookie).toContain('SameSite=Lax');
    // Durée de vie du cookie : 7 jours (cf. `app.setup.ts`).
    const expires = new Date(
      /Expires=([^;]+)/.exec(sessionCookie)?.[1] ?? '',
    ).getTime();
    expect(expires - Date.now()).toBeGreaterThan(6 * 24 * 60 * 60 * 1000);
    expect(expires - Date.now()).toBeLessThanOrEqual(7 * 24 * 60 * 60 * 1000);

    // Le cookie seul suffit à retrouver la session : elle est bien stockée
    // côté serveur et non dans le cookie.
    const cookie = sessionCookie.split(';')[0];
    const attendu = {
      user: {
        steamId: STEAM_ID,
        displayName: PROFILE.displayName,
        avatarUrl: PROFILE.avatarFull,
        profileUrl: PROFILE.profileUrl,
      },
    };

    const premiere = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(premiere.body).toEqual(attendu);

    // Nouvelle connexion TCP, même cookie : la session a persisté.
    const seconde = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(seconde.body).toEqual(attendu);

    // Sans cookie, il n'y a bien personne.
    const anonyme = await request(server).get('/api/auth/me').expect(200);
    expect(anonyme.body).toEqual({ user: null });

    // La déconnexion détruit la session : le même cookie ne remonte plus rien.
    await request(server)
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(204);

    const apres = await request(server)
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);
    expect(apres.body).toEqual({ user: null });
  });

  it('renvoie vers le front avec une erreur si Steam invalide la signature', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ text: async () => 'is_valid:false\n' })),
    );

    const agent = request.agent(app.getHttpServer());
    const res = await ouvrirSessionTest(agent, FRONTEND_URL, STEAM_ID);
    expect(res.status).toBe(302);

    expect(res.headers.location).toBe(`${FRONTEND_URL}/?auth=error`);
    // La session ouverte par `/api/auth/steam` n'est pas authentifiée : le
    // cookie existe, mais `/api/auth/me` doit rester anonyme.
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body).toEqual({ user: null });
  });

  it('refuse un callback OpenID sans state', async () => {
    const agent = request.agent(app.getHttpServer());
    const res = await agent
      .get('/api/auth/steam/return?openid.mode=id_res')
      .redirects(0)
      .expect(302);

    expect(res.headers.location).toBe(`${FRONTEND_URL}/?auth=error`);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body).toEqual({ user: null });
  });

  it('refuse un callback avec un state qui ne correspond pas à la session', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent.get('/api/auth/steam').redirects(0).expect(302);

    const res = await agent
      .get('/api/auth/steam/return?openid.mode=id_res&state=mauvais')
      .redirects(0)
      .expect(302);

    expect(res.headers.location).toBe(`${FRONTEND_URL}/?auth=error`);
    const me = await agent.get('/api/auth/me').expect(200);
    expect(me.body).toEqual({ user: null });
  });
});
