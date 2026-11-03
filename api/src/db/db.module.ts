import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Client, Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import { enregistrerParseurUtc } from './pg-utc.js';
import * as schema from './schema.js';

// Avant toute connexion : `pg` doit relire les `timestamp` sans fuseau en UTC,
// comme Drizzle les écrit.
enregistrerParseurUtc();

export const DB = Symbol('DB');
export type Db = ReturnType<typeof createDb>;

const logger = new Logger('DbModule');

function createDb(connectionString: string) {
  const pool = new Pool({
    connectionString,
    // Drizzle envoie des littéraux UTC ; la session doit les interpréter en UTC.
    options: '-c timezone=UTC',
    // Borne les attentes : sans ces limites, une requête lente ou une coupure
    // réseau immobilise un client jusqu'au timeout TCP, puis tout le trafic
    // HTTP attend un client libre. `statement_timeout` est la protection
    // principale ; on ne met pas de `query_timeout` client-side pour ne pas
    // interrompre une migration DDL longue.
    max: 10,
    connectionTimeoutMillis: 5_000,
    idleTimeoutMillis: 30_000,
    statement_timeout: 15_000,
    keepAlive: true,
  });
  // Une connexion inactive coupée par Neon émet `error` sur le pool. Sans ce
  // listener, EventEmitter lève une exception non capturée et tue le process
  // (boucle de crash au redémarrage). On journalise et laisse `pg` remplacer
  // la connexion au prochain emprunt.
  pool.on('error', (error: Error) => {
    logger.warn(`Connexion PostgreSQL perdue: ${error.message}`);
  });
  return drizzle(pool, { schema });
}

/**
 * Dossier `api/drizzle` quel que soit le point de départ : le module est
 * exécuté depuis `src/` en dev et depuis `dist/` après `nest build`, les deux
 * à deux niveaux sous `api/`.
 */
function migrationsFolder(): string {
  return fileURLToPath(new URL('../../drizzle', import.meta.url));
}

/** Identifiant du verrou : identique pour tous les processus de l'application. */
const MIGRATION_LOCK = 4815162342;

@Global()
@Module({
  providers: [
    {
      provide: DB,
      inject: [ConfigService],
      useFactory: async (config: ConfigService) => {
        const url = config.get<string>('DATABASE_URL');
        if (!url) {
          throw new Error(
            'DATABASE_URL absente : connexion à la base impossible',
          );
        }

        const db = createDb(url);

        // Applique les migrations manquantes au démarrage : le plan gratuit de
        // Render n'admet pas de `preDeployCommand`, et cette voie dispense de
        // toute commande manuelle après l'ajout d'une migration. `migrate` est
        // idempotente : elle ne rejoue jamais une migration déjà appliquée.
        // Le verrou advisory sérialise les démarreurs concurrents (workers
        // e2e, chevauchement de déploiements) : sans lui, deux processus
        // exécuteraient la même migration et l'un échouerait.
        //
        // La migration utilise une connexion **dédiée** au lieu du pool : le
        // `statement_timeout` de 15 s du pool s'applique à la connexion entière,
        // pas à une requête, et `migrate()` emprunte sa propre connexion. Un
        // DDL long serait donc annulé malgré le `SET` ci-dessous.
        const migrationClient = new Client({
          connectionString: url,
          options: '-c timezone=UTC',
          // Le boot Render ne doit pas rester suspendu si Neon est injoignable.
          connectionTimeoutMillis: 10_000,
        });
        // Une coupure socket pendant la migration émet `error` : sans listener,
        // EventEmitter lève une exception non capturée et tue le process.
        migrationClient.on('error', (error: Error) => {
          logger.error(`Connexion de migration perdue: ${error.message}`);
        });
        await migrationClient.connect();
        let verrouille = false;
        try {
          // Une instance précédente peut être morte en tenant le verrou : on
          // préfère échouer au bout de 30 s avec un message explicite plutôt
          // que bloquer indéfiniment le port HTTP et le health check Render.
          await migrationClient.query("SET lock_timeout = '30s'");
          // Les migrations DDL peuvent dépasser le `statement_timeout` des
          // requêtes HTTP (15 s) : on relève la limite sur cette connexion
          // dédiée, qui ne sert qu'à la migration.
          await migrationClient.query("SET statement_timeout = '300s'");
          try {
            await migrationClient.query('SELECT pg_advisory_lock($1)', [
              MIGRATION_LOCK,
            ]);
            verrouille = true;
          } catch (error) {
            const message =
              error instanceof Error ? error.message : 'erreur inconnue';
            throw new Error(
              `Migration impossible : verrou non obtenu dans les 30 s (${message})`,
            );
          }

          await migrate(drizzle(migrationClient, { schema }), {
            migrationsFolder: migrationsFolder(),
          });
        } finally {
          if (verrouille) {
            try {
              await migrationClient.query('SELECT pg_advisory_unlock($1)', [
                MIGRATION_LOCK,
              ]);
            } catch (error) {
              logger.error(
                `Déverrouillage de migration impossible: ${
                  error instanceof Error ? error.message : 'erreur inconnue'
                }`,
              );
            }
          }
          await migrationClient.end().catch((error: unknown) => {
            logger.warn(
              `Fermeture de la connexion de migration incomplète: ${
                error instanceof Error ? error.message : 'erreur inconnue'
              }`,
            );
          });
        }

        return db;
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
