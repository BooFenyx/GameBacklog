/**
 * Modes de jeu dérivés des catégories Steam (`appdetails.categories`).
 *
 * Les ids sont ceux de la taxonomie Steam, pas les libellés : ils restent
 * stables même si Steam reformule une traduction. Un jeu peut avoir plusieurs
 * modes (Portal 2 est à la fois solo, multi, coop et local).
 */
export type ModeJeu = 'solo' | 'multi' | 'coop' | 'pvp' | 'local' | 'crossplay';

export const MODE_VALUES: ModeJeu[] = [
  'solo',
  'multi',
  'local',
  'coop',
  'pvp',
  'crossplay',
];

export const MODES: Record<
  ModeJeu,
  { label: string; labelLong: string; ids: number[] }
> = {
  solo: { label: 'Solo', labelLong: 'Solo', ids: [2] },
  multi: {
    label: 'Multi en ligne',
    labelLong: 'Multijoueur en ligne',
    ids: [1, 9, 27, 36, 37, 38, 39, 48, 49],
  },
  local: {
    label: 'Multi Local',
    labelLong: 'Multijoueur local',
    ids: [24, 37, 39, 48],
  },
  coop: { label: 'Coop', labelLong: 'Coopération', ids: [9, 38, 39, 48] },
  pvp: { label: 'PvP', labelLong: 'Joueur contre joueur', ids: [49, 36, 37] },
  crossplay: {
    label: 'CrossPlay',
    labelLong: 'Multijoueur multiplateforme',
    ids: [27],
  },
};

/** Union des ids Steam correspondant aux modes demandés (dédoublonnée). */
export function idsPourModes(modes: ModeJeu[] | undefined): number[] {
  if (!modes || modes.length === 0) return [];
  const ids = new Set<number>();
  for (const mode of modes) {
    for (const id of MODES[mode].ids) {
      ids.add(id);
    }
  }
  return [...ids];
}

/** Modes présents dans une liste d'ids de catégories Steam. */
export function modesDepuisCategories(categoryIds: number[]): ModeJeu[] {
  return MODE_VALUES.filter((mode) =>
    categoryIds.some((id) => MODES[mode].ids.includes(id)),
  );
}
