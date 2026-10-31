import { describe, expect, it } from 'vitest'
import { formaterDate } from './format'
import { pourquoiMaintenant } from './resultat'
import type { ResultatRecherche } from './search'

function resultat(
  overrides: Partial<ResultatRecherche> = {},
): ResultatRecherche {
  return {
    appId: 620,
    name: 'Portal 2',
    shortDescription: null,
    headerImageUrl: null,
    genres: [],
    modes: ['solo'],
    controllerSupport: 'full',
    playtimeForever: 1200,
    lastActivityAt: null,
    lastActivitySource: null,
    lastActivityPrecision: null,
    score: null,
    source: 'name',
    criteria: [],
    ...overrides,
  }
}

describe('pourquoiMaintenant', () => {
  it('signale un jeu jamais lancé', () => {
    expect(pourquoiMaintenant(resultat({ playtimeForever: 0 }))).toEqual({
      texte: "Jamais lancé — une découverte qui t'attend.",
      jamais: true,
    })
  })

  it('reprend une activité détectée depuis la dernière synchronisation', () => {
    expect(
      pourquoiMaintenant(
        resultat({
          lastActivityAt: '2026-10-30T12:00:00.000Z',
          lastActivitySource: 'sync_delta',
          lastActivityPrecision: 'upper_bound',
        }),
      ),
    ).toEqual({
      texte:
        'Joué depuis la dernière synchronisation — 20 h au compteur.',
      jamais: false,
    })
  })

  it('date le dernier succès', () => {
    const activite = {
      lastActivityAt: '2026-10-12T12:00:00.000Z',
      lastActivitySource: 'achievement' as const,
      lastActivityPrecision: 'lower_bound' as const,
    }
    expect(pourquoiMaintenant(resultat(activite)).texte).toBe(
      `Dernier succès le ${formaterDate(activite.lastActivityAt)} — 20 h au compteur.`,
    )
  })

  it('se contente du temps de jeu sans activité connue', () => {
    expect(pourquoiMaintenant(resultat())).toEqual({
      texte: '20 h au compteur.',
      jamais: false,
    })
  })
})
