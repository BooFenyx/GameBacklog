import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { DB, type Db } from '../db/db.module.js';
import { users } from '../db/schema.js';

export const SYNC_STATUS_ENUM = [
  'pending',
  'running',
  'done',
  'error',
] as const;
export type SyncStatus = (typeof SYNC_STATUS_ENUM)[number];

/** Champs de profil suffisant pour créer/mettre à jour un utilisateur. */
export interface ProfileForUpsert {
  steamId: string;
  displayName: string;
  avatarUrl?: string | null;
}

@Injectable()
export class UsersService {
  constructor(@Inject(DB) private readonly db: Db) {}

  /**
   * Crée l'utilisateur s'il n'existe pas, sinon met à jour le profil. Le
   * statut de sync n'est **pas** réinitialisé à chaque login : il est piloté
   * par le `SyncService` (`done`/`error`). Upsert volontaire : aucune
   * suppression, aucun doublon (`steamId` unique). Renvoie l'identifiant de la
   * ligne `users`.
   */
  async upsertFromProfile(profile: ProfileForUpsert): Promise<number> {
    // Chaîne vide ou absente → null en base (pas d'URL d'avatar significative).
    const avatarUrl = profile.avatarUrl || null;
    const [row] = await this.db
      .insert(users)
      .values({
        steamId: profile.steamId,
        displayName: profile.displayName,
        avatarUrl,
        syncStatus: 'pending',
      })
      .onConflictDoUpdate({
        target: users.steamId,
        set: {
          displayName: profile.displayName,
          avatarUrl,
        },
      })
      .returning({ id: users.id });

    return row.id;
  }

  async findIdBySteamId(steamId: string): Promise<number | undefined> {
    const [row] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.steamId, steamId))
      .limit(1);
    return row?.id;
  }

  /** Statut de sync courant d'un utilisateur (`undefined` s'il est inconnu). */
  async syncStatusOf(userId: number): Promise<SyncStatus | undefined> {
    const [row] = await this.db
      .select({ syncStatus: users.syncStatus })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    return row?.syncStatus;
  }

  async setStatus(
    userId: number,
    status: SyncStatus,
    fields?: { lastSyncAt?: Date },
  ): Promise<void> {
    await this.db
      .update(users)
      .set({ syncStatus: status, ...fields })
      .where(eq(users.id, userId));
  }
}
