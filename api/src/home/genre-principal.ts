import type { HomeGenre } from './home.types.js';

/** Données minimales d'un jeu pour déduire son genre principal. */
export interface GenrePrincipalInput {
  shortDescription: string | null;
  genres: string[] | null;
  /** Alignés index par index sur `genres` (voir `mapTaxonomie`). */
  genreIds: number[] | null;
}

interface RegleGenre {
  label: string;
  motsCles: string[];
}

/**
 * Règles éditoriales, appliquées **dans l'ordre**. Chaque mot-clé est comparé
 * sur la description normalisée, et la règle n'est retenue que si son genre est
 * réellement présent dans `games.genres` : on n'invente jamais un genre Steam.
 *
 * `Action` passe avant `RPG` : Hades porte les deux genres et sa description
 * contient à la fois « rogue-like » (Action) et « dungeon crawler » (RPG).
 * Le cas de test verrouillé attend Action. Cyberpunk 2077, qui ne possède pas
 * le genre Action, est donc bien classé RPG par la règle suivante.
 */
const REGLES: RegleGenre[] = [
  {
    label: 'Course automobile',
    motsCles: [
      'course',
      'voiture',
      'drift',
      'parking',
      'kart',
      'rallye',
      'racing',
    ],
  },
  {
    label: 'Sport',
    motsCles: ['sport', 'football', 'soccer', 'golf', 'basket', 'tennis'],
  },
  {
    label: 'Simulation',
    motsCles: [
      'simulation',
      'gestion',
      'farm',
      'ferme',
      'ville',
      'construction',
    ],
  },
  {
    label: 'Stratégie',
    motsCles: ['strategie', 'tactique', 'strategy'],
  },
  {
    label: 'Action',
    motsCles: [
      'action',
      'combat',
      'rogue',
      'hack',
      'slash',
      'plateforme',
      'platform',
    ],
  },
  {
    label: 'RPG',
    motsCles: ['rpg', 'jdr', 'role', 'donjon', 'dungeon'],
  },
  {
    label: 'Aventure',
    motsCles: ['aventure', 'adventure', 'exploration', 'enigme', 'puzzle'],
  },
];

/**
 * Genres « spécifiques » utilisés en repli quand la description n'apporte aucun
 * indice : ils priment sur un genre large comme Action ou Aventure.
 */
const GENRES_SPECIFIQUES = [
  'Course automobile',
  'Sport',
  'Simulation',
  'Stratégie',
  'RPG',
];

/** Minuscules et suppression des accents, pour comparer libellés et mots-clés. */
export function normaliserTexte(texte: string): string {
  return texte
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Vrai si `mot` apparaît comme mot entier (pluriel simple accepté), pour éviter
 * les faux positifs comme « course » dans « discourse ».
 */
export function contientMotCle(texteNormalise: string, mot: string): boolean {
  const motif = new RegExp(`\\b${mot}(?:s|es)?\\b`);
  return motif.test(texteNormalise);
}

function indexGenre(genres: string[], label: string): number {
  const cible = normaliserTexte(label);
  return genres.findIndex((genre) => normaliserTexte(genre) === cible);
}

/**
 * Associe un libellé à son id Steam. `genres` et `genreIds` sont alignés ; si
 * l'id du libellé manque, on retombe sur le premier id disponible.
 */
function versGenre(
  label: string,
  index: number,
  genreIds: number[] | null,
): HomeGenre | null {
  const ids = genreIds ?? [];
  const id = ids[index] ?? ids[0];
  return id === undefined ? null : { id, label };
}

function repli(genres: string[], genreIds: number[] | null): HomeGenre | null {
  for (const label of GENRES_SPECIFIQUES) {
    const index = indexGenre(genres, label);
    if (index >= 0) {
      const genre = versGenre(label, index, genreIds);
      if (genre) return genre;
    }
  }

  const premier = genres[0];
  return premier === undefined ? null : versGenre(premier, 0, genreIds);
}

/**
 * Genre principal d'un jeu, déduit du `short_description` et des genres Steam.
 * Fonction pure, sans appel réseau : elle n'utilise que les données importées.
 */
export function genrePrincipal(jeu: GenrePrincipalInput): HomeGenre | null {
  const genres = jeu.genres ?? [];
  if (genres.length === 0) return null;

  const description = jeu.shortDescription
    ? normaliserTexte(jeu.shortDescription)
    : '';

  if (description.length > 0) {
    for (const regle of REGLES) {
      const index = indexGenre(genres, regle.label);
      if (index < 0) continue;
      if (!regle.motsCles.some((mot) => contientMotCle(description, mot))) {
        continue;
      }
      const genre = versGenre(regle.label, index, jeu.genreIds);
      if (genre) return genre;
    }
  }

  return repli(genres, jeu.genreIds);
}
