import { urlApi } from './api'

/**
 * État d'un job d'import (`GET /api/sync`). `library` = écriture des
 * `library_entries` (la bibliothèque devient affichable), puis `details`
 * (fiches `appdetails`) et `embeddings` (descriptions indexées) en arrière-plan.
 */
export type JobSync = {
  id: number
  status: 'pending' | 'running' | 'done' | 'error'
  step: 'library' | 'details' | 'achievements' | 'embeddings' | 'done'
  totalGames: number
  processedGames: number
  error: string | null
  startedAt: string | null
  finishedAt: string | null
  /** Fiches encore à récupérer (retry dû, moins de 3 échecs « délisté »). */
  pendingDetails: number
  /** Jeux dont la fiche est définitivement indisponible (3 échecs). */
  detailsUnavailable: number
  /** Jeux dont les compteurs de succès manquent. */
  pendingAchievements: number
  /** Jeux indexables dont l'embedding manque. */
  pendingEmbeddings: number
}

export const libelleEtape: Record<JobSync['step'], string> = {
  library: 'Import de la bibliothèque',
  details: 'Récupération des fiches des jeux',
  achievements: 'Récupération des succès',
  embeddings: 'Indexation des descriptions',
  done: 'Import terminé',
}

export function estEnCours(job: JobSync | null): job is JobSync {
  return job !== null && (job.status === 'pending' || job.status === 'running')
}

/** `GET /api/sync` — état du job courant (null si jamais importé). */
export async function lireSync(): Promise<JobSync | null> {
  const res = await fetch(urlApi('/api/sync'), { credentials: 'include' })
  if (!res.ok) {
    const corps = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(corps?.message ?? `Réponse ${res.status}`)
  }
  return (await res.json().catch(() => null)) as JobSync | null
}

/** `POST /api/sync` — relance l'import en tâche de fond. */
export async function relancerSync(): Promise<JobSync> {
  const res = await fetch(urlApi('/api/sync'), {
    method: 'POST',
    credentials: 'include',
  })
  if (!res.ok) {
    const corps = (await res.json().catch(() => null)) as {
      message?: string
    } | null
    throw new Error(corps?.message ?? `Réponse ${res.status}`)
  }
  return (await res.json()) as JobSync
}