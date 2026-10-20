import { urlApi } from './api'

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
  controllerSupport: 'none' | 'partial' | 'full'
  playtimeForever: number
  lastPlayedAt: string | null
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
  degraded: boolean
  message?: string
}

export type ParametresRecherche = {
  q: string
  mode: ModeRecherche
  manette?: FiltreManette
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
  if (parametres.limit !== undefined) query.set('limit', String(parametres.limit))
  if (parametres.offset !== undefined) {
    query.set('offset', String(parametres.offset))
  }

  const res = await fetch(urlApi(`/api/search?${query.toString()}`), {
    credentials: 'include',
    signal,
  })

  if (!res.ok) {
    const corps = (await res.json().catch(() => null)) as {
      message?: string | string[]
    } | null
    const message = Array.isArray(corps?.message)
      ? corps.message.join(' ')
      : corps?.message
    const retryAfter = Number(res.headers.get('Retry-After'))
    throw new ErreurRecherche(
      message ?? `Réponse ${res.status}`,
      res.status,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    )
  }

  return (await res.json()) as ReponseRecherche
}
