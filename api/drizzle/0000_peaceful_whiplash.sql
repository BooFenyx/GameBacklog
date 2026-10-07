CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TABLE "achievements" (
	"id" serial PRIMARY KEY NOT NULL,
	"game_id" integer NOT NULL,
	"api_name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text,
	"icon_url" text
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" serial PRIMARY KEY NOT NULL,
	"app_id" integer NOT NULL,
	"name" text NOT NULL,
	"short_description" text,
	"genres" text[] DEFAULT '{}' NOT NULL,
	"categories" text[] DEFAULT '{}' NOT NULL,
	"controller_support" text DEFAULT 'none' NOT NULL,
	"release_date" timestamp,
	"header_image_url" text,
	"embedding" vector(1024),
	"embedding_model" text,
	"details_fetched_at" timestamp,
	CONSTRAINT "games_app_id_unique" UNIQUE("app_id")
);
--> statement-breakpoint
CREATE TABLE "library_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" integer NOT NULL,
	"game_id" integer NOT NULL,
	"playtime_forever" integer DEFAULT 0 NOT NULL,
	"playtime_last_2_weeks" integer DEFAULT 0 NOT NULL,
	"last_played_at" timestamp,
	"achievements_unlocked" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_achievements" (
	"user_id" integer NOT NULL,
	"achievement_id" integer NOT NULL,
	"unlocked_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"steam_id" text NOT NULL,
	"display_name" text NOT NULL,
	"avatar_url" text,
	"last_sync_at" timestamp,
	"sync_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "users_steam_id_unique" UNIQUE("steam_id")
);
--> statement-breakpoint
ALTER TABLE "achievements" ADD CONSTRAINT "achievements_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "library_entries" ADD CONSTRAINT "library_entries_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_achievements" ADD CONSTRAINT "user_achievements_achievement_id_achievements_id_fk" FOREIGN KEY ("achievement_id") REFERENCES "public"."achievements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "achievements_game_id_idx" ON "achievements" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "games_app_id_idx" ON "games" USING btree ("app_id");--> statement-breakpoint
CREATE UNIQUE INDEX "library_entries_user_game_idx" ON "library_entries" USING btree ("user_id","game_id");--> statement-breakpoint
CREATE INDEX "library_entries_user_id_idx" ON "library_entries" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "user_achievements_user_achievement_idx" ON "user_achievements" USING btree ("user_id","achievement_id");--> statement-breakpoint
CREATE UNIQUE INDEX "users_steam_id_idx" ON "users" USING btree ("steam_id");