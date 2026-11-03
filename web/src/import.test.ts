import { describe, expect, it } from 'vitest'
import { etatImport, messageErreurImport } from './import'
import type { JobSync } from './sync'

function job(overrides: Partial<JobSync> = {}): JobSync {
  return {
    id: 1,
    status: 'done',
    step: 'done',
    totalGames: 0,
    processedGames: 0,
    error: null,
    startedAt: null,
    finishedAt: null,
    pendingDetails: 0,
    detailsUnavailable: 0,
    pendingAchievements: 0,
    pendingEmbeddings: 0,
    ...overrides,
  }
}

describe('etatImport', () => {
  it('ne propose rien sans job', () => {
    expect(etatImport(null)).toEqual({
      texte: '',
      action: 'aucune',
      alerte: false,
    })
  })

  it('affiche l’erreur et propose de relancer', () => {
    const etat = etatImport(
      job({ status: 'error', error: 'Profil Steam privé.' }),
    )

    expect(etat).toEqual({
      texte: 'Profil Steam privé.',
      action: 'relancer',
      alerte: true,
    })
  })

  it('utilise un message générique quand l’erreur est vide', () => {
    expect(etatImport(job({ status: 'error', error: null })).texte).toBe(
      'Import interrompu.',
    )
  })

  it('liste les trois reliquats et propose de reprendre', () => {
    const etat = etatImport(
      job({
        pendingDetails: 12,
        pendingAchievements: 3,
        pendingEmbeddings: 8,
      }),
    )

    expect(etat.texte).toBe(
      'Import terminé — 12 fiches, 3 succès, 8 embeddings à reprendre',
    )
    expect(etat.action).toBe('reprendre')
    expect(etat.alerte).toBe(true)
  })

  it('précise la limite API atteinte avec les reliquats', () => {
    const etat = etatImport(
      job({
        error: 'Limite API Steam atteinte',
        pendingDetails: 12,
        pendingEmbeddings: 8,
      }),
    )

    expect(etat.texte).toBe(
      'Import terminé — Limite API Steam atteinte — 12 fiches, 8 embeddings à reprendre',
    )
    expect(etat.action).toBe('reprendre')
    expect(etat.alerte).toBe(true)
  })

  it('n’affiche pas de bandeau pour des fiches indisponibles', () => {
    const etat = etatImport(job({ detailsUnavailable: 2 }))

    expect(etat).toEqual({ texte: '', action: 'aucune', alerte: false })
  })

  it('affiche les reliquats sans les fiches indisponibles', () => {
    const etat = etatImport(
      job({ detailsUnavailable: 2, pendingEmbeddings: 8 }),
    )

    expect(etat.texte).toBe('Import terminé — 8 embeddings à reprendre')
    expect(etat.texte).not.toContain('indisponible')
    expect(etat.action).toBe('reprendre')
  })

  it('propose de reprendre s’il ne reste que des embeddings', () => {
    const etat = etatImport(job({ pendingEmbeddings: 8 }))

    expect(etat.texte).toContain('8 embeddings à reprendre')
    expect(etat.action).toBe('reprendre')
  })

  it('n’affiche rien quand tout est terminé', () => {
    expect(etatImport(job())).toEqual({
      texte: '',
      action: 'aucune',
      alerte: false,
    })
  })

  it('affiche l’étape et la progression pendant l’import', () => {
    const etat = etatImport(
      job({
        status: 'running',
        step: 'details',
        totalGames: 250,
        processedGames: 100,
      }),
    )

    expect(etat).toEqual({
      texte: 'Récupération des fiches des jeux — 100/250',
      action: 'aucune',
      alerte: false,
    })
  })

  it('précise la limite API pendant une passe en cours', () => {
    const etat = etatImport(
      job({
        status: 'running',
        step: 'details',
        error: 'Limite API Steam atteinte',
        totalGames: 250,
        processedGames: 100,
      }),
    )

    expect(etat.texte).toBe(
      'Récupération des fiches des jeux — Limite API Steam atteinte — 100/250',
    )
  })

  it('n’affiche pas de division par zéro sans total', () => {
    const etat = etatImport(
      job({ status: 'pending', step: 'library', totalGames: 0 }),
    )

    expect(etat.texte).toBe('Import de la bibliothèque')
  })
})

describe('messageErreurImport', () => {
  it('explique le profil Steam privé', () => {
    expect(
      messageErreurImport(
        'Steam a refusé l’accès (403) : profil privé ou clé invalide',
      ),
    ).toContain('Rends-le public')
  })

  it('explique le quota d’embedding', () => {
    expect(messageErreurImport('quota-embedding-atteint')).toContain(
      'Quota d’embedding',
    )
  })

  it('laisse passer un message inconnu', () => {
    expect(messageErreurImport('Steam est injoignable')).toBe(
      'Steam est injoignable',
    )
  })
})
