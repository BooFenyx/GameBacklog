import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import type { ConfigService } from '@nestjs/config';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Db } from '../src/db/db.module.js';
import { games, libraryEntries, users } from '../src/db/schema.js';
import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { SearchRateLimitService } from '../src/search/search-rate-limit.service.js';

const STEAM_ID = '76561199000000003';
const FRONTEND_URL = 'http://localhost:5173';
const VECTOR_DIMENSIONS = 1024;

const RETURN_QUERY = [
  'openid.ns=http://specs.openid.net/auth/2.0',
  'openid.mode=id_res',
  `openid.claimed_id=https://steamcommunity.com/openid/id/${STEAM_ID}`,
  `openid.identity=https://steamcommunity.com/openid/id/${STEAM_ID}`,
].join('&');

function vecteur(index: number): number[] {
  return Array.from({ length: VECTOR_DIMENSIONS }, (_, i) =>
    i === index ? 1 : 0,
  );
}

const VECTEUR_REQUETE = vecteur(0);

async function semerJeu(
  db: Db,
  userId: number,
  appId: number,
  name: string,
  embedding: number[],
): Promise<void> {
  const [jeu] = await db
    .insert(games)
    .values({
      appId,
      name,
      shortDescription: `Description de ${name}`,
      genres: ['Puzzle'],
      controllerSupport: 'full',
      headerImageUrl: `https://cdn/${appId}.jpg`,
      embedding,
      embeddingModel: 'test',
      detailsFetchedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: games.appId,
      set: { name, embedding, embeddingModel: 'test' },
    })
    .returning();

  await db
    .insert(libraryEntries)
    .values({ userId, gameId: jeu.id, playtimeForever: 60 })
    .onConflictDoUpdate({
      target: [libraryEntries.userId, libraryEntries.gameId],
      set: { playtimeForever: 60 },
    });
}

