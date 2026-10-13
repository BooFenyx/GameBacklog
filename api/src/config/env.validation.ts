/**
 * Variables exigées en production. `DATABASE_URL` conditionne la connexion,
 * `SESSION_SECRET` signe les cookies de session et `FRONTEND_URL` borne le CORS
 * ainsi que le `realm`/`return_to` OpenID de Steam.
 */
const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'FRONTEND_URL',
] as const;

/**
 * Validateur d'environnement passé à `ConfigModule.forRoot`.
 *
 * Hors production, aucune contrainte : le développement s'appuie sur les
 * valeurs de repli (session `MemoryStore`, CORS localhost, secret de dev). En
 * production, on échoue au démarrage dès qu'une variable requise manque — un
 * `SESSION_SECRET` absent laisserait sinon l'API démarrer avec un secret de
 * développement connu, rendant les cookies de session forgeables. Une chaîne
 * vide (`SESSION_SECRET=`) compte comme absente.
 */
export function validateEnv(
  config: Record<string, unknown>,
): Record<string, unknown> {
  if (config.NODE_ENV !== 'production') {
    return config;
  }

  const missing = REQUIRED_IN_PRODUCTION.filter((key) => {
    const value = config[key];
    return typeof value !== 'string' || value.trim() === '';
  });

  if (missing.length > 0) {
    throw new Error(
      `Variables d'environnement manquantes en production : ${missing.join(', ')}`,
    );
  }

  return config;
}
