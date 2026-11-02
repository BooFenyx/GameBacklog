import { Test, TestingModule } from '@nestjs/testing';
import { eq } from 'drizzle-orm';
import { AppModule } from '../src/app.module.js';
import { DB, type Db } from '../src/db/db.module.js';
import { games, libraryEntries, syncJobs, users } from '../src/db/schema.js';
import { SyncService } from '../src/sync/sync.service.js';

const STEAM_ID = '76561199000000999';
const BASE = 950000;

describe('Compteurs et reprises de fiches (intégration)', () => {
  let moduleFixture: TestingModule;
  let db: Db;
  let service: SyncService;
  let userId: number;

  beforeAll(async () => {
    moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    await moduleFixture.init();
    db = moduleFixture.get<Db>(DB);
    service = moduleFixture.get<SyncService>(SyncService);

    await supprimerDonnees();

    const [utilisateur] = await db
      .insert(users)
      .values({ steamId: STEAM_ID, displayName: 'Test compteurs' })
      .returning();
    userId = utilisateur.id;
    await db.insert(syncJobs).values({
      userId,
      status: 'done',
      step: 'done',
      finishedAt: new Date(),
    });

    const lignes: Array<{
      offset: number;
      details: Date | null;
      attempts: number;
      retry: Date | null;
      achievements: Date | null;
      description: string | null;
    }> = [
      // 1 : fiche manquante due.
      {
        offset: 1,
        details: null,
        attempts: 0,
        retry: null,
        achievements: null,
        description: null,
      },
      // 2 : fiche manquante en backoff futur (doit rester dans pendingDetails).
      {
        offset: 2,
        details: null,
        attempts: 0,
        retry: new Date(Date.now() + 3_600_000),
        achievements: null,
        description: null,
      },
      // 3 : fiche abandonnée après 3 échecs.
      {
        offset: 3,
        details: null,
        attempts: 3,
        retry: new Date(Date.now() + 3_600_000),
        achievements: null,
        description: null,
      },
      // 4 : fiche récupérée, succès et embedding manquants.
      {
        offset: 4,
        details: new Date(),
        attempts: 0,
        retry: null,
        achievements: null,
        description: 'Description',
      },
      // 5 : fiche + succès récupérés, embedding manquant.
      {
        offset: 5,
        details: new Date(),
        attempts: 0,
        retry: null,
        achievements: new Date(),
        description: 'Description',
      },
    ];

    for (const ligne of lignes) {
      const [jeu] = await db
        .insert(games)
        .values({
          appId: BASE + ligne.offset,
          name: `Jeu test ${ligne.offset}`,
          shortDescription: ligne.description,
          detailsFetchedAt: ligne.details,
          detailsAttempts: ligne.attempts,
          detailsNextRetryAt: ligne.retry,
          achievementsFetchedAt: ligne.achievements,
        })
        .returning();
      await db.insert(libraryEntries).values({
        userId,
        gameId: jeu.id,
        playtimeForever: 10,
        achievementsFetchedAt: ligne.achievements,
      });
    }
  });

  afterAll(async () => {
    await supprimerDonnees();
    await moduleFixture.close();
  });

  async function supprimerDonnees(): Promise<void> {
    if (!db) return;
    await db.delete(users).where(eq(users.steamId, STEAM_ID));
    await db.delete(games).where(eq(games.name, 'Jeu test 1'));
    for (let offset = 2; offset < 10; offset += 1) {
      await db.delete(games).where(eq(games.appId, BASE + offset));
    }
  }

  it('compte les reliquats, y compris une fiche en backoff', async () => {
    const job = await service.currentJob(userId);

    expect(job).toMatchObject({
      pendingDetails: 2,
      detailsUnavailable: 1,
      pendingAchievements: 1,
      pendingEmbeddings: 2,
    });
  });

  it('needsDetails ne déclenche que les fiches dues', async () => {
    await expect(service.needsDetails(userId)).resolves.toBe(true);

    await db
      .update(games)
      .set({ detailsNextRetryAt: new Date(Date.now() + 3_600_000) })
      .where(eq(games.appId, BASE + 1));

    await expect(service.needsDetails(userId)).resolves.toBe(false);

    await db
      .update(games)
      .set({ detailsNextRetryAt: null })
      .where(eq(games.appId, BASE + 1));
  });

  it('planifie et déclenche une reprise automatique pour une échéance due', async () => {
    vi.useFakeTimers();
    const enqueue = vi.spyOn(service, 'enqueue').mockResolvedValue({} as never);
    try {
      // Le jeu 1 est dû immédiatement ; les jeux 2 et 3 ont une échéance
      // future. Le scheduler doit tirer un timer à zéro pour le jeu 1.
      await db
        .update(games)
        .set({ detailsNextRetryAt: new Date(Date.now() - 1_000) })
        .where(eq(games.appId, BASE + 1));

      await (
        service as never as {
          planifierToutesReprises: () => Promise<void>;
        }
      ).planifierToutesReprises();
      await vi.advanceTimersByTimeAsync(0);

      expect(enqueue).toHaveBeenCalledWith(userId);
    } finally {
      enqueue.mockRestore();
      vi.useRealTimers();
    }
  });

  it('la relance manuelle force les fiches récupérables sans casser la quarantaine', async () => {
    vi.spyOn(service as never, 'drain').mockResolvedValue(undefined);

    await service.enqueue(userId, { forcerFiches: true });

    const [jeu2] = await db
      .select({ retry: games.detailsNextRetryAt })
      .from(games)
      .where(eq(games.appId, BASE + 2))
      .limit(1);
    const [jeu3] = await db
      .select({
        retry: games.detailsNextRetryAt,
        attempts: games.detailsAttempts,
      })
      .from(games)
      .where(eq(games.appId, BASE + 3))
      .limit(1);

    expect(jeu2.retry).toBeNull();
    expect(jeu3.retry).not.toBeNull();
    expect(jeu3.attempts).toBe(3);
  });
});
