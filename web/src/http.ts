import { urlApi } from './api'

/** Événement émis quand l'API répond 401 : la session doit être considérée expirée. */
export const EVENEMENT_SESSION_EXPIREE = 'gamebacklog:session-expiree'

/** Erreur HTTP ou réseau normalisée pour tous les appels de l'API. */
export class ErreurApi extends Error {
  readonly statut: number
  readonly retryAfterSecondes: number | null

  constructor(
    message: string,
    statut: number,
    retryAfterSecondes: number | null = null,
  ) {
    super(message)
    this.name = 'ErreurApi'
    this.statut = statut
    this.retryAfterSecondes = retryAfterSecondes
  }
}

/** Écoute l'expiration de session ; renvoie la fonction de désabonnement. */
export function surSessionExpiree(rappel: () => void): () => void {
  if (typeof window === 'undefined') return () => {}
  window.addEventListener(EVENEMENT_SESSION_EXPIREE, rappel)
  return () => window.removeEventListener(EVENEMENT_SESSION_EXPIREE, rappel)
}

type OptionsAppel = RequestInit & {
  /** Délai maximal avant abandon (15 s par défaut, 0 pour désactiver). */
  timeoutMs?: number
  /** Autorise un 200 sans corps (ex. `GET /api/sync` sans job) → `null`. */
  allowEmpty?: boolean
}

/**
 * Appel JSON commun à l'API : cookie de session, timeout et 401 global.
 *
 * Le timeout évite qu'un cold start Render laisse un écran de chargement
 * éternel. Un 401 émet `EVENEMENT_SESSION_EXPIREE` avant de lever, pour que le
 * provider de session puisse vider l'utilisateur et afficher la reconnexion.
 */
export async function appelApi<T>(
  chemin: string,
  options: OptionsAppel = {},
): Promise<T> {
  const {
    timeoutMs = 15_000,
    allowEmpty = false,
    signal: signalExterne,
    ...init
  } = options
  const controller = new AbortController()
  const timeout =
    timeoutMs > 0
      ? setTimeout(() => controller.abort(), timeoutMs)
      : undefined

  const annuler = () => controller.abort()
  if (signalExterne) {
    if (signalExterne.aborted) controller.abort()
    else signalExterne.addEventListener('abort', annuler, { once: true })
  }

  try {
    const res = await fetch(urlApi(chemin), {
      credentials: 'include',
      ...init,
      signal: controller.signal,
    })

    if (res.status === 401) {
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(EVENEMENT_SESSION_EXPIREE))
      }
    }

    if (!res.ok) {
      const corps = (await res.json().catch(() => null)) as {
        message?: string | string[]
      } | null
      const message = Array.isArray(corps?.message)
        ? corps.message.join(' ')
        : corps?.message
      const retryAfter = Number(res.headers?.get?.('Retry-After'))
      throw new ErreurApi(
        message ?? `Réponse ${res.status}`,
        res.status,
        Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
      )
    }

    if (res.status === 204) return undefined as T
    // Un 200 sans corps est légitime pour `GET /api/sync` (aucun job) : Nest
    // sérialise `null` en corps vide. On ne doit pas le confondre avec une
    // panne réseau.
    const texte = await res.text()
    if (!texte) {
      if (allowEmpty) return null as T
      throw new ErreurApi('Réponse vide du serveur.', res.status)
    }
    try {
      return JSON.parse(texte) as T
    } catch {
      throw new ErreurApi('Réponse invalide du serveur.', res.status)
    }
  } catch (error) {
    if (error instanceof ErreurApi) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      if (signalExterne?.aborted) {
        throw new ErreurApi('Requête annulée.', 0)
      }
      throw new ErreurApi('Le serveur met trop de temps à répondre.', 0)
    }
    throw new ErreurApi('Impossible de joindre le serveur.', 0)
  } finally {
    if (timeout !== undefined) clearTimeout(timeout)
    signalExterne?.removeEventListener('abort', annuler)
  }
}
