-- Les dates de sortie ont été stockées à minuit local converti en UTC, soit
-- 22:00 (été) ou 23:00 (hiver) la veille. On les ramène au jour réel à minuit.
-- Idempotent : une valeur déjà à 00:00 + 2 h reste le même jour.
UPDATE "games"
SET "release_date" = ((("release_date" + interval '2 hours')::date)::timestamp)
WHERE "release_date" IS NOT NULL;
