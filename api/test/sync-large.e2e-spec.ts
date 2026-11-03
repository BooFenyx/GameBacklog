import { Test, TestingModule } from '@nestjs/testing';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { and, eq, gte, isNotNull, lt } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { DB, type Db } from '../src/db/db.module.js';
import {
  achievements,
  games,
  libraryEntries,
  syncJobs,
  userAchievements,
  users,
} from '../src/db/schema.js';
import { EmbeddingService } from '../src/embedding/embedding.service.js';
import { RateLimitService } from '../src/embedding/rate-limiter.service.js';
import { SyncService } from '../src/sync/sync.service.js';
import { ouvrirSessionTest } from './session-test.js';

const STEAM_ID = '76561199000000100';
const FRONTEND_URL = 'http://localhost:5173';
const NB_JEUX = 250;
const PREMIER_APP_ID = 940001;
/** Borne haute exclue : 940001 → 940250. */
const FIN_APP_ID = PREMIER_APP_ID + NB_JEUX;
const TIMEOUT_JOB_MS = 120_000;

/**
 * Throttles et budget à zéro : l'import doit rester rapide et déterministe en
 * CI. `SYNC_STEP_MAX_MS=0` désactive la reprise par budget pour que la passe
 * aille au bout en un job.
 */
const ENV_TEST: Record<string, string> = {
  STEAM_API_KEY: 'cle-de-test',
  APPDETAILS_THROTTLE_MS: '0',
  ACHIEVEMENTS_THROTTLE_MS: '0',
  ACHIEVEMENTS_BATCH_SIZE: '200',
  ACHIEVEMENTS_MAX_GAMES_PER_SYNC: '0',
  SYNC_STEP_MAX_MS: '0',
  // Le test interroge `/api/sync` en boucle serrée (50 ms) : sans cette marge,
  // la limite de 60/min des lectures ferait échouer l'attente.
  SYNC_RATE_LIMIT_PER_MINUTE: '10000',
};

const JEUX_STEAM = {
  response: {
    game_count: NB_JEUX,
    games: Array.from({ length: NB_JEUX }, (_, index) => {
      const appId = PREMIER_APP_ID + index;
      return {
        appid: appId,
        name: `Jeu ${appId}`,
        playtime_forever: 60,
        playtime_2weeks: 0,
      };
    }),
  },
};

const SUCCES_SCHEMA = {
  game: {
    availableGameStats: {
      achievements: [
        {
          name: 'A1',
          displayName: 'Succès 1',
          description: 'Premier succès',
          icon: 'https://cdn.example/a1.jpg',
        },
        {
          name: 'A2',
          displayName: 'Succès 2',
          description: 'Deuxième succès',
          icon: 'https://cdn.example/a2.jpg',
        },
        {
          name: 'A3',
          displayName: 'Succès 3',
          description: 'Troisième succès',
          icon: 'https://cdn.example/a3.jpg',
        },
      ],
    },
  },
};

const SUCCES_JOUEUR = {
  playerstats: {
    success: true,
    achievements: [
      { apiname: 'A1', achieved: 1, unlocktime: 1_700_000_000 },
      { apiname: 'A2', achieved: 0 },
      { apiname: 'A3', achieved: 0 },
    ],
  },
};

function reponse(json: unknown) {
  return { ok: true, status: 200, json: async () => json };
}

function ficheSteam(appId: number) {
  return {
    [appId]: {
      success: true,
      data: {
        name: `Jeu ${appId}`,
        short_description: 'Description',
        genres: [{ id: '1', description: 'Action' }],
        categories: [{ id: '2', description: 'Solo' }],
        header_image: 'https://cdn.example/header.jpg',
        release_date: { date: '1 janv. 2020' },
      },
    },
  };
}

