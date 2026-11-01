ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "details_attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "details_next_retry_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "details_last_error" text;
