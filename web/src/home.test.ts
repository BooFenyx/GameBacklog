import { describe, expect, it } from 'vitest'
import {
  SELECTION_DEFAUT,
  imagePortrait,
  libelleManette,
  metaJeu,
  metaSucces,
  parametresDepuisSelection,
  parametresSelection,
  raisonJeu,
  salutation,
  sousTitreSelection,
  titreSelection,
  type HomeGame,
  type HomeSelection,
} from './home'

function jeu(overrides: Partial<HomeGame> = {}): HomeGame {
  return {
    appId: 1145360,
    name: 'Hades',
    genres: ['Action', 'Indépendant', 'RPG'],
    controllerSupport: 'full',
    headerImageUrl: 'https://cdn/hades.jpg',
    playtimeForever: 2550,
    playtimeLast2Weeks: 192,
    lastActivityAt: '2026-11-02T21:00:00.000Z',
    lastActivitySource: 'sync_delta',
    lastActivityPrecision: 'upper_bound',
    achievementsUnlocked: 38,
    achievementsTotal: 49,
    reason: 'Voisin de Hades · 2 genres en commun',
    ...overrides,
  }
}

function selection(overrides: Partial<HomeSelection> = {}): HomeSelection {
  return {
    anchor: {
      appId: 1145360,
      name: 'Hades',
      genres: ['Action', 'Indépendant', 'RPG'],
      genreIds: [1, 2, 3],
      controllerSupport: 'full',
      headerImageUrl: 'https://cdn/hades.jpg',
      mainGenre: { id: 1, label: 'Action' },
    },
    genre: { id: 1, label: 'Action' },
    decouverte: 30,
    manette: false,
    lancement: 'tous',
    progression: false,
    items: [],
    ...overrides,
  }
}

describe('salutation', () => {
  it('dit bonjour en journée et bonsoir le soir ou la nuit', () => {
    expect(salutation(9)).toBe('Bonjour')
    expect(salutation(17)).toBe('Bonjour')
    expect(salutation(18)).toBe('Bonsoir')
    expect(salutation(2)).toBe('Bonsoir')
  })
})

describe('metaSucces', () => {
  it('affiche un compteur, un tiret ou rien', () => {
    expect(metaSucces({ achievementsUnlocked: 38, achievementsTotal: 49 })).toBe(
      '38 / 49',
    )
    expect(metaSucces({ achievementsUnlocked: null, achievementsTotal: 49 })).toBe(
      '— / 49',
    )
    expect(metaSucces({ achievementsUnlocked: 3, achievementsTotal: null })).toBeNull()
    expect(metaSucces({ achievementsUnlocked: 0, achievementsTotal: 0 })).toBeNull()
  })
})

describe('libelleManette', () => {
  it('distingue complète, partielle et absente', () => {
    expect(libelleManette('full')).toBe('Manette complète')
    expect(libelleManette('partial')).toBe('Manette partielle')
    expect(libelleManette('none')).toBe('Manette non supportée')
  })
})

describe('metaJeu', () => {
  it('annonce un jeu jamais lancé', () => {
    expect(metaJeu(jeu({ playtimeForever: 0 }))).toBe('Jamais lancé')
  })

  it('combine temps de jeu et activité dérivée', () => {
    expect(metaJeu(jeu({ playtimeForever: 2550 }))).toBe(
      '42 h 30 · depuis la sync',
    )
  })

  it('affiche seulement le temps sans activité connue', () => {
    expect(
      metaJeu(
        jeu({
          playtimeForever: 120,
          lastActivityAt: null,
          lastActivitySource: null,
          lastActivityPrecision: null,
        }),
      ),
    ).toBe('2 h de jeu')
  })
})

describe('titreSelection', () => {
  it('adapte le titre au genre et à la découverte', () => {
    expect(titreSelection(selection())).toBe(
      'Cinq jeux autour de Hades, priorité Action.',
    )
    expect(titreSelection(selection({ genre: null }))).toBe(
      'Cinq jeux proches de Hades.',
    )
    expect(titreSelection(selection({ decouverte: 80 }))).toBe(
      'Cinq jeux à découvrir autour de Hades.',
    )
    expect(titreSelection(selection({ anchor: null, genre: null }))).toBe(
      'Cinq jeux proches de ton jeu du moment.',
    )
  })
})

describe('sousTitreSelection', () => {
  it('résume les filtres actifs', () => {
    expect(sousTitreSelection(selection())).toBe(
      'Les voisins d’ambiance, avec un bonus pour Action.',
    )
    expect(
      sousTitreSelection(
        selection({
          genre: null,
          manette: true,
          lancement: 'jamais',
          progression: true,
        }),
      ),
    ).toBe(
      'Les voisins d’ambiance de ton jeu du moment. Filtres : manette, jamais lancés, proches du 100 %.',
    )
  })
})

describe('parametresSelection', () => {
  it('n’écrit aucune valeur par défaut', () => {
    expect(parametresSelection(SELECTION_DEFAUT).toString()).toBe('')
  })

  it('sérialise genre=0 et les booléens', () => {
    const query = parametresSelection({
      anchor: 252950,
      genreId: 0,
      decouverte: 100,
      manette: true,
      lancement: 'jamais',
      progression: true,
    })

    expect(query.get('anchor')).toBe('252950')
    expect(query.get('genre')).toBe('0')
    expect(query.get('decouverte')).toBe('100')
    expect(query.get('manette')).toBe('true')
    expect(query.get('lancement')).toBe('jamais')
    expect(query.get('progression')).toBe('true')
  })

  it('reconstruit les réglages depuis une sélection', () => {
    expect(parametresDepuisSelection(selection())).toEqual({
      anchor: 1145360,
      genreId: 1,
      decouverte: 30,
      manette: false,
      lancement: 'tous',
      progression: false,
    })
    expect(
      parametresDepuisSelection(selection({ anchor: null, genre: null })),
    ).toEqual({
      anchor: null,
      genreId: null,
      decouverte: 30,
      manette: false,
      lancement: 'tous',
      progression: false,
    })
  })
})

describe('raisonJeu et imagePortrait', () => {
  it('retombe sur une raison honnête sans raison serveur', () => {
    expect(raisonJeu(jeu({ reason: null }), 'Hades')).toBe('Proche de Hades')
    expect(raisonJeu(jeu(), 'Hades')).toBe(
      'Voisin de Hades · 2 genres en commun',
    )
  })

  it('construit l’URL portrait Steam', () => {
    expect(imagePortrait(1145360)).toBe(
      'https://cdn.cloudflare.steamstatic.com/steam/apps/1145360/library_600x900.jpg',
    )
  })
})
