-- Activité dérivée : aucune date exacte de dernière partie n'est conservée.
-- Aucun backfill de `last_activity_at` (la donnée exacte disparaît, c'est assumé)
-- et `last_seen_at` reste NULL pour déclencher la première re-synchronisation.
ALTER TABLE "library_entries" ADD COLUMN IF NOT EXISTS "last_activity_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "library_entries" ADD COLUMN IF NOT EXISTS "last_activity_source" text;--> statement-breakpoint
ALTER TABLE "library_entries" ADD COLUMN IF NOT EXISTS "last_activity_precision" text;--> statement-breakpoint
ALTER TABLE "library_entries" ADD COLUMN IF NOT EXISTS "last_seen_at" timestamp with time zone;--> statement-breakpoint
DROP INDEX IF EXISTS "library_entries_user_last_played_idx";--> statement-breakpoint
ALTER TABLE "library_entries" DROP COLUMN IF EXISTS "last_played_at";--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "library_entries_user_last_activity_idx"
  ON "library_entries" USING btree ("user_id","last_activity_at" DESC NULLS LAST);
