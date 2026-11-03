import { NotFoundException } from '@nestjs/common';
import type { Db } from '../db/db.module.js';
import {
  bornerSimilarite,
  compterGenresCommuns,
  HomeService,
  normaliserDecouverte,
  poidsActivite,
  poidsNouveaute,
  poidsProgression,
  preferenceTemps,
  raisonAFinir,
  raisonMenu,
  raisonRetrouver,
  raisonSelection,
  scoreMenu,
  scoreSelection,
  signauxMenu,
} from './home.service.js';

describe('score de la sélection', () => {
  const base = {
    similarite: 1,
    matchGenre: true,
    lastActivitySource: 'sync_delta' as const,
    achievementsUnlocked: 0,
    achievementsTotal: 10,
    playtimeForever: 600,
    decouverte: 30,
  };

  it('combine similarité, bonus genre, activité et progression', () => {
    expect(scoreSelection(base)).toBeCloseTo(1.0555, 5);
  });

  it('ne garde que la part de nouveauté sans similarité ni genre', () => {
    expect(
      scoreSelection({
        ...base,
        similarite: 0,
        matchGenre: false,
        lastActivitySource: null,
        achievementsUnlocked: null,
        achievementsTotal: null,
      }),
    ).toBeCloseTo(0.009, 5);
  });

  it('fait monter la nouveauté avec la découverte', () => {
    const candidatNeuf = {
      similarite: 0,
      matchGenre: false,
      lastActivitySource: null,
      achievementsUnlocked: null,
      achievementsTotal: null,
      playtimeForever: 0,
    };

    const a10 = scoreSelection({ ...candidatNeuf, decouverte: 10 });
    const a30 = scoreSelection({ ...candidatNeuf, decouverte: 30 });
    const a100 = scoreSelection({ ...candidatNeuf, decouverte: 100 });

    expect(a10).toBeCloseTo(0.03, 5);
    expect(a30).toBeCloseTo(0.09, 5);
    expect(a100).toBeCloseTo(0.3, 5);
    expect(a10).toBeLessThan(a30);
    expect(a30).toBeLessThan(a100);
  });

  it('borne la découverte entre 10 et 100 %', () => {
    expect(normaliserDecouverte(0)).toBe(0.1);
    expect(normaliserDecouverte(10)).toBe(0.1);
    expect(normaliserDecouverte(100)).toBe(1);
    expect(normaliserDecouverte(200)).toBe(1);
  });

  it('borne la similarité entre 0 et 1', () => {
    expect(bornerSimilarite(1.2)).toBe(1);
    expect(bornerSimilarite(-0.3)).toBe(0);
    expect(bornerSimilarite(Number.NaN)).toBe(0);
  });
});

describe('signaux élémentaires', () => {
  it('pondère l’activité dérivée', () => {
    expect(poidsActivite('sync_delta')).toBe(1);
    expect(poidsActivite('recent_window')).toBe(0.8);
    expect(poidsActivite('achievement')).toBe(0.5);
    expect(poidsActivite(null)).toBe(0);
  });

  it('calcule la progression des succès', () => {
    expect(poidsProgression(5, 10)).toBe(0.5);
    expect(poidsProgression(0, 10)).toBe(0);
    expect(poidsProgression(10, 10)).toBe(0);
    expect(poidsProgression(null, 10)).toBe(0);
    expect(poidsProgression(5, null)).toBe(0);
    expect(poidsProgression(0, 0)).toBe(0);
  });

  it('pondère la nouveauté selon le temps de jeu', () => {
    expect(poidsNouveaute(0)).toBe(1);
    expect(poidsNouveaute(60)).toBe(0.7);
    expect(poidsNouveaute(300)).toBe(0.4);
    expect(poidsNouveaute(600)).toBe(0.1);
  });

  it('compte les genres communs sans doublon', () => {
    expect(compterGenresCommuns([1, 1, 9, 3], [9, 1])).toBe(2);
    expect(compterGenresCommuns([], [9, 1])).toBe(0);
    expect(compterGenresCommuns(null, null)).toBe(0);
  });
});

