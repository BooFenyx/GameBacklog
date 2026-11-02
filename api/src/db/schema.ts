import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  jsonb,
  vector,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

/** Bloc de description longue, converti depuis le HTML Steam. */
export type DescriptionBlock =
  | { type: 'paragraphe'; texte: string }
  | { type: 'titre'; texte: string }
  | { type: 'liste'; items: string[] };

/** Capture d'écran : miniature pour la galerie, pleine taille pour le dialogue. */
export type CaptureEcran = {
  miniature: string;
  pleine: string;
};

export type Plateforme = 'windows' | 'mac' | 'linux';

/** Source de l'activité dérivée d'un jeu (données accessibles à tous). */
export type LastActivitySource = 'sync_delta' | 'recent_window' | 'achievement';

/** Précision de la date d'activité : borne haute ou basse, jamais exacte. */
export type LastActivityPrecision = 'upper_bound' | 'lower_bound';

export const users = pgTable(
  'users',
  {
    id: serial('id').primaryKey(),
    steamId: text('steam_id').notNull().unique(),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    lastSyncAt: timestamp('last_sync_at'),
    syncStatus: text('sync_status', {
      enum: ['pending', 'running', 'done', 'error'],
    })
      .notNull()
      .default('pending'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => ({
    steamIdIdx: uniqueIndex('users_steam_id_idx').on(table.steamId),
  }),
);

export const games = pgTable(
  'games',
  {
    id: serial('id').primaryKey(),
    appId: integer('app_id').notNull().unique(),
    name: text('name').notNull(),
    shortDescription: text('short_description'),
    genres: text('genres').array().notNull().default([]),
    categories: text('categories').array().notNull().default([]),
    /**
     * Identifiants de la taxonomie Steam, alignés index par index sur
     * `genres` et `categories`. Ils servent aux filtres (stables même si Steam
     * reformule un libellé) ; les libellés restent utilisés pour l'affichage et
     * le texte des embeddings.
     */
    genreIds: integer('genre_ids').array().notNull().default([]),
    categoryIds: integer('category_ids').array().notNull().default([]),
    /** Version du mapping de fiche appliquée (voir `FILTERS_VERSION`). */
    filtersVersion: integer('filters_version').notNull().default(0),
    controllerSupport: text('controller_support', {
      enum: ['none', 'partial', 'full'],
    })
      .notNull()
      .default('none'),
    releaseDate: timestamp('release_date'),
    headerImageUrl: text('header_image_url'),
    /** Description longue convertie en blocs sûrs (jamais de HTML brut). */
    descriptionBlocks: jsonb('description_blocks')
      .$type<DescriptionBlock[]>()
      .notNull()
      .default([]),
    /** Captures d'écran, limitées à 6 par le mapping. */
    screenshots: jsonb('screenshots')
      .$type<CaptureEcran[]>()
      .notNull()
      .default([]),
    developers: text('developers').array().notNull().default([]),
    publishers: text('publishers').array().notNull().default([]),
    website: text('website').notNull().default(''),
    platforms: text('platforms').array().notNull().default([]),
    metacriticScore: integer('metacritic_score'),
    metacriticUrl: text('metacritic_url'),
    backgroundImageUrl: text('background_image_url'),
    /**
     * Total de succès du jeu (schéma Steam) et date de récupération du schéma.
     * Le total est partagé entre utilisateurs ; un jeu sans succès garde
     * `achievements_total = 0` avec une date non nulle.
     */
    achievementsTotal: integer('achievements_total').notNull().default(0),
    achievementsFetchedAt: timestamp('achievements_fetched_at'),
    embedding: vector('embedding', { dimensions: 1024 }),
    embeddingModel: text('embedding_model'),
    detailsFetchedAt: timestamp('details_fetched_at'),
    /** Nombre d'échecs « jeu délisté » ; remis à 0 après un succès. */
    detailsAttempts: integer('details_attempts').notNull().default(0),
    /** Prochaine date où retenter la fiche (null = immédiatement). */
    detailsNextRetryAt: timestamp('details_next_retry_at', {
      withTimezone: true,
    }),
    /** Dernière cause d'échec : `removed`, `network` ou `rate-limit`. */
    detailsLastError: text('details_last_error'),
  },
  (table) => ({
    appIdIdx: uniqueIndex('games_app_id_idx').on(table.appId),
    genreIdsIdx: index('games_genre_ids_gin').using('gin', table.genreIds),
    categoryIdsIdx: index('games_category_ids_gin').using(
      'gin',
      table.categoryIds,
    ),
  }),
);

export const libraryEntries = pgTable(
  'library_entries',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    playtimeForever: integer('playtime_forever').notNull().default(0),
    playtimeLast2Weeks: integer('playtime_last_2_weeks').notNull().default(0),
    /** Estimation d'activité dérivée (tri + affichage), jamais une date exacte. */
    lastActivityAt: timestamp('last_activity_at', { withTimezone: true }),
    lastActivitySource: text('last_activity_source', {
      enum: ['sync_delta', 'recent_window', 'achievement'],
    }),
    lastActivityPrecision: text('last_activity_precision', {
      enum: ['upper_bound', 'lower_bound'],
    }),
    /** Dernière synchronisation réussie : point de départ du prochain `sync_delta`. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    achievementsUnlocked: integer('achievements_unlocked').notNull().default(0),
    /** Date de la dernière récupération des succès du joueur pour ce jeu. */
    achievementsFetchedAt: timestamp('achievements_fetched_at'),
  },
  (table) => ({
    userGameIdx: uniqueIndex('library_entries_user_game_idx').on(
      table.userId,
      table.gameId,
    ),
    userIdIdx: index('library_entries_user_id_idx').on(table.userId),
    userPlaytimeIdx: index('library_entries_user_playtime_idx').on(
      table.userId,
      table.playtimeForever.desc(),
    ),
    userLastActivityIdx: index('library_entries_user_last_activity_idx').on(
      table.userId,
      table.lastActivityAt.desc(),
    ),
  }),
);

export const achievements = pgTable(
  'achievements',
  {
    id: serial('id').primaryKey(),
    gameId: integer('game_id')
      .notNull()
      .references(() => games.id, { onDelete: 'cascade' }),
    apiName: text('api_name').notNull(),
    displayName: text('display_name').notNull(),
    description: text('description'),
    iconUrl: text('icon_url'),
  },
  (table) => ({
    gameIdIdx: index('achievements_game_id_idx').on(table.gameId),
    apiIdx: uniqueIndex('achievements_game_api_name_idx').on(
      table.gameId,
      table.apiName,
    ),
  }),
);

export const userAchievements = pgTable(
  'user_achievements',
  {
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    achievementId: integer('achievement_id')
      .notNull()
      .references(() => achievements.id, { onDelete: 'cascade' }),
    unlockedAt: timestamp('unlocked_at').notNull().defaultNow(),
  },
  (table) => ({
    userAchievementIdx: uniqueIndex(
      'user_achievements_user_achievement_idx',
    ).on(table.userId, table.achievementId),
  }),
);

/**
 * État d'un import de bibliothèque, une ligne par utilisateur. Sert au suivi de
 * progression et à la reprise : un job `pending`/`running` est relancé au
 * démarrage, les étapes déjà terminées étant sautées (upserts idempotents).
 */
export const syncJobs = pgTable(
  'sync_jobs',
  {
    id: serial('id').primaryKey(),
    userId: integer('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'running', 'done', 'error'],
    })
      .notNull()
      .default('pending'),
    step: text('step', {
      enum: ['library', 'details', 'achievements', 'embeddings', 'done'],
    })
      .notNull()
      .default('library'),
    totalGames: integer('total_games').notNull().default(0),
    processedGames: integer('processed_games').notNull().default(0),
    error: text('error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    finishedAt: timestamp('finished_at'),
  },
  (table) => ({
    userIdIdx: uniqueIndex('sync_jobs_user_id_idx').on(table.userId),
  }),
);

/**
 * Compteurs de quota persistés (ex. appel d'embedding Gemini), partagés par
 * tous les utilisateurs. Le compteur quotidien est la source de vérité survivant
 * aux redémarrages ; la fenêtre par minute, elle, est gérée en mémoire.
 */
export const rateLimits = pgTable('rate_limits', {
  key: text('key').primaryKey(),
  count: integer('count').notNull().default(0),
  windowStartedAt: timestamp('window_started_at').notNull().defaultNow(),
});
