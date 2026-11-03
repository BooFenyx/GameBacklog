import {
  contientMotCle,
  genrePrincipal,
  normaliserTexte,
  type GenrePrincipalInput,
} from './genre-principal.js';

function jeu(
  genres: string[],
  genreIds: number[],
  shortDescription: string | null,
): GenrePrincipalInput {
  return { genres, genreIds, shortDescription };
}

describe('genrePrincipal', () => {
  it('déduit Course automobile pour Rocket League', () => {
    const resultat = genrePrincipal(
      jeu(
        ['Action', 'Indépendant', 'Course automobile', 'Sport'],
        [1, 2, 9, 18],
        'Football et voitures font bon ménage dans cette suite basée sur la physique.',
      ),
    );

    expect(resultat).toEqual({ id: 9, label: 'Course automobile' });
  });

  it('déduit Action pour Hades (rogue-like et dungeon crawler)', () => {
    const resultat = genrePrincipal(
      jeu(
        ['Action', 'Indépendant', 'RPG'],
        [1, 2, 3],
        'Défiez le dieu des morts dans ce rogue-like en mode dungeon crawler.',
      ),
    );

    expect(resultat).toEqual({ id: 1, label: 'Action' });
  });

  it('déduit Simulation pour Stardew Valley', () => {
    const resultat = genrePrincipal(
      jeu(
        ['Indépendant', 'RPG', 'Simulation'],
        [2, 3, 4],
        "You've inherited your grandfather's old farm plot.",
      ),
    );

    expect(resultat).toEqual({ id: 4, label: 'Simulation' });
  });

  it('retombe sur RPG pour Skyrim, sans indice de description', () => {
    const resultat = genrePrincipal(
      jeu(
        ['RPG'],
        [3],
        'Le nouveau chapitre très attendu de la saga Elder Scrolls.',
      ),
    );

    expect(resultat).toEqual({ id: 3, label: 'RPG' });
  });

  it('déduit Action pour Hollow Knight', () => {
    const resultat = genrePrincipal(
      jeu(
        ['Action', 'Aventure', 'Indépendant'],
        [1, 25, 2],
        'Une aventure épique et pleine d’action dans un royaume en ruine.',
      ),
    );

    expect(resultat).toEqual({ id: 1, label: 'Action' });
  });

  it('se replie sur un genre spécifique quand la description est absente', () => {
    const resultat = genrePrincipal(
      jeu(['Simulation', 'Action'], [4, 1], null),
    );

    expect(resultat).toEqual({ id: 4, label: 'Simulation' });
  });

  it('se replie sur le premier genre quand le genre déduit est absent', () => {
    // « voiture » évoque Course automobile, mais le jeu n'a pas ce genre.
    const resultat = genrePrincipal(
      jeu(['Action'], [1], 'Un jeu de voitures.'),
    );

    expect(resultat).toEqual({ id: 1, label: 'Action' });
  });

  it('retombe sur le premier id quand le libellé n’a pas d’id aligné', () => {
    const resultat = genrePrincipal(
      jeu(
        ['Action', 'Course automobile'],
        [1],
        'Un jeu de voitures et de course.',
      ),
    );

    expect(resultat).toEqual({ id: 1, label: 'Course automobile' });
  });

  it('ignore la casse et les accents', () => {
    const resultat = genrePrincipal(
      jeu(['Aventure'], [25], 'Une grande ÉNIGME à résoudre.'),
    );

    expect(resultat).toEqual({ id: 25, label: 'Aventure' });
  });

  it('renvoie null sans genre', () => {
    expect(genrePrincipal(jeu([], [], 'Un jeu de voitures.'))).toBeNull();
  });
});

describe('normaliserTexte et contientMotCle', () => {
  it('normalise accents et casse', () => {
    expect(normaliserTexte('ÉNIGME à Résoudre')).toBe('enigme a resoudre');
  });

  it('respecte les limites de mots', () => {
    expect(contientMotCle('discourse', 'course')).toBe(false);
    expect(contientMotCle('un jeu de course', 'course')).toBe(true);
  });

  it('accepte le pluriel simple', () => {
    expect(contientMotCle('des voitures', 'voiture')).toBe(true);
    expect(contientMotCle('plusieurs courses', 'course')).toBe(true);
  });

  it('accepte un mot suivi d’un suffixe séparé', () => {
    expect(contientMotCle('un rogue-like', 'rogue')).toBe(true);
  });
});
