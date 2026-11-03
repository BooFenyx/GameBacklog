import { describe, expect, it } from 'vitest'
import { TITRE_ACTIVITE_INDISPONIBLE } from '../../activite'
import { formaterDate } from '../../format'
import type { JeuBibliotheque } from '../../library'
import {
  champsCarteJeu,
  champsLigneJeu,
  contexteCarte,
  etatJeu,
  libelleMode,
  metaJeu,
  succesAffiche,
  succesComplet,
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
    lastActivityAt: null,
    lastActivitySource: null,
    lastActivityPrecision: null,
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

  it('sépare le temps de jeu et l’activité dérivée', () => {
    const activite = {
      lastActivityAt: '2026-10-30T12:00:00.000Z',
      lastActivitySource: 'sync_delta' as const,
      lastActivityPrecision: 'upper_bound' as const,
    }
    expect(metaJeu(jeu(activite))).toEqual({
      temps: '20 h',
      activite: 'depuis la sync',
      activiteTitre: `Détecté lors de la synchronisation du ${formaterDate(activite.lastActivityAt)}`,
      jamais: false,
    })
  })

  it('signale l’absence de temps de jeu', () => {
    expect(metaJeu(jeu({ playtimeForever: 0 }))).toEqual({
      temps: null,
      activite: null,
      activiteTitre: TITRE_ACTIVITE_INDISPONIBLE,
      jamais: true,
    })
  })

  it('ne marque pas « jamais lancé » un jeu joué sans activité connue', () => {
    expect(metaJeu(jeu())).toEqual({
      temps: '20 h',
      activite: null,
      activiteTitre: TITRE_ACTIVITE_INDISPONIBLE,
      jamais: false,
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

  it('signale un jeu avec tous les succès débloqués', () => {
    expect(succesComplet(jeu())).toBe(false)
    expect(
      succesComplet(jeu({ achievementsUnlocked: 51 })),
    ).toBe(true)
    expect(
      succesComplet(jeu({ achievementsUnlocked: null })),
    ).toBe(false)
    expect(
      succesComplet(jeu({ achievementsTotal: 0, achievementsUnlocked: 0 })),
    ).toBe(false)
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

describe('affichage — champs exacts de la carte', () => {
  it('fige les champs rendus par la carte', () => {
    expect(champsCarteJeu(jeu())).toEqual({
      appId: 620,
      nom: 'Portal 2',
      image: null,
      etat: { label: 'Joué', recent: false },
      contexte: 'Joué, Solo, Coop, manette complète',
      genres: ['Action', 'Aventure'],
      genresRestants: 1,
      temps: '20 h',
      activite: null,
      activiteTitre: TITRE_ACTIVITE_INDISPONIBLE,
      jamais: false,
      modes: [
        { valeur: 'solo', libelle: 'Solo', variante: 'solo' },
        { valeur: 'coop', libelle: 'Coop', variante: 'mode' },
      ],
      manette: true,
      succes: '12 / 51',
      complet: false,
    })
  })

  it('gère un jeu jamais lancé, partiel et sans succès', () => {
    const champs = champsCarteJeu(
      jeu({
        playtimeForever: 0,
        controllerSupport: 'partial',
        achievementsUnlocked: null,
        modes: [],
      }),
    )

    expect(champs.etat).toEqual({ label: 'Jamais lancé', recent: false })
    expect(champs.temps).toBeNull()
    expect(champs.jamais).toBe(true)
    expect(champs.manette).toBe(false)
    expect(champs.succes).toBe('— / 51')
    expect(champs.complet).toBe(false)
    expect(champs.activite).toBeNull()
    expect(champs.contexte).toBe('Jamais lancé')
  })

  it('marque un jeu à 100 % de succès', () => {
    const champs = champsCarteJeu(jeu({ achievementsUnlocked: 51 }))

    expect(champs.succes).toBe('51 / 51')
    expect(champs.complet).toBe(true)
  })
})

describe('affichage — champs exacts de la ligne', () => {
  it('affiche tous les genres et la manette lisible', () => {
    const champs = champsLigneJeu(
      jeu({ controllerSupport: 'partial', playtimeForever: 90 }),
    )

    expect(champs.genres).toEqual(['Action', 'Aventure', 'Puzzle'])
    expect(champs.modes.map((mode) => mode.libelle)).toEqual(['Solo', 'Coop'])
    expect(champs.temps).toBe('1 h 30')
    expect(champs.manetteSupport).toBe('partial')
    expect(champs.manetteLibelle).toBe('Manette partielle')
    expect(champs.succes).toBe('12 / 51')
  })

  it('garde les champs vides cohérents', () => {
    const champs = champsLigneJeu(
      jeu({
        playtimeForever: 0,
        achievementsTotal: 0,
        achievementsUnlocked: 0,
      }),
    )

    expect(champs.temps).toBeNull()
    expect(champs.jamais).toBe(true)
    expect(champs.activite).toBeNull()
    expect(champs.succes).toBeNull()
    expect(champs.complet).toBe(false)
  })
})
