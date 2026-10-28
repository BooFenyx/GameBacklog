import { urlApi } from './api'
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
  lastPlayedAt: string | null
  achievementsUnlocked: number
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
}

async function messageErreur(res: Response): Promise<string> {
  const corps = (await res.json().catch(() => null)) as {
    message?: string | string[]
  } | null
  const message = Array.isArray(corps?.message)
    ? corps.message.join(' ')
    : corps?.message
  return message ?? `Réponse ${res.status}`
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

  const res = await fetch(urlApi(`/api/library?${params.toString()}`), {
    credentials: 'include',
    signal,
  })
  if (!res.ok) throw new Error(await messageErreur(res))
  return (await res.json()) as ReponseBibliotheque
}

/** `GET /api/library/facets` : compteurs des filtres disponibles. */
export async function chargerFacettes(
  signal?: AbortSignal,
): Promise<Facettes> {
  const res = await fetch(urlApi('/api/library/facets'), {
    credentials: 'include',
    signal,
  })
  if (!res.ok) throw new Error(await messageErreur(res))
  return (await res.json()) as Facettes
}
