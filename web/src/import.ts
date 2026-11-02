import { libelleEtape, type JobSync } from './sync'

export type EtatImport = {
  texte: string
  action: 'aucune' | 'relancer' | 'reprendre'
  alerte: boolean
}

const VIDE: EtatImport = { texte: '', action: 'aucune', alerte: false }

/**
 * Traduit un message d'erreur d'import en message utilisateur. Réutilisé par
 * la liste et par le bandeau, pour que le profil privé soit toujours expliqué.
 */
export function messageErreurImport(texte: string): string {
  if (texte.includes('profil privé') || texte.includes('privé')) {
    return 'Ton profil Steam est privé. Rends-le public dans les paramètres Steam pour importer ta bibliothèque.'
  }
  if (texte.includes('quota')) {
    return 'Quota d’embedding atteint (Google Gemini) : l’import reprendra plus tard.'
  }
  return texte
}

function pluriel(nombre: number, mot: string, suffixe = 's'): string {
  return `${nombre} ${mot}${nombre > 1 ? suffixe : ''}`
}

/**
 * Traduit l'état d'un job d'import en bandeau lisible.
 *
 * Un job `done` avec un reliquat n'est pas « en cours » : il propose une
 * reprise, sans relancer le polling. Les fiches indisponibles sont définitives
 * et ne justifient pas une reprise.
 */
export function etatImport(job: JobSync | null): EtatImport {
  if (!job) return VIDE

  if (job.status === 'error') {
    return {
      texte: job.error?.trim() || 'Import interrompu.',
      action: 'relancer',
      alerte: true,
    }
  }

  if (job.status === 'done') {
    const aReprendre: string[] = []
    if (job.pendingDetails > 0) {
      aReprendre.push(pluriel(job.pendingDetails, 'fiche'))
    }
    if (job.pendingAchievements > 0) {
      aReprendre.push(pluriel(job.pendingAchievements, 'succès', ''))
    }
    if (job.pendingEmbeddings > 0) {
      aReprendre.push(pluriel(job.pendingEmbeddings, 'embedding'))
    }

    const morceaux: string[] = []
    if (aReprendre.length > 0) {
      morceaux.push(`${aReprendre.join(', ')} à reprendre`)
    }
    if (job.detailsUnavailable > 0) {
      morceaux.push(
        `${pluriel(job.detailsUnavailable, 'fiche')} indisponible${job.detailsUnavailable > 1 ? 's' : ''}`,
      )
    }

    if (morceaux.length === 0) return VIDE

    return {
      texte: `Import terminé — ${morceaux.join(', ')}`,
      action: aReprendre.length > 0 ? 'reprendre' : 'aucune',
      alerte: true,
    }
  }

  const progression =
    job.totalGames > 0 ? ` — ${job.processedGames}/${job.totalGames}` : ''
  return {
    texte: `${libelleEtape[job.step]}${progression}`,
    action: 'aucune',
    alerte: false,
  }
}
