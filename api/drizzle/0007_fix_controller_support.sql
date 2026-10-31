-- Corrige les fiches importées avec le mapping v2 : le repli anglais ne
-- fonctionnait pas avec `l=french`. Idempotent : les lignes corrigées ne sont
-- plus 'none'.
UPDATE "games" SET "controller_support" = 'full'
WHERE "controller_support" = 'none' AND 28 = ANY("category_ids");
--> statement-breakpoint
UPDATE "games" SET "controller_support" = 'partial'
WHERE "controller_support" = 'none' AND 18 = ANY("category_ids");
