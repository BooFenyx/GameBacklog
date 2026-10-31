import {
  TITRE_ACTIVITE_INDISPONIBLE,
  libelleActiviteCourte,
  titreActivite,
} from '../../activite'
import { MODES } from '../../filters'
import { formaterDuree } from '../../format'
import type { JeuBibliotheque } from '../../library'

/** Nombre de genres affichés sur une carte avant le « +N ». */
export const GENRES_VISIBLES = 2

export type EtatCarte = { label: string; recent: boolean }

export const LIBELLE_MANETTE: Record<
  JeuBibliotheque['controllerSupport'],
  string
> = {
  none: 'Manette non supportée',
  partial: 'Manette partielle',
  full: 'Manette complète',
}

/** Badge d'état affiché sur l'image : jamais lancé, récent ou joué. */
export function etatJeu(jeu: JeuBibliotheque): EtatCarte {
  if (jeu.playtimeForever === 0) {
    return { label: 'Jamais lancé', recent: false }
  }
  if (jeu.playtimeLast2Weeks > 0) {
    return { label: 'Joué cette semaine', recent: true }
  }
  return { label: 'Joué', recent: false }
}

/** Libellé lisible d'un mode de jeu, tel qu'affiché dans les filtres. */
export function libelleMode(valeur: string): string {
  return MODES.find((mode) => mode.value === valeur)?.label ?? valeur
}

export type MetaJeu = {
  temps: string | null
  activite: string | null
  activiteTitre: string | null
  jamais: boolean
}

/** Méta d'une carte : temps de jeu et activité dérivée, séparés. */
export function metaJeu(jeu: JeuBibliotheque): MetaJeu {
  const activite = libelleActiviteCourte(jeu)
  return {
    temps: jeu.playtimeForever > 0 ? formaterDuree(jeu.playtimeForever) : null,
    activite,
    activiteTitre: activite
      ? (titreActivite(jeu) ?? null)
      : TITRE_ACTIVITE_INDISPONIBLE,
    jamais: jeu.playtimeForever === 0,
  }
}

/** Contexte ajouté au `aria-label` de la carte entière. */
export function contexteCarte(
  jeu: JeuBibliotheque,
  etat: EtatCarte = etatJeu(jeu),
): string {
  return [
    etat.label,
    jeu.modes.map(libelleMode).join(', '),
    jeu.controllerSupport === 'full' ? 'manette complète' : null,
  ]
    .filter(Boolean)
    .join(', ')
}

/**
 * Libellé du compteur de succès : `12 / 51`, `— / 51` si la progression du
 * joueur n'est pas encore connue, ou `null` si le total n'est pas récupéré.
 */
export function succesAffiche(jeu: JeuBibliotheque): string | null {
  if (jeu.achievementsTotal === null || jeu.achievementsTotal <= 0) {
    return null
  }
  if (jeu.achievementsUnlocked === null) {
    return `— / ${jeu.achievementsTotal}`
  }
  return `${jeu.achievementsUnlocked} / ${jeu.achievementsTotal}`
}

/** Vrai quand le joueur a débloqué tous les succès du jeu. */
export function succesComplet(jeu: JeuBibliotheque): boolean {
  return (
    jeu.achievementsTotal !== null &&
    jeu.achievementsTotal > 0 &&
    jeu.achievementsUnlocked === jeu.achievementsTotal
  )
}
