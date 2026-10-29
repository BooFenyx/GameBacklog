import { describe, expect, it } from 'vitest'
import type { JeuBibliotheque } from '../../library'
import {
  contexteCarte,
  etatJeu,
  libelleMode,
  metaJeu,
} from './affichage'

function jeu(overrides: Partial<JeuBibliotheque> = {}): JeuBibliotheque {
  return {
    appId: 620,
    name: 'Portal 2',
    headerImageUrl: null,
    genres: ['Action', 'Aventure', 'Puzzle'],
    modes: ['solo', 'coop'],
    controllerSupport: 'full',
    playtimeForever: 1200,
    playtimeLast2Weeks: 0,
    lastPlayedAt: new Date(Date.now() - 8 * 86_400_000).toISOString(),
    achievementsUnlocked: 12,
    ...overrides,
  }
}

describe('affichage — état et méta', () => {
  it('marque un jeu jamais lancé', () => {
    expect(etatJeu(jeu({ playtimeForever: 0 }))).toEqual({
      label: 'Jamais lancé',
      recent: false,
    })
  })

  it('marque un jeu joué cette semaine', () => {
    expect(etatJeu(jeu({ playtimeLast2Weeks: 30 }))).toEqual({
      label: 'Joué cette semaine',
      recent: true,
    })
  })

  it('marque un jeu joué sans activité récente', () => {
    expect(etatJeu(jeu())).toEqual({ label: 'Joué', recent: false })
  })

  it('sépare le temps de jeu et la dernière partie', () => {
    expect(metaJeu(jeu())).toEqual({
      temps: '20 h',
      dernier: 'il y a 8 j',
      jamais: false,
    })
  })

  it('signale l’absence de temps de jeu', () => {
    expect(metaJeu(jeu({ playtimeForever: 0, lastPlayedAt: null }))).toEqual({
      temps: null,
      dernier: null,
      jamais: true,
    })
  })
})

describe('affichage — contexte accessible', () => {
  it('libelle un mode connu', () => {
    expect(libelleMode('coop')).toBe('Coop')
  })

  it('conserve un mode inconnu', () => {
    expect(libelleMode('inconnu')).toBe('inconnu')
  })

  it('compose le contexte de la carte', () => {
    expect(contexteCarte(jeu())).toBe('Joué, Solo, Coop, manette complète')
  })
})
