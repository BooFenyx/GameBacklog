import { describe, expect, it } from 'vitest'
import { etatImport } from './import'
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

  it('signale les fiches indisponibles sans proposer de reprise', () => {
    const etat = etatImport(job({ detailsUnavailable: 2 }))

    expect(etat.texte).toContain('2 fiches indisponibles')
    expect(etat.action).toBe('aucune')
    expect(etat.alerte).toBe(true)
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

  it('n’affiche pas de division par zéro sans total', () => {
    const etat = etatImport(
      job({ status: 'pending', step: 'library', totalGames: 0 }),
    )

    expect(etat.texte).toBe('Import de la bibliothèque')
  })
})
