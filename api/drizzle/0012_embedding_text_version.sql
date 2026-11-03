ALTER TABLE "games" ADD COLUMN IF NOT EXISTS "embedding_text_version" integer DEFAULT 0 NOT NULL;
