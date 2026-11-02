import { describe, expect, it } from 'vitest'
import { formaterAnnee, formaterDate } from './format'

describe('formaterDate', () => {
  it('formate une date seule sans conversion de fuseau', () => {
    expect(formaterDate('2011-04-18')).toBe('18/04/2011')
  })

  it('formate une date ISO complète', () => {
    expect(formaterDate('2011-04-18T12:00:00.000Z')).toMatch(/2011/)
  })

  it('renvoie null pour une valeur absente ou illisible', () => {
    expect(formaterDate(null)).toBeNull()
    expect(formaterDate('pas une date')).toBeNull()
  })
})

describe('formaterAnnee', () => {
  it('extrait l’année d’une date seule sans décalage', () => {
    expect(formaterAnnee('2011-04-18')).toBe(2011)
  })

  it('extrait l’année d’une date ISO', () => {
    expect(formaterAnnee('2011-04-18T12:00:00.000Z')).toBe(2011)
  })

  it('renvoie null pour une valeur absente ou illisible', () => {
    expect(formaterAnnee(null)).toBeNull()
    expect(formaterAnnee('pas une date')).toBeNull()
  })
})
