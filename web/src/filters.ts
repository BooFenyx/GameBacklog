/**
 * Filtres de la bibliothèque et de la recherche.
 *
 * L'URL est la source de vérité : les pages lisent les filtres avec
 * `lireFiltres` et les réécrivent avec `ecrireFiltres`. Les valeurs par défaut
 * ne sont jamais écrites, ce qui garde des URLs courtes et partageables.
 */

export type ModeJeu = 'solo' | 'multi' | 'coop' | 'pvp' | 'local' | 'crossplay'
export type EtatJeu = 'jamais' | 'joue' | 'recent'
export type DureeJeu = '0-2' | '2-10' | '10-50' | '50plus'
export type TriBibliotheque = 'nom' | 'temps' | 'recent'
export type FiltreManette = 'full' | 'partial'

export type Filtres = {
  q: string
  genres: number[]
  modes: ModeJeu[]
  manette: FiltreManette | null
  etat: EtatJeu | null
  duree: DureeJeu[]
  tri: TriBibliotheque
}

export const FILTRES_VIDES: Filtres = {
  q: '',
  genres: [],
  modes: [],
  manette: null,
  etat: null,
  duree: [],
  tri: 'nom',
}

export const MODES: { value: ModeJeu; label: string }[] = [
  { value: 'solo', label: 'Solo' },
  { value: 'multi', label: 'Multi' },
  { value: 'coop', label: 'Coop' },
  { value: 'pvp', label: 'PvP' },
  { value: 'local', label: 'Local' },
  { value: 'crossplay', label: 'Crossplay' },
]

export const ETATS: { value: EtatJeu; label: string }[] = [
  { value: 'jamais', label: 'Jamais lancé' },
  { value: 'joue', label: 'Joué' },
  { value: 'recent', label: 'Joué récemment' },
]

export const DUREES: { value: DureeJeu; label: string }[] = [
  { value: '0-2', label: 'Moins de 2 h' },
  { value: '2-10', label: '2 à 10 h' },
  { value: '10-50', label: '10 à 50 h' },
  { value: '50plus', label: '50 h et +' },
]

export const TRIS: { value: TriBibliotheque; label: string }[] = [
  { value: 'nom', label: 'Nom' },
  { value: 'temps', label: 'Temps de jeu' },
  { value: 'recent', label: 'Dernière partie' },
]

const MODE_VALUES = MODES.map((mode) => mode.value)
const ETAT_VALUES = ETATS.map((etat) => etat.value)
const DUREE_VALUES = DUREES.map((duree) => duree.value)
const TRI_VALUES = TRIS.map((tri) => tri.value)

function liste(params: URLSearchParams, cle: string): string[] {
  return (params.get(cle) ?? '')
    .split(',')
    .map((valeur) => valeur.trim())
    .filter((valeur) => valeur.length > 0)
}

function estMode(valeur: string): valeur is ModeJeu {
  return (MODE_VALUES as string[]).includes(valeur)
}

function estEtat(valeur: string): valeur is EtatJeu {
  return (ETAT_VALUES as string[]).includes(valeur)
}

function estDuree(valeur: string): valeur is DureeJeu {
  return (DUREE_VALUES as string[]).includes(valeur)
}

/** Lit les filtres d'une URL, en ignorant les valeurs inconnues. */
export function lireFiltres(
  params: URLSearchParams,
  options: { avecTri?: boolean } = {},
): Filtres {
  const manette = params.get('manette')
  const etat = params.get('etat')
  const tri = params.get('tri')

  return {
    q: (params.get('q') ?? '').trim(),
    genres: [
      ...new Set(
        liste(params, 'genres')
          .map((valeur) => Number(valeur))
          .filter((id) => Number.isInteger(id) && id > 0),
      ),
    ].slice(0, 8),
    modes: [...new Set(liste(params, 'modes').filter(estMode))],
    manette: manette === 'full' || manette === 'partial' ? manette : null,
    etat: etat && estEtat(etat) ? etat : null,
    duree: [...new Set(liste(params, 'duree').filter(estDuree))],
    tri:
      options.avecTri !== false && tri && (TRI_VALUES as string[]).includes(tri)
        ? (tri as TriBibliotheque)
        : 'nom',
  }
}

/** Écrit les filtres dans une URL, en omettant les valeurs par défaut. */
export function ecrireFiltres(
  filtres: Filtres,
  options: { avecTri?: boolean } = {},
): URLSearchParams {
  const params = new URLSearchParams()
  const q = filtres.q.trim()

  if (q) params.set('q', q)
  if (filtres.genres.length > 0) params.set('genres', filtres.genres.join(','))
  if (filtres.modes.length > 0) params.set('modes', filtres.modes.join(','))
  if (filtres.manette) params.set('manette', filtres.manette)
  if (filtres.etat) params.set('etat', filtres.etat)
  if (filtres.duree.length > 0) params.set('duree', filtres.duree.join(','))
  if (options.avecTri !== false && filtres.tri !== 'nom') {
    params.set('tri', filtres.tri)
  }

  return params
}

/** Nombre de groupes de filtres actifs (hors recherche texte et tri). */
export function compterFiltresActifs(filtres: Filtres): number {
  let total = 0
  if (filtres.genres.length > 0) total += 1
  if (filtres.modes.length > 0) total += 1
  if (filtres.manette) total += 1
  if (filtres.etat) total += 1
  if (filtres.duree.length > 0) total += 1
  return total
}

export function filtresVides(filtres: Filtres): boolean {
  return (
    filtres.genres.length === 0 &&
    filtres.modes.length === 0 &&
    filtres.manette === null &&
    filtres.etat === null &&
    filtres.duree.length === 0
  )
}

/** Clé stable pour remonter un composant quand les filtres changent. */
export function cleFiltres(filtres: Filtres): string {
  return [
    filtres.genres.join(','),
    filtres.modes.join(','),
    filtres.manette ?? '',
    filtres.etat ?? '',
    filtres.duree.join(','),
    filtres.tri,
  ].join('|')
}
