import { conditionDuree, DUREE_LABELS, type DureeJeu } from './duree.js';
import { idsPourModes, MODES, type ModeJeu } from './modes.js';

/** Sous-ensemble de filtres communs à la bibliothèque et à la recherche. */
export interface FiltersInput {
  genres?: number[];
  modes?: ModeJeu[];
  manette?: 'full';
  etat?: 'jamais' | 'joue';
  duree?: DureeJeu[];
}

function dedoublonner<T>(valeurs: T[] | undefined): T[] {
  return valeurs ? [...new Set(valeurs)] : [];
}

/**
 * Construit les conditions SQL des filtres et pousse les valeurs dans `params`.
 *
 * Les valeurs utilisateur passent toujours par des paramètres `$n` ; seules
 * les valeurs issues d'énumérations contrôlées (manette, état, tri) sont
 * écrites en littéral SQL.
 */
export function construireConditions(
  filtres: FiltersInput,
  params: unknown[],
): string[] {
  const conditions: string[] = [];

  const genres = dedoublonner(filtres.genres);
  if (genres.length > 0) {
    params.push(genres);
    conditions.push(`g.genre_ids && $${params.length}::int[]`);
  }

  const idsModes = idsPourModes(dedoublonner(filtres.modes));
  if (idsModes.length > 0) {
    params.push(idsModes);
    conditions.push(`g.category_ids && $${params.length}::int[]`);
  }

  if (filtres.manette === 'full') {
    conditions.push("g.controller_support = 'full'");
  }

  if (filtres.etat === 'jamais') {
    conditions.push('le.playtime_forever = 0');
  } else if (filtres.etat === 'joue') {
    conditions.push('le.playtime_forever > 0');
  }

  const durees = dedoublonner(filtres.duree);
  if (durees.length > 0) {
    const tranches = durees.map((duree) => conditionDuree(duree));
    conditions.push(`(${tranches.join(' OR ')})`);
  }

  return conditions;
}

/**
 * Libellés français des filtres actifs, affichés sur les résultats de
 * recherche. `libellesGenres` vient de la bibliothèque de l'utilisateur.
 */
export function construireCriteres(
  filtres: FiltersInput,
  libellesGenres: Map<number, string> = new Map(),
): string[] {
  const criteres: string[] = [];

  if (filtres.manette === 'full') {
    criteres.push('Manette complète');
  }

  for (const mode of dedoublonner(filtres.modes)) {
    criteres.push(MODES[mode].labelLong);
  }

  for (const id of dedoublonner(filtres.genres)) {
    const libelle = libellesGenres.get(id);
    criteres.push(libelle ? `Genre : ${libelle}` : 'Genre sélectionné');
  }

  if (filtres.etat === 'jamais') {
    criteres.push('Jamais lancé');
  } else if (filtres.etat === 'joue') {
    criteres.push('Déjà joué');
  }

  for (const duree of dedoublonner(filtres.duree)) {
    criteres.push(DUREE_LABELS[duree]);
  }

  return [...new Set(criteres)];
}