describe('Import volumineux (e2e)', () => {
  let app: NestExpressApplication;
  let moduleFixture: TestingModule;
  let db: Db;
  let service: SyncService;
  let agent: ReturnType<typeof request.agent>;
  let userId: number;
  const anciennesEnv = new Map<string, string | undefined>();

  beforeEach(async () => {
    for (const [cle, valeur] of Object.entries(ENV_TEST)) {
      anciennesEnv.set(cle, process.env[cle]);
      process.env[cle] = valeur;
    }

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
          return reponse({
            response: {
              players: [{ steamid: STEAM_ID, personaname: 'Test 250' }],
            },
          });
        }
        if (url.includes('GetOwnedGames')) {
          const steamId = new URL(url).searchParams.get('steamid');
          if (steamId !== STEAM_ID) {
            throw new Error(`GetOwnedGames inattendu pour ${steamId}`);
          }
          return reponse(JEUX_STEAM);
        }
        if (url.includes('appdetails')) {
          const appId = Number(/appids=(\d+)/.exec(url)?.[1]);
          return reponse(ficheSteam(appId));
        }
        if (url.includes('GetSchemaForGame')) {
          return reponse(SUCCES_SCHEMA);
        }
        if (url.includes('GetPlayerAchievements')) {
          return reponse(SUCCES_JOUEUR);
        }
        throw new Error(`Appel réseau inattendu : ${url}`);
      }),
    );

    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(EmbeddingService)
      .useValue({
        modelName: 'fake-embedding',
        textVersion: 2,
        embedGame: async () => Array.from({ length: 1024 }, () => 0.01),
        embed: async () => Array.from({ length: 1024 }, () => 0.01),
      })
      .overrideProvider(RateLimitService)
      .useValue({
        remainingToday: async () => 1000,
        acquire: async () => 'ok',
      })
      .compile();

    const expressApp =
      moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(expressApp, FRONTEND_URL, 'test-session-secret');
    await expressApp.init();
    app = expressApp;
    db = moduleFixture.get<Db>(DB);
    service = moduleFixture.get<SyncService>(SyncService);

    // Repart d'un état propre même si un run précédent a été interrompu.
    await supprimerDonnees();

    agent = request.agent(app.getHttpServer());
    await ouvrirSessionTest(agent, FRONTEND_URL, STEAM_ID);

    const [utilisateur] = await db
      .select()
      .from(users)
      .where(eq(users.steamId, STEAM_ID))
      .limit(1);
    if (!utilisateur) throw new Error('Utilisateur non créé par le callback');
    userId = utilisateur.id;
  });

  afterEach(async () => {
    await supprimerDonnees();
    await app.close();
    vi.unstubAllGlobals();
    for (const cle of Object.keys(ENV_TEST)) {
      const ancienne = anciennesEnv.get(cle);
      if (ancienne === undefined) delete process.env[cle];
      else process.env[cle] = ancienne;
    }
    anciennesEnv.clear();
  });

  async function supprimerDonnees(): Promise<void> {
    if (!db) return;
    await db.delete(users).where(eq(users.steamId, STEAM_ID));
    await db
      .delete(games)
      .where(
        and(gte(games.appId, PREMIER_APP_ID), lt(games.appId, FIN_APP_ID)),
      );
  }

  async function attendreFin(): Promise<Record<string, unknown>> {
    const limite = Date.now() + TIMEOUT_JOB_MS;
    let dernier: Record<string, unknown> | null = null;

    while (Date.now() < limite) {
      const res = await agent.get('/api/sync').expect(200);
      dernier = res.body as Record<string, unknown>;
      if (dernier.status === 'error') {
        throw new Error(`Import en erreur : ${String(dernier.error)}`);
      }
      if (dernier.status === 'done' && dernier.step === 'done') {
        return dernier;
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(
      `Import non terminé après ${TIMEOUT_JOB_MS} ms : ${JSON.stringify(dernier)}`,
    );
  }

  it(
    'importe 250 jeux en un seul job complet',
    async () => {
      await agent.post('/api/sync').expect(201);

      const statut = await attendreFin();

      const entrees = await db
        .select({ gameId: libraryEntries.gameId })
        .from(libraryEntries)
        .where(eq(libraryEntries.userId, userId));
      expect(entrees).toHaveLength(NB_JEUX);

      const fiches = await db
        .select({ appId: games.appId })
        .from(games)
        .where(
          and(
            gte(games.appId, PREMIER_APP_ID),
            lt(games.appId, FIN_APP_ID),
            isNotNull(games.detailsFetchedAt),
          ),
        );
      expect(fiches).toHaveLength(NB_JEUX);

      const compteurs = await db
        .select({ appId: games.appId })
        .from(games)
        .where(
          and(
            gte(games.appId, PREMIER_APP_ID),
            lt(games.appId, FIN_APP_ID),
            isNotNull(games.achievementsFetchedAt),
          ),
        );
      expect(compteurs).toHaveLength(NB_JEUX);

      const embeddings = await db
        .select({ appId: games.appId })
        .from(games)
        .where(
          and(
            gte(games.appId, PREMIER_APP_ID),
            lt(games.appId, FIN_APP_ID),
            isNotNull(games.embedding),
          ),
        );
      expect(embeddings).toHaveLength(NB_JEUX);

      const succes = await db
        .select({ id: achievements.id })
        .from(achievements)
        .innerJoin(games, eq(achievements.gameId, games.id))
        .where(
          and(gte(games.appId, PREMIER_APP_ID), lt(games.appId, FIN_APP_ID)),
        );
      expect(succes).toHaveLength(NB_JEUX * 3);

      // Seul le succès débloqué est persisté pour le joueur : un par jeu.
      const debloques = await db
        .select({ achievementId: userAchievements.achievementId })
        .from(userAchievements)
        .where(eq(userAchievements.userId, userId));
      expect(debloques).toHaveLength(NB_JEUX);

      const [job] = await db
        .select()
        .from(syncJobs)
        .where(eq(syncJobs.userId, userId))
        .limit(1);
      if (!job) throw new Error('Job de sync absent');
      expect(job).toMatchObject({ status: 'done', step: 'done', error: null });

      expect(statut).toMatchObject({
        status: 'done',
        step: 'done',
        pendingDetails: 0,
        detailsUnavailable: 0,
        pendingAchievements: 0,
        pendingEmbeddings: 0,
      });

      await expect(service.needsAchievements(userId)).resolves.toBe(false);
      await expect(service.needsEmbeddings(userId)).resolves.toBe(false);

      // Seconde sync : les succès sont déjà en base, donc `syncLibrary` exécute
      // `max(unlocked_at)` sur des lignes réelles. C'est le chemin exact du P0
      // (`value.toISOString is not a function`) qui n'était pas couvert.
      await agent.post('/api/sync').expect(201);
      const statut2 = await attendreFin();
      expect(statut2).toMatchObject({
        status: 'done',
        step: 'done',
        pendingDetails: 0,
        detailsUnavailable: 0,
        pendingAchievements: 0,
        pendingEmbeddings: 0,
      });

      const [activite] = await db
        .select({
          source: libraryEntries.lastActivitySource,
          at: libraryEntries.lastActivityAt,
        })
        .from(libraryEntries)
        .where(eq(libraryEntries.userId, userId))
        .limit(1);
      expect(activite.at).not.toBeNull();
      expect(activite.source).toBe('achievement');
    },
    TIMEOUT_JOB_MS + 30_000,
  );
});