describe('Recherche (e2e)', () => {
  let app: NestExpressApplication;
  let moduleFixture: TestingModule;
  let embedMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
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
                players: [{ steamid: STEAM_ID, personaname: 'Recherche Test' }],
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

    embedMock = vi.fn().mockResolvedValue(VECTEUR_REQUETE);
    // Limiteur réel, mais configuré à 2 recherches sémantiques par minute :
    // le test 429 reste déterministe sans dépendre du `.env` local.
    const rateLimit = new SearchRateLimitService(
      {
        get: (key: string) =>
          key === 'SEARCH_RATE_LIMIT_PER_MINUTE' ? 2 : undefined,
      } as unknown as ConfigService,
      () => Date.now(),
    );

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmbeddingService)
      .useValue({
        embed: embedMock,
        embedGame: vi.fn().mockResolvedValue(null),
        buildText: vi.fn(),
        modelName: 'test',
      })
      .overrideProvider(SearchRateLimitService)
      .useValue(rateLimit)
      .compile();

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

  async function ouvrirSession(): Promise<{
    agent: ReturnType<typeof request.agent>;
    db: Db;
    userId: number;
  }> {
    const agent = request.agent(app.getHttpServer());
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
    if (!utilisateur) {
      throw new Error('Utilisateur non créé par le callback');
    }
    return { agent, db, userId: utilisateur.id };
  }

  async function semerBibliotheque(db: Db, userId: number): Promise<void> {
    await semerJeu(db, userId, 930001, 'Portal', vecteur(0));
    await semerJeu(db, userId, 930002, 'Portal 2', vecteur(0));
    await semerJeu(db, userId, 930003, 'Portal Stories: Mel', vecteur(0));
    await semerJeu(db, userId, 930004, 'The Witness', vecteur(1));
    await semerJeu(db, userId, 930005, 'Borderlands 2', vecteur(2));
  }

  it('renvoie 401 sans session ouverte', async () => {
    await request(app.getHttpServer())
      .get('/api/search?q=portal&mode=name')
      .expect(401);
  });

  it('renvoie 400 sans requête ou sans mode', async () => {
    const { agent } = await ouvrirSession();

    await agent.get('/api/search?mode=name').expect(400);
    await agent.get('/api/search?q=portal').expect(400);
  });

  it('refuse les paramètres non déclarés', async () => {
    const { agent } = await ouvrirSession();

    await agent.get('/api/search?q=portal&mode=name&inconnu=1').expect(400);
  });

  it('recherche par nom sans appeler Gemini', async () => {
    const { agent, db, userId } = await ouvrirSession();
    await semerBibliotheque(db, userId);

    const res = await agent
      .get('/api/search?q=Portal&mode=name&limit=20')
      .expect(200);

    expect(res.body.mode).toBe('name');
    expect(res.body.degraded).toBe(false);
    expect(
      res.body.results.map((resultat: { name: string }) => resultat.name),
    ).toEqual(['Portal', 'Portal 2', 'Portal Stories: Mel']);
    expect(res.body.results[0]).toMatchObject({
      appId: 930001,
      score: null,
      source: 'name',
    });
    expect(embedMock).not.toHaveBeenCalled();
  });

  it('pagine les résultats par nom', async () => {
    const { agent, db, userId } = await ouvrirSession();
    await semerBibliotheque(db, userId);

    const premiere = await agent
      .get('/api/search?q=Portal&mode=name&limit=2&offset=0')
      .expect(200);
    expect(premiere.body.results).toHaveLength(2);
    expect(premiere.body.hasMore).toBe(true);

    const seconde = await agent
      .get('/api/search?q=Portal&mode=name&limit=2&offset=2')
      .expect(200);
    expect(seconde.body.results).toHaveLength(1);
    expect(seconde.body.hasMore).toBe(false);
    expect(seconde.body.offset).toBe(2);
  });

  it('recherche sémantiquement et met la série citée en tête', async () => {
    const { agent, db, userId } = await ouvrirSession();
    await semerBibliotheque(db, userId);

    const res = await agent
      .get('/api/search?q=jeu%20comme%20Portal&mode=semantic&limit=20')
      .expect(200);

    expect(res.body.mode).toBe('semantic');
    expect(res.body.degraded).toBe(false);
    expect(embedMock).toHaveBeenCalledWith('jeu comme Portal', {
      maxWaitMs: 1500,
    });
    const premiers = res.body.results.slice(0, 2);
    expect(premiers.map((resultat: { name: string }) => resultat.name)).toEqual(
      ['Portal', 'Portal 2'],
    );
    expect(premiers[0]).toMatchObject({
      source: 'series',
      criteria: ['Se rapproche de Portal'],
    });
    expect(premiers[0].score).toBeGreaterThan(0.99);
  });

  it('bascule en repli dégradé quand Gemini est indisponible', async () => {
    const { agent, db, userId } = await ouvrirSession();
    await semerBibliotheque(db, userId);
    embedMock.mockResolvedValueOnce(null);

    const res = await agent
      .get('/api/search?q=jeu%20comme%20Portal&mode=semantic')
      .expect(200);

    expect(res.body.degraded).toBe(true);
    expect(res.body.mode).toBe('semantic');
    expect(res.body.message).toContain('indisponible');
    expect(res.body.results[0]).toMatchObject({ name: 'Portal', score: null });
  });

  it('réutilise le cache pour deux recherches identiques', async () => {
    const { agent } = await ouvrirSession();

    await agent
      .get('/api/search?q=jeu%20tr%C3%A8s%20calme&mode=semantic')
      .expect(200);
    await agent
      .get('/api/search?q=jeu%20tr%C3%A8s%20calme&mode=semantic')
      .expect(200);

    expect(embedMock).toHaveBeenCalledTimes(1);
  });

  it('renvoie 429 avec Retry-After au-delà du seuil sémantique', async () => {
    const { agent } = await ouvrirSession();

    await agent.get('/api/search?q=calme&mode=semantic').expect(200);
    await agent.get('/api/search?q=paisible&mode=semantic').expect(200);

    const res = await agent.get('/api/search?q=zen&mode=semantic').expect(429);
    expect(res.headers['retry-after']).toBeDefined();
  });
});