describe('menu', () => {
  it('privilégie la progression sur 30 et 45 min', () => {
    expect(
      preferenceTemps({
        temps: 30,
        continuite: 0,
        progression: 1,
        playtimeForever: 0,
      }),
    ).toBeCloseTo(0.85, 5);
    expect(
      preferenceTemps({
        temps: 45,
        continuite: 0,
        progression: 1,
        playtimeForever: 0,
      }),
    ).toBeCloseTo(0.7, 5);
  });

  it('privilégie le temps de jeu sur 1 h et 2 h', () => {
    expect(
      preferenceTemps({
        temps: 60,
        continuite: 0,
        progression: 0,
        playtimeForever: 900,
      }),
    ).toBeCloseTo(0.1, 5);
    expect(
      preferenceTemps({
        temps: 120,
        continuite: 0,
        progression: 0,
        playtimeForever: 3600,
      }),
    ).toBeCloseTo(0.4, 5);
  });

  it('calcule le score « continuer »', () => {
    expect(
      scoreMenu({
        similarite: 1,
        lastActivitySource: 'sync_delta',
        achievementsUnlocked: 5,
        achievementsTotal: 10,
        playtimeForever: 600,
        intention: 'continuer',
        temps: 45,
      }),
    ).toBeCloseTo(0.865, 5);
  });

  it('calcule le score « découvrir »', () => {
    expect(
      scoreMenu({
        similarite: 0.5,
        lastActivitySource: null,
        achievementsUnlocked: 0,
        achievementsTotal: 0,
        playtimeForever: 0,
        intention: 'decouvrir',
        temps: 45,
      }),
    ).toBeCloseTo(0.75, 5);
  });

  it('calcule le score « finir »', () => {
    expect(
      scoreMenu({
        similarite: 0,
        lastActivitySource: null,
        achievementsUnlocked: 9,
        achievementsTotal: 10,
        playtimeForever: 1200,
        intention: 'finir',
        temps: 45,
      }),
    ).toBeCloseTo(0.621, 5);
  });
});

describe('raisons', () => {
  it('explique une carte du deck', () => {
    const genre = { id: 9, label: 'Course automobile' };

    expect(
      raisonSelection({
        genre,
        matchGenre: true,
        genresCommuns: 2,
        nomAncre: 'Rocket League',
      }),
    ).toBe('Même genre · Course automobile');

    expect(
      raisonSelection({
        genre,
        matchGenre: false,
        genresCommuns: 1,
        nomAncre: 'Rocket League',
      }),
    ).toBe('Voisin de Rocket League · 1 genre en commun');

    expect(
      raisonSelection({
        genre,
        matchGenre: false,
        genresCommuns: 3,
        nomAncre: 'Rocket League',
      }),
    ).toBe('Voisin de Rocket League · 3 genres en commun');

    expect(
      raisonSelection({
        genre: null,
        matchGenre: false,
        genresCommuns: 0,
        nomAncre: 'Hades',
      }),
    ).toBe('Proche de Hades');
  });

  it('explique le résultat du menu', () => {
    const communs = {
      lastActivitySource: 'sync_delta' as const,
      achievementsUnlocked: 5,
      achievementsTotal: 10,
      playtimeForever: 600,
      genresCommuns: 2,
      nomAncre: 'Hades',
    };

    expect(raisonMenu({ ...communs, intention: 'continuer' })).toBe(
      'Joué depuis ta dernière sync · 5 succès restants',
    );
    expect(raisonMenu({ ...communs, intention: 'finir' })).toBe(
      '5 succès restants sur 10',
    );
    expect(
      raisonMenu({
        ...communs,
        intention: 'decouvrir',
        playtimeForever: 0,
      }),
    ).toBe('Jamais lancé · 2 genres en commun');
  });

  it('reste honnête quand la progression ou l’activité manque', () => {
    expect(
      raisonMenu({
        intention: 'continuer',
        lastActivitySource: null,
        achievementsUnlocked: null,
        achievementsTotal: null,
        playtimeForever: 0,
        genresCommuns: 0,
        nomAncre: 'Hades',
      }),
    ).toBe('Proche de Hades');

    expect(raisonAFinir(9, 10)).toBe('1 succès restant');
    expect(raisonAFinir(5, 10)).toBe('5 succès restants');
    expect(raisonAFinir(10, 10)).toBe('100 % de succès');
    expect(raisonAFinir(null, 10)).toBe('Progression inconnue');
  });

  it('libelle les catégories « À retrouver » sans date exacte', () => {
    expect(raisonRetrouver('sync_delta')).toBe('Joué récemment');
    expect(raisonRetrouver('recent_window')).toBe('Ces 14 derniers jours');
    expect(raisonRetrouver('achievement')).toBe('Dernier succès');
    expect(raisonRetrouver(null)).toBe('Activité récente');
  });
});

