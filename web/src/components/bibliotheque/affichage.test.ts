import { describe, expect, it } from 'vitest'
import type { JeuBibliotheque } from '../../library'
import {
  contexteCarte,
  etatJeu,
  libelleMode,
  metaJeu,
  succesAffiche,
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
    achievementsTotal: 51,
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

describe('affichage — compteur de succès', () => {
  it('affiche débloqués / total', () => {
    expect(succesAffiche(jeu())).toBe('12 / 51')
  })

  it('affiche un tiret quand la progression est inconnue', () => {
    expect(succesAffiche(jeu({ achievementsUnlocked: null }))).toBe('— / 51')
  })

  it('masque le compteur quand le total est inconnu ou nul', () => {
    expect(succesAffiche(jeu({ achievementsTotal: null }))).toBeNull()
    expect(succesAffiche(jeu({ achievementsTotal: 0 }))).toBeNull()
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
