import { formaterDate } from './format'

/** Sources d'activité dérivée, toutes accessibles à un tiers. */
export type LastActivitySource =
  | 'sync_delta'
  | 'recent_window'
  | 'achievement'

/** Une source est une borne : jamais une date exacte de dernière partie. */
export type LastActivityPrecision = 'upper_bound' | 'lower_bound'

/** Mêmes noms que les champs renvoyés par l'API (JeuBibliotheque, FicheJeu…). */
export type Activite = {
  lastActivityAt: string | null
  lastActivitySource: LastActivitySource | null
  lastActivityPrecision: LastActivityPrecision | null
}

export const TITRE_ACTIVITE_INDISPONIBLE =
  'Steam ne fournit pas la date de dernière partie pour les bibliothèques tierces.'

/**
 * Libellé long : fiche, recherche, infobulle.
 * `maintenant` est injectable pour les tests (règle des 14 jours).
 */
export function libelleActivite(
  activite: Activite,
  maintenant: Date = new Date(),
): string | null {
  if (!activite.lastActivitySource || !activite.lastActivityAt) return null

  switch (activite.lastActivitySource) {
    case 'sync_delta':
      return 'Joué depuis la dernière synchronisation'
    case 'recent_window': {
      const date = new Date(activite.lastActivityAt)
      const jours = (maintenant.getTime() - date.getTime()) / 86_400_000
      return jours > 14
        ? `Joué dans les 14 jours avant le ${formaterDate(activite.lastActivityAt) ?? '—'}`
        : 'Joué dans les 14 derniers jours'
    }
    case 'achievement':
      return `Dernier succès le ${formaterDate(activite.lastActivityAt) ?? '—'}`
  }
}

/** Libellé court : cartes et vue liste. */
export function libelleActiviteCourte(activite: Activite): string | null {
  if (!activite.lastActivitySource || !activite.lastActivityAt) return null
  switch (activite.lastActivitySource) {
    case 'sync_delta':
      return 'depuis la sync'
    case 'recent_window':
      return '14 derniers jours'
    case 'achievement':
      return 'dernier succès'
  }
}

/** Infobulle : date de détection pour les bornes, rien pour un succès. */
export function titreActivite(activite: Activite): string | undefined {
  if (!activite.lastActivityAt) return TITRE_ACTIVITE_INDISPONIBLE
  if (activite.lastActivitySource === 'achievement') return undefined
  return `Détecté lors de la synchronisation du ${formaterDate(activite.lastActivityAt) ?? ''}`
}
