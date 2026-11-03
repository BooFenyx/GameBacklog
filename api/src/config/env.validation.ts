/**
 * Variables exigées en production. `DATABASE_URL` conditionne la connexion,
 * `SESSION_SECRET` signe les cookies de session et `FRONTEND_URL` borne le CORS
 * ainsi que le `realm`/`return_to` OpenID de Steam.
 */
const REQUIRED_IN_PRODUCTION = [
  'DATABASE_URL',
  'SESSION_SECRET',
  'FRONTEND_URL',
  // Sans elle, l'API répond mais tout import et la récupération du profil
  // échouent : on préfère un boot en erreur explicite.
  'STEAM_API_KEY',
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

  // Un secret présent mais égal au repli de développement rendrait les cookies
  // forgeables exactement comme s'il était absent. On refuse aussi les secrets
  // trop courts, qui n'offrent pas la marge attendue pour HMAC-SHA256.
  const secret = config.SESSION_SECRET as string;
  if (secret === 'dev-insecure-session-secret') {
    throw new Error(
      "SESSION_SECRET ne peut pas être le secret de développement en production",
    );
  }
  if (secret.trim().length < 32) {
    throw new Error(
      'SESSION_SECRET doit contenir au moins 32 caractères en production',
    );
  }

  return config;
}
