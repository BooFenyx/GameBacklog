import { describe, expect, it } from 'vitest'
import {
  CLE_VUE_BIBLIOTHEQUE,
  ecrireVue,
  lireVue,
  type StockageVue,
} from './useVueBibliotheque'

function stockage(initial: Record<string, string> = {}): StockageVue & {
  valeurs: Record<string, string>
} {
  const valeurs = { ...initial }
  return {
    valeurs,
    getItem(cle) {
      return valeurs[cle] ?? null
    },
    setItem(cle, valeur) {
      valeurs[cle] = valeur
    },
  }
}

describe('préférence de vue', () => {
  it('renvoie la grille par défaut', () => {
    expect(lireVue(stockage())).toBe('grille')
  })

  it('relit la liste quand elle a été choisie', () => {
    const cible = stockage({ [CLE_VUE_BIBLIOTHEQUE]: 'liste' })
    expect(lireVue(cible)).toBe('liste')
  })

  it('ignore une valeur inconnue', () => {
    const cible = stockage({ [CLE_VUE_BIBLIOTHEQUE]: 'mosaïque' })
    expect(lireVue(cible)).toBe('grille')
  })

  it('écrit la préférence', () => {
    const cible = stockage()
    ecrireVue('liste', cible)
    expect(cible.valeurs[CLE_VUE_BIBLIOTHEQUE]).toBe('liste')
  })

  it('ne casse pas si le stockage est indisponible', () => {
    expect(lireVue(null)).toBe('grille')
    expect(() => ecrireVue('liste', null)).not.toThrow()
  })

  it('ne casse pas si le stockage lève une erreur', () => {
    const casse: StockageVue = {
      getItem() {
        throw new Error('refusé')
      },
      setItem() {
        throw new Error('refusé')
      },
    }
    expect(lireVue(casse)).toBe('grille')
    expect(() => ecrireVue('liste', casse)).not.toThrow()
  })
})