describe('signaux du menu', () => {
  const communs = {
    temps: 45 as const,
    manette: false,
    controllerSupport: 'partial' as const,
    lastActivitySource: 'recent_window' as const,
    achievementsUnlocked: 3,
    achievementsTotal: 10,
    playtimeForever: 600,
    genresCommuns: 1,
    similariteEmbedding: true,
    nomAncre: 'Rocket League',
  };

  it('décrit la continuité, la progression et la similarité', () => {
    const signaux = signauxMenu(communs);

    expect(signaux.continuite).toBe('Joué ces 14 derniers jours');
    expect(signaux.progression).toBe('3 succès sur 10');
    expect(signaux.decouverte).toBe('Déjà lancé');
    expect(signaux.similarite).toBe('Ambiance proche de Rocket League');
  });

  it('ne promet jamais une durée de session', () => {
    const signaux = signauxMenu(communs);

    expect(signaux.temps).toContain('45 min');
    expect(signaux.temps).toContain('pas une durée de partie');
  });

  it('distingue manette partielle, complète et non filtrée', () => {
    expect(signauxMenu(communs).manette).toBe('Manette non filtrée');
    expect(signauxMenu({ ...communs, manette: true }).manette).toBe(
      'Manette partielle',
    );
    expect(
      signauxMenu({
        ...communs,
        manette: true,
        controllerSupport: 'full',
      }).manette,
    ).toBe('Manette complète');
  });

  it('reste honnête sans progression ni embedding', () => {
    const signaux = signauxMenu({
      ...communs,
      achievementsUnlocked: null,
      achievementsTotal: null,
      similariteEmbedding: false,
      genresCommuns: 0,
    });

    expect(signaux.progression).toBe('Progression inconnue');
    expect(signaux.similarite).toBe('Aucun genre en commun avec Rocket League');
  });
});

describe('HomeService.getSelection', () => {
  const dto = {
    decouverte: 30,
    manette: false,
    lancement: 'tous' as const,
    progression: false,
  };

  it('renvoie 404 quand l’ancre n’est pas possédée', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new HomeService({ $client: { query } } as unknown as Db);

    await expect(
      service.getSelection(42, { ...dto, anchor: 999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renvoie une sélection vide sans ancre ni bibliothèque', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new HomeService({ $client: { query } } as unknown as Db);

    await expect(service.getSelection(42, dto)).resolves.toEqual({
      anchor: null,
      genre: null,
      decouverte: 30,
      manette: false,
      lancement: 'tous',
      progression: false,
      items: [],
    });
  });
});

describe('HomeService.getMenu', () => {
  const dto = {
    temps: 45 as const,
    intention: 'continuer' as const,
    manette: false,
  };

  it('renvoie 404 quand l’ancre n’est pas possédée', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new HomeService({ $client: { query } } as unknown as Db);

    await expect(
      service.getMenu(42, { ...dto, anchor: 999 }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('renvoie un menu vide sans bibliothèque', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const service = new HomeService({ $client: { query } } as unknown as Db);

    await expect(service.getMenu(42, dto)).resolves.toEqual({
      temps: 45,
      intention: 'continuer',
      manette: false,
      resultat: null,
      signals: null,
    });
  });
});

describe('HomeService.getHome', () => {
  it('renvoie une réponse vide pour une bibliothèque vide', async () => {
    const query = vi.fn().mockResolvedValue({ rows: [] });
    const db = { $client: { query } } as unknown as Db;
    const service = new HomeService(db);

    const reponse = await service.getHome(42);

    expect(reponse).toEqual({
      jeuDuMoment: null,
      selection: {
        anchor: null,
        genre: null,
        decouverte: 30,
        manette: false,
        lancement: 'tous',
        progression: false,
        items: [],
      },
      categories: { aFinir: [], aDecouvrir: [], aRetrouver: [] },
      menu: {
        temps: 45,
        intention: 'continuer',
        manette: false,
        resultat: null,
        signals: null,
      },
      ancresRecentes: [],
    });
    expect(query).toHaveBeenCalledTimes(1);
  });
});
