ALTER TABLE "games" ADD COLUMN "genre_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "category_ids" integer[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN "filters_version" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX "games_genre_ids_gin" ON "games" USING gin ("genre_ids");--> statement-breakpoint
CREATE INDEX "games_category_ids_gin" ON "games" USING gin ("category_ids");--> statement-breakpoint
CREATE INDEX "library_entries_user_playtime_idx" ON "library_entries" USING btree ("user_id","playtime_forever" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "library_entries_user_last_played_idx" ON "library_entries" USING btree ("user_id","last_played_at" DESC NULLS LAST);