import { DUREE_LABELS, DUREE_VALUES, type DureeJeu } from './duree.js';
import { libellesDepuisLignes } from './genres.js';
import {
  MODES,
  MODE_VALUES,
  modesDepuisCategories,
  type ModeJeu,
} from './modes.js';

/** Données minimales lues pour calculer les facettes d'une bibliothèque. */
export interface FacetRow {
  genreIds: number[] | null;
  genres: string[] | null;
  categoryIds: number[] | null;
  controllerSupport: 'none' | 'partial' | 'full';
  playtimeForever: number;
  lastActivityAt: Date | null;
}

export interface FacetteGenre {
  id: number;
  label: string;
  count: number;
}

export interface FacetteValeur<T extends string> {
  value: T;
  label: string;
  count: number;
}

export interface FacettesBibliotheque {
  total: number;
  genres: FacetteGenre[];
  modes: FacetteValeur<ModeJeu>[];
  manettes: FacetteValeur<'full'>[];
  etats: FacetteValeur<'jamais' | 'joue'>[];
  durees: FacetteValeur<DureeJeu>[];
  /** Faux quand aucune entrée n'a d'activité dérivée : le tri « récent » est masqué. */
  lastActivityDisponible: boolean;
}

/** Tranche de durée d'un temps de jeu total, en minutes. */
function trancheDuree(minutes: number): DureeJeu {
  if (minutes < 120) return '0-2';
  if (minutes < 600) return '2-10';
  if (minutes < 3000) return '10-50';
  return '50plus';
}

/**
 * Calcule les compteurs de filtres à partir des lignes de la bibliothèque.
 *
 * Fonction pure : appelée une fois par requête `GET /api/library/facets`, avec
 * l'ensemble des jeux de l'utilisateur (pas de requête par facette).
 */
export function agregerFacettes(rows: FacetRow[]): FacettesBibliotheque {
  const total = rows.length;

  const compteGenres = new Map<number, number>();
  const compteModes = new Map<ModeJeu, number>();
  let manetteComplete = 0;
  let jamaisLance = 0;
  let joue = 0;
  const compteDurees = new Map<DureeJeu, number>();

  for (const row of rows) {
    const genreIds = row.genreIds ?? [];
    for (const id of new Set(genreIds)) {
      compteGenres.set(id, (compteGenres.get(id) ?? 0) + 1);
    }

    for (const mode of modesDepuisCategories(row.categoryIds ?? [])) {
      compteModes.set(mode, (compteModes.get(mode) ?? 0) + 1);
    }

    if (row.controllerSupport === 'full') manetteComplete += 1;

    if (row.playtimeForever === 0) jamaisLance += 1;
    if (row.playtimeForever > 0) joue += 1;

    const tranche = trancheDuree(row.playtimeForever);
    compteDurees.set(tranche, (compteDurees.get(tranche) ?? 0) + 1);
  }

  const lastActivityDisponible = rows.some(
    (row) => row.lastActivityAt !== null,
  );

  const libelles = libellesDepuisLignes(rows);
  const genres = [...compteGenres.entries()]
    .map(([id, count]) => ({
      id,
      label: libelles.get(id) ?? `Genre ${id}`,
      count,
    }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'fr'));

  return {
    total,
    genres,
    modes: MODE_VALUES.filter((mode) => (compteModes.get(mode) ?? 0) > 0).map(
      (mode) => ({
        value: mode,
        label: MODES[mode].label,
        count: compteModes.get(mode) ?? 0,
      }),
    ),
    manettes: [
      { value: 'full', label: 'Manette complète', count: manetteComplete },
    ],
    etats: [
      { value: 'jamais', label: 'Jamais lancé', count: jamaisLance },
      { value: 'joue', label: 'Joué', count: joue },
    ],
    durees: DUREE_VALUES.map((duree) => ({
      value: duree,
      label: DUREE_LABELS[duree],
      count: compteDurees.get(duree) ?? 0,
    })),
    lastActivityDisponible,
  };
}
