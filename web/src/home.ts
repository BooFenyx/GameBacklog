import { libelleActiviteCourte, type Activite } from './activite'
import { urlApi } from './api'
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

export type ParametresMenu = {
  anchor: number | null
  temps: HomeTemps
  intention: HomeIntention
  manette: boolean
}

export const SELECTION_DEFAUT: ParametresSelection = {
  anchor: null,
  genreId: null,
  decouverte: 30,
  manette: false,
  lancement: 'tous',
  progression: false,
}

export const MENU_DEFAUT: ParametresMenu = {
  anchor: null,
  temps: 45,
  intention: 'continuer',
  manette: false,
}

export const TEMPS_LABELS: Record<HomeTemps, string> = {
  30: '30 min',
  45: '45 min',
  60: '1 h',
  120: '2 h+',
}

/** Ordre d'affichage des choix de temps. */
export const TEMPS: HomeTemps[] = [30, 45, 60, 120]

export const INTENTIONS: { value: HomeIntention; label: string }[] = [
  { value: 'continuer', label: 'Continuer' },
  { value: 'decouvrir', label: 'Découvrir' },
  { value: 'finir', label: 'Finir' },
]

export const LANCEMENTS: { value: HomeLancement; label: string }[] = [
  { value: 'tous', label: 'Tous' },
  { value: 'deja', label: 'Déjà lancés' },
  { value: 'jamais', label: 'Jamais lancés' },
]

/** Réglages de requête correspondant à une sélection renvoyée par le serveur. */
export function parametresDepuisSelection(
  selection: HomeSelection,
): ParametresSelection {
  return {
    anchor: selection.anchor?.appId ?? null,
    genreId: selection.genre?.id ?? null,
    decouverte: selection.decouverte,
    manette: selection.manette,
    lancement: selection.lancement,
    progression: selection.progression,
  }
}

/** Message d'erreur lisible d'une réponse API non OK. */
async function messageErreur(res: Response): Promise<string> {
  const corps = (await res.json().catch(() => null)) as {
    message?: string | string[]
  } | null
  const message = Array.isArray(corps?.message)
    ? corps.message.join(' ')
    : corps?.message
  return message ?? `Réponse ${res.status}`
}

async function lire<T>(chemin: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(urlApi(chemin), { credentials: 'include', signal })
  if (!res.ok) throw new Error(await messageErreur(res))
  return (await res.json()) as T
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

/** Sérialise les réglages du menu, en omettant les valeurs par défaut. */
export function parametresMenu(parametres: ParametresMenu): URLSearchParams {
  const query = new URLSearchParams()
  if (parametres.anchor !== null) {
    query.set('anchor', String(parametres.anchor))
  }
  if (parametres.temps !== MENU_DEFAUT.temps) {
    query.set('temps', String(parametres.temps))
  }
  if (parametres.intention !== MENU_DEFAUT.intention) {
    query.set('intention', parametres.intention)
  }
  if (parametres.manette) query.set('manette', 'true')
  return query
}

/** `GET /api/home/menu` — menu du soir. */
export function chargerMenu(
  parametres: ParametresMenu,
  signal?: AbortSignal,
): Promise<HomeMenuResponse> {
  const query = parametresMenu(parametres)
  const suffixe = query.toString()
  return lire<HomeMenuResponse>(
    `/api/home/menu${suffixe ? `?${suffixe}` : ''}`,
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

export type PresetCopilote = 'calme' | 'court' | 'surprends' | 'defaut'

/** Normalise une demande libre : minuscules, sans accents. */
function normaliserDemande(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
}

/**
 * Parseur d'intentions du copilote, local et déterministe. Il ne résout jamais
 * un titre : pour choisir un jeu précis, on passe par « Changer de jeu ».
 */
export function presetCopilote(demande: string): PresetCopilote | null {
  const texte = normaliserDemande(demande)
  if (/\b(calme|paisible|zen|doux)\b/.test(texte)) return 'calme'
  if (/\b(court|rapide|petit)\b/.test(texte)) return 'court'
  if (/\b(surprends|surprend|autre|change)\b/.test(texte)) return 'surprends'
  if (/\b(comme|defaut|pareil|habituel)\b/.test(texte)) return 'defaut'
  return null
}

/** Réponse honnête du copilote : aucune promesse de durée de session. */
export function messageCopilote(
  preset: PresetCopilote,
  genreCalmeTrouve = true,
): string {
  switch (preset) {
    case 'calme':
      return genreCalmeTrouve
        ? 'J’ai privilégié un genre plus calme.'
        : 'Je suis resté proche de ton jeu.'
    case 'court':
      return 'J’ai privilégié les jeux que tu as le moins joués.'
    case 'surprends':
      return 'Je t’ai préparé une autre sélection.'
    case 'defaut':
      return 'J’ai gardé les plus proches de ton jeu.'
  }
}
