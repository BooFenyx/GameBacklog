import 'reflect-metadata';
import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, inArray } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Db } from '../src/db/db.module.js';
import { games, libraryEntries, users } from '../src/db/schema.js';
import { EMBEDDING_TEXT_VERSION } from '../src/embedding/embedding.service.js';
import { FILTERS_VERSION } from '../src/games/games.service.js';
import { ouvrirSessionTest } from './session-test.js';

const STEAM_ID = '76561199000000004';
const FRONTEND_URL = 'http://localhost:5173';
const VECTOR_DIMENSIONS = 1024;

/** Jeux semés par ce test, nettoyés en `afterEach`. */
const APP_IDS = [940001, 940002, 940003, 940004, 940005, 940006, 940007];

function vecteur(index: number): number[] {
  return Array.from({ length: VECTOR_DIMENSIONS }, (_, i) =>
    i === index ? 1 : 0,
  );
}

interface OptionsJeu {
  appId: number;
  name: string;
  genres: string[];
  genreIds: number[];
  shortDescription?: string;
  controllerSupport?: 'none' | 'partial' | 'full';
  embedding: number[];
  playtimeForever?: number;
  playtimeLast2Weeks?: number;
  lastActivityAt?: Date | null;
  lastActivitySource?: 'sync_delta' | 'recent_window' | 'achievement' | null;
  achievementsTotal?: number;
  achievementsUnlocked?: number | null;
}

async function semerJeu(
  db: Db,
  userId: number,
  options: OptionsJeu,
): Promise<void> {
  const controllerSupport = options.controllerSupport ?? 'full';
  const playtimeForever = options.playtimeForever ?? 60;
  const playtimeLast2Weeks = options.playtimeLast2Weeks ?? 0;
  const achievementsTotal = options.achievementsTotal ?? 0;
  const achievementsUnlocked =
    options.achievementsUnlocked === undefined
      ? 0
      : options.achievementsUnlocked;
  const maintenant = new Date('2024-02-01T00:00:00.000Z');
  const valeursJeu = {
    appId: options.appId,
    name: options.name,
    shortDescription: options.shortDescription ?? 'Un jeu de la bibliothèque.',
    genres: options.genres,
    genreIds: options.genreIds,
    categories: [] as string[],
    categoryIds: [] as number[],
    filtersVersion: FILTERS_VERSION,
    controllerSupport,
    headerImageUrl: `http://img/${options.appId}.jpg`,
    detailsFetchedAt: maintenant,
    embedding: options.embedding,
    embeddingModel: 'test',
    embeddingTextVersion: EMBEDDING_TEXT_VERSION,
    achievementsTotal,
    achievementsFetchedAt: maintenant,
  };

  const [jeu] = await db
    .insert(games)
    .values(valeursJeu)
    .onConflictDoUpdate({ target: games.appId, set: valeursJeu })
    .returning();

  const lastActivityAt = options.lastActivityAt ?? null;
  const valeursEntree = {
    userId,
    gameId: jeu.id,
    playtimeForever,
    playtimeLast2Weeks,
    lastActivityAt,
    lastActivitySource: options.lastActivitySource ?? null,
    lastActivityPrecision: lastActivityAt ? ('upper_bound' as const) : null,
    achievementsUnlocked,
    achievementsFetchedAt: maintenant,
  };

  await db
    .insert(libraryEntries)
    .values(valeursEntree)
    .onConflictDoUpdate({
      target: [libraryEntries.userId, libraryEntries.gameId],
      set: valeursEntree,
    });
}

