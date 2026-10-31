import { describe, expect, it } from 'vitest'
import {
  TITRE_ACTIVITE_INDISPONIBLE,
  libelleActivite,
  libelleActiviteCourte,
  titreActivite,
  type Activite,
} from './activite'
import { formaterDate } from './format'

const MAINTENANT = new Date('2026-10-31T12:00:00.000Z')

function activite(overrides: Partial<Activite> = {}): Activite {
  return {
    lastActivityAt: null,
    lastActivitySource: null,
    lastActivityPrecision: null,
    ...overrides,
  }
}

describe('libelleActivite', () => {
  it('décrit une partie détectée depuis la dernière synchronisation', () => {
    const valeur = activite({
      lastActivityAt: '2026-10-30T12:00:00.000Z',
      lastActivitySource: 'sync_delta',
      lastActivityPrecision: 'upper_bound',
    })
    expect(libelleActivite(valeur, MAINTENANT)).toBe(
      'Joué depuis la dernière synchronisation',
    )
    expect(libelleActiviteCourte(valeur)).toBe('depuis la sync')
  })

  it('décrit une activité récente dans la fenêtre de 14 jours', () => {
    const valeur = activite({
      lastActivityAt: '2026-10-24T12:00:00.000Z',
      lastActivitySource: 'recent_window',
      lastActivityPrecision: 'upper_bound',
    })
    expect(libelleActivite(valeur, MAINTENANT)).toBe(
      'Joué dans les 14 derniers jours',
    )
    expect(libelleActiviteCourte(valeur)).toBe('14 derniers jours')
  })

  it('borne une fenêtre de 14 jours détectée il y a plus de 14 jours', () => {
    const valeur = activite({
      lastActivityAt: '2026-09-01T12:00:00.000Z',
      lastActivitySource: 'recent_window',
      lastActivityPrecision: 'upper_bound',
    })
    expect(libelleActivite(valeur, MAINTENANT)).toBe(
      `Joué dans les 14 jours avant le ${formaterDate(valeur.lastActivityAt)}`,
    )
  })

  it('date le dernier succès', () => {
    const valeur = activite({
      lastActivityAt: '2026-10-12T12:00:00.000Z',
      lastActivitySource: 'achievement',
      lastActivityPrecision: 'lower_bound',
    })
    expect(libelleActivite(valeur, MAINTENANT)).toBe(
      `Dernier succès le ${formaterDate(valeur.lastActivityAt)}`,
    )
    expect(libelleActiviteCourte(valeur)).toBe('dernier succès')
  })

  it('ne renvoie rien sans source ni date', () => {
    expect(libelleActivite(activite(), MAINTENANT)).toBeNull()
    expect(libelleActiviteCourte(activite())).toBeNull()
  })
})

describe('titreActivite', () => {
  it('explique l’absence de donnée', () => {
    expect(titreActivite(activite())).toBe(TITRE_ACTIVITE_INDISPONIBLE)
  })

  it('donne la date de détection pour une borne', () => {
    const valeur = activite({
      lastActivityAt: '2026-10-30T12:00:00.000Z',
      lastActivitySource: 'sync_delta',
      lastActivityPrecision: 'upper_bound',
    })
    expect(titreActivite(valeur)).toContain(
      formaterDate(valeur.lastActivityAt) ?? '',
    )
  })

  it('n’affiche pas d’infobulle pour un succès', () => {
    expect(
      titreActivite(
        activite({
          lastActivityAt: '2026-10-12T12:00:00.000Z',
          lastActivitySource: 'achievement',
          lastActivityPrecision: 'lower_bound',
        }),
      ),
    ).toBeUndefined()
  })
})
