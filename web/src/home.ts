import { libelleActiviteCourte, type Activite } from './activite'
import { appelApi } from './http'
import { formaterDuree } from './format'

/** Types et client de `GET /api/home`, `/api/home/selection`, `/api/home/menu`. */

export type HomeControllerSupport = 'none' | 'partial' | 'full'
export type HomeTemps = 30 | 45 | 60 | 120
export type HomeIntention = 'continuer' | 'decouvrir' | 'finir'
export type HomeLancement = 'tous' | 'deja' | 'jamais'

export type HomeGenre = {
  id: number
  label: string
}

export type HomeGame = {
  appId: number
  name: string
  genres: string[]
  controllerSupport: HomeControllerSupport
  headerImageUrl: string | null
  playtimeForever: number
  playtimeLast2Weeks: number
  lastActivityAt: string | null
  lastActivitySource: Activite['lastActivitySource']
  lastActivityPrecision: Activite['lastActivityPrecision']
  achievementsUnlocked: number | null
  achievementsTotal: number | null
  reason: string | null
}

export type HomeAnchor = {
  appId: number
  name: string
  genres: string[]
  genreIds: number[]
  controllerSupport: HomeControllerSupport
  headerImageUrl: string | null
  mainGenre: HomeGenre | null
}

export type HomeSelection = {
  anchor: HomeAnchor | null
  genre: HomeGenre | null
  decouverte: number
  manette: boolean
  lancement: HomeLancement
  progression: boolean
  items: HomeGame[]
}

export type HomeCategories = {
  aFinir: HomeGame[]
  aDecouvrir: HomeGame[]
  aRetrouver: HomeGame[]
}

export type HomeMenuSignals = {
  continuite: string
  progression: string
  decouverte: string
  similarite: string
  temps: string
  manette: string
}

export type HomeMenuResponse = {
  temps: HomeTemps
  intention: HomeIntention
  manette: boolean
  resultat: HomeGame | null
  signals: HomeMenuSignals | null
}

export type HomeResponse = {
  jeuDuMoment: HomeGame | null
  selection: HomeSelection
  categories: HomeCategories
  menu: HomeMenuResponse
  ancresRecentes: HomeGame[]
}

export type ParametresSelection = {
  /** `null` = jeu du moment. */
  anchor: number | null
  /** `null` = genre principal de l'ancre, 0 = aucun genre. */
  genreId: number | null
  decouverte: number
  manette: boolean
  lancement: HomeLancement
  progression: boolean
}

export const SELECTION_DEFAUT: ParametresSelection = {
  anchor: null,
  genreId: null,
  decouverte: 30,
  manette: false,
  lancement: 'tous',
  progression: false,
}

export const LANCEMENTS: { value: HomeLancement; label: string }[] = [
  { value: 'tous', label: 'Tous' },
  { value: 'deja', label: 'Déjà lancés' },
  { value: 'jamais', label: 'Jamais lancés' },
]

/**
 * Réglages de requête correspondant à une sélection renvoyée par le serveur.
 *
 * Le genre renvoyé est le genre principal **par défaut** de l'ancre : il ne doit
 * pas être figé dans les réglages tant que l'utilisateur n'a pas cliqué un
 * genre. La requête suivante garde donc `genreId = null` et laisse le serveur
 * recalculer ce défaut (D22).
 */
export function parametresDepuisSelection(
  selection: HomeSelection,
): ParametresSelection {
  return {
    anchor: selection.anchor?.appId ?? null,
    genreId: null,
    decouverte: selection.decouverte,
    manette: selection.manette,
    lancement: selection.lancement,
    progression: selection.progression,
  }
}

async function lire<T>(chemin: string, signal?: AbortSignal): Promise<T> {
  return appelApi<T>(chemin, { signal })
}

/** `GET /api/home` — accueil par défaut. */
export function chargerAccueil(signal?: AbortSignal): Promise<HomeResponse> {
  return lire<HomeResponse>('/api/home', signal)
}

