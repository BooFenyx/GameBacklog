import type {
  LastActivityPrecision,
  LastActivitySource,
} from './activite'
import { appelApi, ErreurApi } from './http'

/** Bloc de description longue renvoyé par l'API. */
export type DescriptionBlock =
  | { type: 'paragraphe'; texte: string }
  | { type: 'titre'; texte: string }
  | { type: 'liste'; items: string[] }

/** Capture d'écran : miniature pour la galerie, pleine taille pour le dialogue. */
export type CaptureEcran = {
  miniature: string
  pleine: string
}

export type Plateforme = 'windows' | 'mac' | 'linux'

export type Succes = {
  apiName: string
  displayName: string
  description: string | null
  iconUrl: string | null
  unlockedAt: string | null
}

export type FicheJeu = {
  appId: number
  name: string
  shortDescription: string | null
  descriptionBlocks: DescriptionBlock[]
  screenshots: CaptureEcran[]
  developers: string[]
  publishers: string[]
  website: string | null
  platforms: Plateforme[]
  metacriticScore: number | null
  metacriticUrl: string | null
  backgroundImageUrl: string | null
  genres: string[]
  categories: string[]
  controllerSupport: 'none' | 'partial' | 'full'
  detailsAvailable: boolean
  releaseDate: string | null
  headerImageUrl: string | null
  playtimeForever: number
  playtimeLast2Weeks: number
  lastActivityAt: string | null
  lastActivitySource: LastActivitySource | null
  lastActivityPrecision: LastActivityPrecision | null
  achievementsTotal: number | null
  achievementsUnlocked: number | null
  steamUrl: string
}

export type SuccesDetail = {
  total: number
  /** `null` quand Steam ne permet pas de lire la progression (profil privé). */
  unlocked: number | null
  list: Succes[]
}

export const LIBELLE_MANETTE: Record<FicheJeu['controllerSupport'], string> = {
  none: 'Manette non supportée',
  partial: 'Manette partielle',
  full: 'Manette complète',
}

export const LIBELLE_PLATEFORME: Record<Plateforme, string> = {
  windows: 'Windows',
  mac: 'macOS',
  linux: 'Linux',
}

/** Erreur de chargement d'une fiche, avec le statut HTTP éventuel. */
export class ErreurFiche extends Error {
  statut: number | null

  constructor(message: string, statut: number | null) {
    super(message)
    this.name = 'ErreurFiche'
    this.statut = statut
  }
}

/** `GET /api/games/:appId` — fiche complète d'un jeu de la bibliothèque. */
export async function chargerFicheJeu(
  appId: number | string,
  signal?: AbortSignal,
): Promise<FicheJeu> {
  try {
    return await appelApi<FicheJeu>(`/api/games/${appId}`, { signal })
  } catch (error) {
    if (error instanceof ErreurApi) {
      throw new ErreurFiche(error.message, error.statut || null)
    }
    throw error
  }
}

/** `GET /api/games/:appId/achievements` — liste détaillée des succès. */
export async function chargerSuccesJeu(
  appId: number | string,
  signal?: AbortSignal,
): Promise<SuccesDetail> {
  try {
    return await appelApi<SuccesDetail>(`/api/games/${appId}/achievements`, {
      signal,
    })
  } catch (error) {
    if (error instanceof ErreurApi) {
      throw new ErreurFiche(error.message, error.statut || null)
    }
    throw error
  }
}
