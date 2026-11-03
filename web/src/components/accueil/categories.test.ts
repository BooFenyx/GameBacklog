import { describe, expect, it } from 'vitest'
import {
  TAILLE_PAGE_CATEGORIES,
  fenetreCategorie,
  pageCategorie,
  pagesCategorie,
} from './categories'

describe('pagination des catégories', () => {
  it('calcule le nombre de pages', () => {
    expect(TAILLE_PAGE_CATEGORIES).toBe(3)
    expect(pagesCategorie(0)).toBe(1)
    expect(pagesCategorie(1)).toBe(1)
    expect(pagesCategorie(3)).toBe(1)
    expect(pagesCategorie(4)).toBe(2)
    expect(pagesCategorie(9)).toBe(3)
  })

  it('ramène le tour dans les bornes, y compris négatif', () => {
    expect(pageCategorie(0, 3)).toBe(0)
    expect(pageCategorie(1, 3)).toBe(1)
    expect(pageCategorie(3, 3)).toBe(0)
    expect(pageCategorie(-1, 3)).toBe(2)
    expect(pageCategorie(5, 1)).toBe(0)
  })

  it('renvoie une fenêtre de 3 sans doublon', () => {
    const items = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    expect(fenetreCategorie(items, 0)).toEqual(['a', 'b', 'c'])
    expect(fenetreCategorie(items, 1)).toEqual(['d', 'e', 'f'])
    expect(fenetreCategorie(items, 2)).toEqual(['g'])
    expect(fenetreCategorie(items, 3)).toEqual(['a', 'b', 'c'])
  })

  it('gère une liste plus courte que la page', () => {
    expect(fenetreCategorie(['a', 'b'], 0)).toEqual(['a', 'b'])
    expect(fenetreCategorie(['a', 'b'], 4)).toEqual(['a', 'b'])
  })
})
