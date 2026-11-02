import { types } from 'pg';

/**
 * `pg` lit un `timestamp` sans fuseau comme une heure locale du processus.
 * Drizzle écrit pourtant des instants UTC (`toISOString`). On force la lecture
 * en UTC pour que les deux conventions coïncident.
 */
export function parseTimestampUtc(valeur: string): Date {
  return new Date(`${valeur.replace(' ', 'T')}Z`);
}

/** À appeler une seule fois, avant de créer le Pool. */
export function enregistrerParseurUtc(): void {
  types.setTypeParser(1114, parseTimestampUtc);
}
