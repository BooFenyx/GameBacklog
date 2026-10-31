import type {
  LastActivityPrecision,
  LastActivitySource,
} from '../db/schema.js';

/** Observation issue de `GetOwnedGames` (données accessibles à tous). */
export interface ObservationJeu {
  playtimeForever: number;
  playtime2Weeks: number;
}

/** Entrée `library_entries` lue avant la mise à jour. */
export interface EntreePrecedente {
  playtimeForever: number;
  lastActivityAt: Date | null;
  lastActivitySource: LastActivitySource | null;
  lastActivityPrecision: LastActivityPrecision | null;
  lastSeenAt: Date | null;
}

export interface ActiviteCalculee {
  at: Date;
  source: LastActivitySource;
  precision: LastActivityPrecision;
}

/**
 * Dérive une estimation d'activité à partir de données que Steam expose à tout
 * le monde (`playtime_forever`, `playtime_2weeks`, succès).
 *
 * Le résultat n'est **jamais** une date exacte de dernière partie : c'est une
 * borne haute (`sync_delta`, `recent_window`) ou basse (`achievement`).
 * `null` signifie « aucun candidat » : l'appelant ne doit rien écrire, afin de
 * conserver l'activité déjà connue.
 */
export function deriverActivite(
  observation: ObservationJeu,
  precedent: EntreePrecedente | null,
  dernierSuccesAt: Date | null,
  maintenant: Date,
): ActiviteCalculee | null {
  const source = precedent?.lastActivitySource ?? null;

  // 1. Le temps de jeu a augmenté depuis une sync datée → le jeu a été lancé.
  if (
    precedent?.lastSeenAt &&
    observation.playtimeForever > precedent.playtimeForever
  ) {
    return { at: maintenant, source: 'sync_delta', precision: 'upper_bound' };
  }

  // 2. Le jeu est dans la fenêtre de 14 jours.
  if (observation.playtime2Weeks > 0) {
    if (source === 'sync_delta') return null; // plus précis, on conserve
    return {
      at: maintenant,
      source: 'recent_window',
      precision: 'upper_bound',
    };
  }

  // 3. Dernier succès : borne basse, jamais une date de partie.
  if (dernierSuccesAt) {
    if (source === 'sync_delta' || source === 'recent_window') return null;
    if (
      precedent?.lastActivityAt &&
      dernierSuccesAt <= precedent.lastActivityAt
    ) {
      return null;
    }
    return {
      at: dernierSuccesAt,
      source: 'achievement',
      precision: 'lower_bound',
    };
  }

  // Aucun candidat : conserver l'existant (ne jamais écrire NULL).
  return null;
}
