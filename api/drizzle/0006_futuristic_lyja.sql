ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "description_blocks" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "screenshots" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "developers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "publishers" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "website" text;--> statement-breakpoint
UPDATE "games" SET "website" = '' WHERE "website" IS NULL;--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "website" SET DEFAULT '';--> statement-breakpoint
ALTER TABLE "games" ALTER COLUMN "website" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "platforms" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "metacritic_score" integer;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "metacritic_url" text;--> statement-breakpoint
ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "background_image_url" text;
