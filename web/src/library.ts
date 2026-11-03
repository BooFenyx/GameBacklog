import type {
  LastActivityPrecision,
  LastActivitySource,
} from './activite'
import { appelApi } from './http'
import {
  ecrireFiltres,
  type DureeJeu,
  type EtatJeu,
  type FiltreManette,
  type Filtres,
  type ModeJeu,
} from './filters'

/** Nombre de jeux par page dans la bibliothèque. */
export const LIMITE_BIBLIOTHEQUE = 48

export type JeuBibliotheque = {
  appId: number
  name: string
  headerImageUrl: string | null
  genres: string[]
  modes: ModeJeu[]
  controllerSupport: 'none' | 'partial' | 'full'
  playtimeForever: number
  playtimeLast2Weeks: number
  lastActivityAt: string | null
  lastActivitySource: LastActivitySource | null
  lastActivityPrecision: LastActivityPrecision | null
  /** `null` tant que le schéma Steam n'a pas été récupéré. */
  achievementsTotal: number | null
  /** `null` tant que la progression du joueur n'a pas été récupérée. */
  achievementsUnlocked: number | null
}

export type ReponseBibliotheque = {
  items: JeuBibliotheque[]
  total: number
  limit: number
  offset: number
  hasMore: boolean
}

export type FacetteGenre = {
  id: number
  label: string
  count: number
}

export type FacetteValeur<T extends string> = {
  value: T
  label: string
  count: number
}

export type Facettes = {
  total: number
  genres: FacetteGenre[]
  modes: FacetteValeur<ModeJeu>[]
  manettes: FacetteValeur<FiltreManette>[]
  etats: FacetteValeur<EtatJeu>[]
  durees: FacetteValeur<DureeJeu>[]
  /** Faux quand aucune entrée n'a d'activité dérivée : le tri « récent » est masqué. */
  lastActivityDisponible: boolean
}

/** `GET /api/library` : page filtrée, triée et paginée. */
export async function chargerBibliotheque(
  filtres: Filtres,
  offset: number,
  signal?: AbortSignal,
  limit = LIMITE_BIBLIOTHEQUE,
): Promise<ReponseBibliotheque> {
  const params = ecrireFiltres(filtres, { avecTri: true })
  params.set('limit', String(limit))
  params.set('offset', String(offset))

  return appelApi<ReponseBibliotheque>(`/api/library?${params.toString()}`, {
    signal,
  })
}

/** `GET /api/library/facets` : compteurs des filtres disponibles. */
export async function chargerFacettes(
  signal?: AbortSignal,
): Promise<Facettes> {
  return appelApi<Facettes>('/api/library/facets', { signal })
}
