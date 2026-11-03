import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ReadRateLimitService } from '../src/rate-limit/read-rate-limit.service.js';
import { ouvrirSessionTest } from './session-test.js';

const STEAM_ID = '76561199000000005';
const FRONTEND_URL = 'http://localhost:5173';

describe('Rate limiting des lectures (e2e)', () => {
  let app: NestExpressApplication;
  let agent: ReturnType<typeof request.agent>;

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
                players: [{ steamid: STEAM_ID, personaname: 'Limite Test' }],
              },
            }),
          };
        }
        if (url.includes('GetOwnedGames')) {
          return {
            ok: true,
            json: async () => ({ response: { game_count: 0, games: [] } }),
          };
        }
        if (url.includes('appdetails')) {
          return { ok: true, json: async () => ({}) };
        }
        throw new Error(`Appel réseau inattendu : ${url}`);
      }),
    );

    const limiteur = new ReadRateLimitService({
      get: (cle: string) =>
        ({
          LIBRARY_RATE_LIMIT_PER_MINUTE: 2,
          GAMES_RATE_LIMIT_PER_MINUTE: 2,
          HOME_RATE_LIMIT_PER_MINUTE: 2,
        })[cle],
    } as unknown as ConfigService);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(ReadRateLimitService)
      .useValue(limiteur)
      .compile();

    const expressApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(expressApp, FRONTEND_URL, 'test-session-secret');
    await expressApp.init();
    app = expressApp;

    agent = request.agent(app.getHttpServer());
    await ouvrirSessionTest(agent, FRONTEND_URL, STEAM_ID);
  });

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.STEAM_API_KEY;
  });

  it('renvoie 401 sans session, sans consommer de fenêtre', async () => {
    await request(app.getHttpServer()).get('/api/library').expect(401);
    await request(app.getHttpServer()).get('/api/home').expect(401);
  });

  it('limite /api/library par steamId et renvoie Retry-After', async () => {
    await agent.get('/api/library').expect(200);
    await agent.get('/api/library').expect(200);

    const refus = await agent.get('/api/library').expect(429);
    expect(refus.headers['retry-after']).toBeDefined();
  });

  it('limite /api/home avec sa propre fenêtre', async () => {
    await agent.get('/api/home').expect(200);
    await agent.get('/api/home').expect(200);

    const refus = await agent.get('/api/home').expect(429);
    expect(refus.headers['retry-after']).toBeDefined();
  });

  it('limite /api/games même quand le jeu est absent', async () => {
    await agent.get('/api/games/999999').expect(404);
    await agent.get('/api/games/999999').expect(404);

    await agent.get('/api/games/999999').expect(429);
  });
});
