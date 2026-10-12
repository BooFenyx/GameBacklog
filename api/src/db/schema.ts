import {
  pgTable,
  serial,
  text,
  integer,
  timestamp,
  vector,
  uniqueIndex,
  index,
} from 'drizzle-orm/pg-core';

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
    controllerSupport: text('controller_support', {
      enum: ['none', 'partial', 'full'],
    })
      .notNull()
      .default('none'),
    releaseDate: timestamp('release_date'),
    headerImageUrl: text('header_image_url'),
    embedding: vector('embedding', { dimensions: 1024 }),
    embeddingModel: text('embedding_model'),
    detailsFetchedAt: timestamp('details_fetched_at'),
  },
  (table) => ({
    appIdIdx: uniqueIndex('games_app_id_idx').on(table.appId),
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
    lastPlayedAt: timestamp('last_played_at'),
    achievementsUnlocked: integer('achievements_unlocked').notNull().default(0),
  },
  (table) => ({
    userGameIdx: uniqueIndex('library_entries_user_game_idx').on(
      table.userId,
      table.gameId,
    ),
    userIdIdx: index('library_entries_user_id_idx').on(table.userId),
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
      enum: ['library', 'details', 'embeddings', 'done'],
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