describe('Accueil (e2e)', () => {
  let app: NestExpressApplication;
  let moduleFixture: TestingModule;
  let db: Db;
  let userId: number;
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
                players: [{ steamid: STEAM_ID, personaname: 'Accueil Test' }],
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

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const expressApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(expressApp, FRONTEND_URL, 'test-session-secret');
    await expressApp.init();
    app = expressApp;
    db = moduleFixture.get<Db>(DB);

    agent = request.agent(app.getHttpServer());
    await ouvrirSessionTest(agent, FRONTEND_URL, STEAM_ID);

    const [utilisateur] = await db
      .select()
      .from(users)
      .where(eq(users.steamId, STEAM_ID))
      .limit(1);
    if (!utilisateur) throw new Error('Utilisateur non créé par le callback');
    userId = utilisateur.id;

    await db.delete(libraryEntries).where(eq(libraryEntries.userId, userId));
  });

  afterEach(async () => {
    if (db) {
      await db.delete(games).where(inArray(games.appId, APP_IDS));
    }
    await app.close();
    vi.unstubAllGlobals();
    delete process.env.STEAM_API_KEY;
  });

  async function semerAncre(): Promise<void> {
    // Ancre : « voitures » + genre Course automobile, jouée ces 14 derniers jours.
    await semerJeu(db, userId, {
      appId: 940001,
      name: 'Ancre Course',
      genres: ['Action', 'Course automobile'],
      genreIds: [1, 9],
      shortDescription: 'Football et voitures font bon ménage.',
      controllerSupport: 'partial',
      embedding: vecteur(0),
      playtimeForever: 1000,
      playtimeLast2Weeks: 240,
      lastActivityAt: new Date('2024-01-06T12:00:00.000Z'),
      lastActivitySource: 'recent_window',
      achievementsTotal: 10,
      achievementsUnlocked: 5,
    });
  }

  async function semerBibliotheque(): Promise<void> {
    await semerAncre();

    // Meilleur voisin : même genre, même ambiance, joué depuis la dernière sync.
    await semerJeu(db, userId, {
      appId: 940002,
      name: 'Voisin Même Genre',
      genres: ['Action', 'Course automobile'],
      genreIds: [1, 9],
      controllerSupport: 'full',
      embedding: vecteur(0),
      playtimeForever: 600,
      lastActivityAt: new Date('2024-01-05T12:00:00.000Z'),
      lastActivitySource: 'sync_delta',
      achievementsTotal: 10,
      achievementsUnlocked: 5,
    });

    // Voisin d'ambiance : genre Action seulement (1 genre en commun).
    await semerJeu(db, userId, {
      appId: 940003,
      name: 'Voisin Action',
      genres: ['Action'],
      genreIds: [1],
      controllerSupport: 'partial',
      embedding: vecteur(0),
      playtimeForever: 60,
      lastActivityAt: new Date('2024-01-04T12:00:00.000Z'),
      lastActivitySource: 'recent_window',
      achievementsTotal: 10,
      // Progression inaccessible : ne doit jamais être comptée comme 0 succès.
      achievementsUnlocked: null,
    });

    // Jamais lancé, ambiance orthogonale : doit sortir du top 5.
    await semerJeu(db, userId, {
      appId: 940004,
      name: 'Jamais Lancé Lointain',
      genres: ['Indépendant'],
      genreIds: [15],
      controllerSupport: 'none',
      embedding: vecteur(1),
      playtimeForever: 0,
    });

    // Genre prioritaire mais ambiance orthogonale : remonte par le bonus genre.
    await semerJeu(db, userId, {
      appId: 940005,
      name: 'Genre Seul',
      genres: ['Course automobile'],
      genreIds: [9],
      controllerSupport: 'partial',
      embedding: vecteur(2),
      playtimeForever: 300,
    });

    // Quasi terminé : tête de « À finir ».
    await semerJeu(db, userId, {
      appId: 940006,
      name: 'Quasi Terminé',
      genres: ['Action'],
      genreIds: [1],
      controllerSupport: 'full',
      embedding: vecteur(0),
      playtimeForever: 900,
      achievementsTotal: 10,
      achievementsUnlocked: 9,
    });

    // Jamais lancé, même ambiance que l'ancre : tête de « À découvrir ».
    await semerJeu(db, userId, {
      appId: 940007,
      name: 'À Découvrir Proche',
      genres: ['Aventure'],
      genreIds: [25],
      controllerSupport: 'none',
      embedding: vecteur(0),
      playtimeForever: 0,
      achievementsTotal: 5,
      achievementsUnlocked: 0,
    });
  }

  it('renvoie 401 sans session ouverte', async () => {
    await request(app.getHttpServer()).get('/api/home').expect(401);
  });

  it('renvoie une réponse vide pour une bibliothèque vide', async () => {
    const res = await agent.get('/api/home').expect(200);

    expect(res.body).toEqual({
      jeuDuMoment: null,
      selection: {
        anchor: null,
        genre: null,
        decouverte: 30,
        manette: false,
        lancement: 'tous',
        progression: false,
        items: [],
      },
      categories: { aFinir: [], aDecouvrir: [], aRetrouver: [] },
      menu: {
        temps: 45,
        intention: 'continuer',
        manette: false,
        resultat: null,
        signals: null,
      },
      ancresRecentes: [],
    });
  });

  it('inclut le jeu du moment dans le menu, même sans voisin', async () => {
    await semerAncre();

    const res = await agent.get('/api/home').expect(200);

    expect(res.body.selection.items).toEqual([]);
    expect(res.body.menu.resultat).toMatchObject({
      appId: 940001,
      reason: 'Joué ces 14 derniers jours · 5 succès restants',
    });
  });

  it('calcule le jeu du moment, le deck, les catégories et le menu', async () => {
    await semerBibliotheque();

    const res = await agent.get('/api/home').expect(200);

    // Jeu du moment : fenêtre de 14 jours prioritaire.
    expect(res.body.jeuDuMoment).toMatchObject({
      appId: 940001,
      name: 'Ancre Course',
      playtimeForever: 1000,
      playtimeLast2Weeks: 240,
      lastActivitySource: 'recent_window',
      achievementsUnlocked: 5,
      achievementsTotal: 10,
      reason: null,
    });

    // Deck par défaut : 5 voisins, l'ancre est exclue.
    expect(res.body.selection).toMatchObject({
      decouverte: 30,
      manette: false,
      lancement: 'tous',
      progression: false,
      genre: { id: 9, label: 'Course automobile' },
      anchor: {
        appId: 940001,
        name: 'Ancre Course',
        genreIds: [1, 9],
        mainGenre: { id: 9, label: 'Course automobile' },
      },
    });
    expect(
      res.body.selection.items.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940002, 940003, 940007, 940006, 940005]);
    expect(res.body.selection.items[0]).toMatchObject({
      appId: 940002,
      reason: 'Même genre · Course automobile',
    });
    expect(res.body.selection.items[1]).toMatchObject({
      appId: 940003,
      reason: 'Voisin de Ancre Course · 1 genre en commun',
      achievementsUnlocked: null,
      achievementsTotal: 10,
    });
    expect(
      res.body.selection.items.some(
        (jeu: { appId: number }) => jeu.appId === 940004,
      ),
    ).toBe(false);

    // Catégories : 3 max par section, raisons côté serveur.
    expect(
      res.body.categories.aFinir.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940006, 940001, 940002]);
    expect(res.body.categories.aFinir[0].reason).toBe('1 succès restant');
    expect(
      res.body.categories.aDecouvrir.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940007, 940004]);
    expect(res.body.categories.aDecouvrir[0].reason).toBe('Jamais lancé');
    expect(
      res.body.categories.aRetrouver.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940001, 940002, 940003]);
    expect(res.body.categories.aRetrouver[1].reason).toBe('Joué récemment');
    expect(res.body.categories.aRetrouver[2].reason).toBe(
      'Ces 14 derniers jours',
    );

    // Menu par défaut : 45 min, continuer, sans manette.
    expect(res.body.menu).toMatchObject({
      temps: 45,
      intention: 'continuer',
      manette: false,
      resultat: {
        appId: 940002,
        reason: 'Joué depuis ta dernière sync · 5 succès restants',
      },
    });
    expect(res.body.menu.signals).toMatchObject({
      continuite: 'Joué depuis ta dernière sync',
      progression: '5 succès sur 10',
      decouverte: 'Déjà lancé',
      similarite: 'Ambiance proche de Ancre Course',
      manette: 'Manette non filtrée',
    });
    expect(res.body.menu.signals.temps).toContain('pas une durée de partie');

    // Ancres récentes : 5, dans l'ordre du jeu du moment.
    expect(
      res.body.ancresRecentes.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940001, 940002, 940003, 940006, 940005]);
  });

  it('paramètre l’ancre et déduit son genre principal', async () => {
    await semerBibliotheque();

    const res = await agent
      .get('/api/home/selection?anchor=940003')
      .expect(200);

    expect(res.body.anchor).toMatchObject({
      appId: 940003,
      mainGenre: { id: 1, label: 'Action' },
    });
    expect(res.body.genre).toEqual({ id: 1, label: 'Action' });
    expect(
      res.body.items.map((jeu: { appId: number }) => jeu.appId),
    ).not.toContain(940003);
    expect(res.body.items[0]).toMatchObject({
      appId: 940002,
      reason: 'Même genre · Action',
    });
    expect(res.body.items).toHaveLength(5);
  });

  it('renvoie 404 pour une ancre absente de la bibliothèque', async () => {
    await semerBibliotheque();

    const res = await agent
      .get('/api/home/selection?anchor=999999')
      .expect(404);
    expect(res.body.message).toBe('Jeu de référence introuvable');
  });

  it('gère genre=0 sans bonus et refuse un genre inconnu', async () => {
    await semerBibliotheque();

    const sansGenre = await agent
      .get('/api/home/selection?genre=0')
      .expect(200);
    expect(sansGenre.body.genre).toBeNull();
    expect(sansGenre.body.items[0].appId).toBe(940003);
    expect(
      sansGenre.body.items.every(
        (jeu: { reason: string }) => !jeu.reason.startsWith('Même genre'),
      ),
    ).toBe(true);

    const genrePrioritaire = await agent
      .get('/api/home/selection?genre=25')
      .expect(200);
    expect(genrePrioritaire.body.genre).toEqual({
      id: 25,
      label: 'Aventure',
    });
    expect(genrePrioritaire.body.items[0]).toMatchObject({
      appId: 940007,
      reason: 'Même genre · Aventure',
    });

    await agent.get('/api/home/selection?genre=9999').expect(400);
  });

  it('applique les filtres manette, lancement et progression', async () => {
    await semerBibliotheque();

    const manette = await agent
      .get('/api/home/selection?manette=true')
      .expect(200);
    expect(
      manette.body.items.map(
        (jeu: { controllerSupport: string }) => jeu.controllerSupport,
      ),
    ).toEqual(['full', 'partial', 'full', 'partial']);
    expect(
      manette.body.items.some((jeu: { appId: number }) => jeu.appId === 940004),
    ).toBe(false);

    const jamais = await agent
      .get('/api/home/selection?lancement=jamais')
      .expect(200);
    expect(
      jamais.body.items.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940007, 940004]);
    expect(
      jamais.body.items.every(
        (jeu: { playtimeForever: number }) => jeu.playtimeForever === 0,
      ),
    ).toBe(true);

    const deja = await agent
      .get('/api/home/selection?lancement=deja')
      .expect(200);
    expect(
      deja.body.items.every(
        (jeu: { playtimeForever: number }) => jeu.playtimeForever > 0,
      ),
    ).toBe(true);

    // 940004 et 940005 ont `achievements_total = 0` : la division du filtre
    // doit rester neutralisée par `NULLIF`, pas provoquer un 500.
    const proches = await agent
      .get('/api/home/selection?progression=true')
      .expect(200);
    expect(
      proches.body.items.map((jeu: { appId: number }) => jeu.appId),
    ).toEqual([940006]);
  });

  it('fait monter les jeux peu joués quand la découverte augmente', async () => {
    await semerBibliotheque();

    const faible = await agent
      .get('/api/home/selection?decouverte=10')
      .expect(200);
    const forte = await agent
      .get('/api/home/selection?decouverte=100')
      .expect(200);

    expect(faible.body.decouverte).toBe(10);
    expect(forte.body.decouverte).toBe(100);
    expect(faible.body.items[1].appId).toBe(940003);
    expect(forte.body.items[1].appId).toBe(940007);
  });

  it('refuse les paramètres invalides ou inconnus', async () => {
    await semerBibliotheque();

    await agent.get('/api/home/selection?decouverte=5').expect(400);
    await agent.get('/api/home/selection?genre=-1').expect(400);
    await agent.get('/api/home/selection?anchor=abc').expect(400);
    await agent.get('/api/home/selection?manette=partial').expect(400);
    await agent.get('/api/home/selection?lancement=inconnu').expect(400);
    await agent.get('/api/home/selection?inconnu=1').expect(400);
  });

  it('renvoie 401 sans session sur la sélection', async () => {
    await request(app.getHttpServer()).get('/api/home/selection').expect(401);
  });

  it('paramètre le menu (temps, intention, manette)', async () => {
    await semerBibliotheque();

    const finir = await agent
      .get('/api/home/menu?temps=30&intention=finir')
      .expect(200);
    expect(finir.body).toMatchObject({
      temps: 30,
      intention: 'finir',
      manette: false,
      resultat: {
        appId: 940006,
        reason: '1 succès restant sur 10',
      },
    });

    const decouvrir = await agent
      .get('/api/home/menu?temps=120&intention=decouvrir')
      .expect(200);
    expect(decouvrir.body.resultat).toMatchObject({
      appId: 940007,
      reason: 'Jamais lancé',
    });
    expect(decouvrir.body.signals).toMatchObject({
      decouverte: 'Jamais lancé',
      temps: expect.stringContaining('120 min'),
    });

    const manette = await agent.get('/api/home/menu?manette=true').expect(200);
    expect(manette.body.manette).toBe(true);
    expect(manette.body.resultat.controllerSupport).toBe('full');
  });

  it('inclut l’ancre dans le menu et refuse une ancre absente', async () => {
    await semerAncre();

    const res = await agent
      .get('/api/home/menu?anchor=940001&intention=finir&temps=45')
      .expect(200);
    expect(res.body.resultat).toMatchObject({
      appId: 940001,
      reason: '5 succès restants sur 10',
    });

    await agent.get('/api/home/menu?anchor=999999').expect(404);
  });

  it('refuse les paramètres de menu invalides ou inconnus', async () => {
    await semerBibliotheque();

    await agent.get('/api/home/menu?temps=50').expect(400);
    await agent.get('/api/home/menu?intention=inconnu').expect(400);
    await agent.get('/api/home/menu?anchor=abc').expect(400);
    await agent.get('/api/home/menu?manette=partial').expect(400);
    await agent.get('/api/home/menu?inconnu=1').expect(400);
  });

  it('renvoie 401 sans session sur le menu', async () => {
    await request(app.getHttpServer()).get('/api/home/menu').expect(401);
  });
});
