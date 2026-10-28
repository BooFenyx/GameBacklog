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
      { appid: 910001, name: 'Jeu Steam 1', playtime_forever: 120 },
      { appid: 910002, name: 'Jeu Steam 2', playtime_forever: 60 },
    ],
  },
};

describe('Bibliothèque (e2e)', () => {
  let app: NestExpressApplication;
  let moduleFixture: TestingModule;
  let db: Db;
  let userId: number;

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
    db = moduleFixture.get<Db>(DB);

    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const [utilisateur] = await db
      .select()
      .from(users)
      .where(eq(users.steamId, STEAM_ID))
      .limit(1);
    if (!utilisateur) throw new Error('Utilisateur non créé par le callback');
    userId = utilisateur.id;

    // Le test doit être déterministe même si la base de dev contient déjà cet
    // utilisateur (runs précédents) : on repart de sa seule bibliothèque semée.
    await db.delete(libraryEntries).where(eq(libraryEntries.userId, userId));

    await semerJeu(
      {
        appId: 424242,
        name: 'Jeu Semé',
        genres: ['Action'],
        genreIds: [1],
        categories: ['Solo'],
        categoryIds: [2],
        controllerSupport: 'full',
      },
      { playtimeForever: 42, playtimeLast2Weeks: 7 },
    );
    await semerJeu(
      {
        appId: 424243,
        name: 'Jeu Coop',
        genres: ['Aventure'],
        genreIds: [25],
        categories: ['Multijoueur', 'Coopération'],
        categoryIds: [1, 9],
        controllerSupport: 'partial',
      },
      { playtimeForever: 600, playtimeLast2Weeks: 0 },
    );
  }, 20000);

  async function semerJeu(
    jeu: {
      appId: number;
      name: string;
      genres: string[];
      genreIds: number[];
      categories: string[];
      categoryIds: number[];
      controllerSupport: 'none' | 'partial' | 'full';
    },
    temps: { playtimeForever: number; playtimeLast2Weeks: number },
  ): Promise<void> {
    const [ligne] = await db
      .insert(games)
      .values({
        ...jeu,
        filtersVersion: 1,
        headerImageUrl: `http://img/${jeu.appId}.jpg`,
        detailsFetchedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: games.appId,
        set: {
          ...jeu,
          filtersVersion: 1,
          headerImageUrl: `http://img/${jeu.appId}.jpg`,
          detailsFetchedAt: new Date(),
        },
      })
      .returning();

    const lastPlayedAt =
      temps.playtimeForever > 0 ? new Date('2024-01-02T03:04:05.000Z') : null;
    await db
      .insert(libraryEntries)
      .values({
        userId,
        gameId: ligne.id,
        ...temps,
        lastPlayedAt,
        achievementsUnlocked: 3,
      })
      .onConflictDoUpdate({
        target: [libraryEntries.userId, libraryEntries.gameId],
        set: {
          ...temps,
          lastPlayedAt,
          achievementsUnlocked: 3,
        },
      });
  }

  afterEach(async () => {
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.STEAM_API_KEY;
  });

  it('renvoie 401 sans session ouverte', async () => {
    await request(app.getHttpServer()).get('/api/library').expect(401);
  });

  it('renvoie une page enrichie (enveloppe, modes, total)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const res = await agent.get('/api/library').expect(200);

    expect(res.body).toMatchObject({
      limit: 48,
      offset: 0,
      hasMore: false,
    });
    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          appId: 424242,
          name: 'Jeu Semé',
          playtimeForever: 42,
          playtimeLast2Weeks: 7,
          genres: ['Action'],
          modes: ['solo'],
          controllerSupport: 'full',
          headerImageUrl: 'http://img/424242.jpg',
          achievementsUnlocked: 3,
        }),
      ]),
    );
    // Les champs lourds inutilisés par la liste ne sont plus renvoyés.
    expect(res.body.items[0]).not.toHaveProperty('categories');
    expect(res.body.items[0]).not.toHaveProperty('shortDescription');
  });

  it('filtre par genre et par mode (OR dans le groupe)', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const parGenre = await agent.get('/api/library?genres=25').expect(200);
    expect(parGenre.body.total).toBe(1);
    expect(parGenre.body.items[0].name).toBe('Jeu Coop');

    const parMode = await agent.get('/api/library?modes=coop').expect(200);
    expect(parMode.body.total).toBe(1);
    expect(parMode.body.items[0].name).toBe('Jeu Coop');
  });

  it('combine q, manette et état', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const res = await agent
      .get('/api/library?q=jeu&manette=full&etat=joue')
      .expect(200);

    expect(res.body.items.map((jeu: { name: string }) => jeu.name)).toEqual([
      'Jeu Semé',
    ]);
  });

  it('trie par temps de jeu et pagine', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const page = await agent.get('/api/library?tri=temps&limit=1').expect(200);

    expect(page.body.items).toHaveLength(1);
    expect(page.body.items[0].name).toBe('Jeu Coop');
    expect(page.body.hasMore).toBe(true);
    expect(page.body.total).toBeGreaterThan(1);

    const suivante = await agent
      .get('/api/library?tri=temps&limit=1&offset=1')
      .expect(200);
    expect(suivante.body.items[0].name).not.toBe('Jeu Coop');
  });

  it('refuse un filtre invalide', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    await agent.get('/api/library?genres=abc').expect(400);
    await agent.get('/api/library?modes=inconnu').expect(400);
    await agent.get('/api/library?tri=inconnu').expect(400);
    await agent.get('/api/library?manette=partial').expect(400);
  });

  it('renvoie les facettes de la bibliothèque', async () => {
    const agent = request.agent(app.getHttpServer());
    await agent
      .get(`/api/auth/steam/return?${RETURN_QUERY}`)
      .redirects(0)
      .expect(302);

    const res = await agent.get('/api/library/facets').expect(200);

    expect(res.body.total).toBeGreaterThanOrEqual(2);
    expect(res.body.genres).toEqual(
      expect.arrayContaining([
        { id: 1, label: 'Action', count: 1 },
        { id: 25, label: 'Aventure', count: 1 },
      ]),
    );
    expect(res.body.modes).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'solo', count: 1 }),
        expect.objectContaining({ value: 'coop', count: 1 }),
      ]),
    );
    expect(res.body.etats).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ value: 'jamais', count: 0 }),
        expect.objectContaining({ value: 'joue' }),
      ]),
    );
    expect(
      res.body.etats.map((etat: { value: string }) => etat.value),
    ).toEqual(['jamais', 'joue']);
  });
});
