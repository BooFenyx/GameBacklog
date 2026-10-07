import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { fileURLToPath } from 'node:url';
import * as schema from './schema.js';

export const DB = Symbol('DB');
export type Db = ReturnType<typeof createDb>;

function createDb(connectionString: string) {
  const pool = new Pool({ connectionString });
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
        const client = await db.$client.connect();
        try {
          await client.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK]);
          await migrate(db, { migrationsFolder: migrationsFolder() });
        } finally {
          await client.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK]);
          client.release();
        }

        return db;
      },
    },
  ],
  exports: [DB],
})
export class DbModule {}