/** Sérialise les réglages de la sélection, en omettant les valeurs par défaut. */
export function parametresSelection(
  parametres: ParametresSelection,
): URLSearchParams {
  const query = new URLSearchParams()
  if (parametres.anchor !== null) {
    query.set('anchor', String(parametres.anchor))
  }
  if (parametres.genreId !== null) {
    query.set('genre', String(parametres.genreId))
  }
  if (parametres.decouverte !== SELECTION_DEFAUT.decouverte) {
    query.set('decouverte', String(parametres.decouverte))
  }
  if (parametres.manette) query.set('manette', 'true')
  if (parametres.lancement !== SELECTION_DEFAUT.lancement) {
    query.set('lancement', parametres.lancement)
  }
  if (parametres.progression) query.set('progression', 'true')
  return query
}

/** `GET /api/home/selection` — deck paramétrable. */
export function chargerSelection(
  parametres: ParametresSelection,
  signal?: AbortSignal,
): Promise<HomeSelection> {
  const query = parametresSelection(parametres)
  const suffixe = query.toString()
  return lire<HomeSelection>(
    `/api/home/selection${suffixe ? `?${suffixe}` : ''}`,
    signal,
  )
}

/** « Bonjour » ou « Bonsoir » selon l'heure locale. */
export function salutation(heure: number): 'Bonjour' | 'Bonsoir' {
  return heure >= 18 || heure < 6 ? 'Bonsoir' : 'Bonjour'
}

/**
 * Compteur de succès : `12 / 51`, `— / total` si la progression est
 * inaccessible, `null` si le total n'est pas récupéré.
 */
export function metaSucces(
  jeu: Pick<HomeGame, 'achievementsUnlocked' | 'achievementsTotal'>,
): string | null {
  if (jeu.achievementsTotal === null || jeu.achievementsTotal <= 0) return null
  if (jeu.achievementsUnlocked === null) {
    return `— / ${jeu.achievementsTotal}`
  }
  return `${jeu.achievementsUnlocked} / ${jeu.achievementsTotal}`
}

export function libelleManette(support: HomeControllerSupport): string {
  switch (support) {
    case 'full':
      return 'Manette complète'
    case 'partial':
      return 'Manette partielle'
    default:
      return 'Manette non supportée'
  }
}

/** Méta courte d'un jeu : temps de jeu et activité dérivée, jamais une date. */
export function metaJeu(jeu: HomeGame): string {
  if (jeu.playtimeForever === 0) return 'Jamais lancé'
  const temps = formaterDuree(jeu.playtimeForever)
  const activite = libelleActiviteCourte(jeu)
  return activite ? `${temps} · ${activite}` : `${temps} de jeu`
}

/** Titre du deck, construit à partir des réglages réellement appliqués. */
export function titreSelection(selection: HomeSelection): string {
  const ancre = selection.anchor?.name ?? 'ton jeu du moment'
  if (selection.decouverte >= 70) {
    return `Cinq jeux à découvrir autour de ${ancre}.`
  }
  if (selection.genre) {
    return `Cinq jeux autour de ${ancre}, priorité ${selection.genre.label}.`
  }
  return `Cinq jeux proches de ${ancre}.`
}

/** Sous-titre explicatif du deck. */
export function sousTitreSelection(selection: HomeSelection): string {
  let base: string
  if (selection.decouverte >= 70) {
    base = 'J’ai privilégié les jeux que tu as le moins joués.'
  } else if (selection.genre) {
    base = `Les voisins d’ambiance, avec un bonus pour ${selection.genre.label}.`
  } else {
    base = 'Les voisins d’ambiance de ton jeu du moment.'
  }

  const filtres: string[] = []
  if (selection.manette) filtres.push('manette')
  if (selection.lancement === 'deja') filtres.push('déjà lancés')
  if (selection.lancement === 'jamais') filtres.push('jamais lancés')
  if (selection.progression) filtres.push('proches du 100 %')

  return filtres.length > 0 ? `${base} Filtres : ${filtres.join(', ')}.` : base
}

/** Raison affichée sur une carte ; repli honnête si le serveur n'en envoie pas. */
export function raisonJeu(jeu: HomeGame, nomAncre: string): string {
  return jeu.reason ?? `Proche de ${nomAncre}`
}

/** Affiche portrait Steam d'un jeu, avec repli géré par le composant. */
export function imagePortrait(appId: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appId}/library_600x900.jpg`
}
