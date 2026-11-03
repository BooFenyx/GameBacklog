import type {
  LastActivityPrecision,
  LastActivitySource,
} from './activite'
import { appelApi, ErreurApi } from './http'
import type { DureeJeu, EtatJeu, ModeJeu } from './filters'

export type ModeRecherche = 'name' | 'semantic'
export type FiltreManette = 'full' | 'partial'
export type SourceResultat = 'name' | 'semantic' | 'series'

export const LIBELLE_MODE: Record<ModeRecherche, string> = {
  name: 'Nom de jeu',
  semantic: 'Description textuelle',
}

export type ResultatRecherche = {
  appId: number
  name: string
  shortDescription: string | null
  headerImageUrl: string | null
  genres: string[]
  modes: ModeJeu[]
  controllerSupport: 'none' | 'partial' | 'full'
  playtimeForever: number
  lastActivityAt: string | null
  lastActivitySource: LastActivitySource | null
  lastActivityPrecision: LastActivityPrecision | null
  score: number | null
  source: SourceResultat
  criteria: string[]
}

export type ReponseRecherche = {
  mode: ModeRecherche
  results: ResultatRecherche[]
  offset: number
  limit: number
  hasMore: boolean
  total: number
  degraded: boolean
  message?: string
}

export type ParametresRecherche = {
  q: string
  mode: ModeRecherche
  manette?: FiltreManette
  genres?: number[]
  modes?: ModeJeu[]
  etat?: EtatJeu
  duree?: DureeJeu[]
  limit?: number
  offset?: number
}

/** Erreur HTTP de l'API de recherche, avec le statut et l'éventuel `Retry-After`. */
export class ErreurRecherche extends Error {
  statut: number
  retryAfterSecondes: number | null

  constructor(
    message: string,
    statut: number,
    retryAfterSecondes: number | null = null,
  ) {
    super(message)
    this.name = 'ErreurRecherche'
    this.statut = statut
    this.retryAfterSecondes = retryAfterSecondes
  }
}

/** `GET /api/search` : renvoie les résultats bruts, paginés. */
export async function rechercherJeux(
  parametres: ParametresRecherche,
  signal?: AbortSignal,
): Promise<ReponseRecherche> {
  const query = new URLSearchParams({
    q: parametres.q,
    mode: parametres.mode,
  })
  if (parametres.manette) query.set('manette', parametres.manette)
  if (parametres.genres && parametres.genres.length > 0) {
    query.set('genres', parametres.genres.join(','))
  }
  if (parametres.modes && parametres.modes.length > 0) {
    query.set('modes', parametres.modes.join(','))
  }
  if (parametres.etat) query.set('etat', parametres.etat)
  if (parametres.duree && parametres.duree.length > 0) {
    query.set('duree', parametres.duree.join(','))
  }
  if (parametres.limit !== undefined) query.set('limit', String(parametres.limit))
  if (parametres.offset !== undefined) {
    query.set('offset', String(parametres.offset))
  }

  try {
    return await appelApi<ReponseRecherche>(`/api/search?${query.toString()}`, {
      signal,
    })
  } catch (error) {
    if (error instanceof ErreurApi) {
      throw new ErreurRecherche(
        error.message,
        error.statut,
        error.retryAfterSecondes,
      )
    }
    throw error
  }
}
