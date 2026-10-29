ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "achievements_total" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "achievements_fetched_at" timestamp;--> statement-breakpoint
ALTER TABLE "library_entries" ADD COLUMN IF NOT EXISTS "achievements_fetched_at" timestamp;
