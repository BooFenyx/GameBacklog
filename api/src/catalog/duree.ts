/** Tranches de temps de jeu total (`library_entries.playtime_forever`). */
export type DureeJeu = '0-2' | '2-10' | '10-50' | '50plus';

export const DUREE_VALUES: DureeJeu[] = ['0-2', '2-10', '10-50', '50plus'];

export const DUREE_LABELS: Record<DureeJeu, string> = {
  '0-2': 'Moins de 2 h',
  '2-10': '2 à 10 h',
  '10-50': '10 à 50 h',
  '50plus': '50 h et +',
};

/**
 * Conditions SQL d'une tranche, en minutes. La borne basse de `0-2` inclut 0 :
 * un jeu jamais lancé entre donc dans cette tranche s'il n'est pas filtré par
 * l'état « jamais lancé ».
 */
export function conditionDuree(duree: DureeJeu): string {
  switch (duree) {
    case '0-2':
      return 'le.playtime_forever < 120';
    case '2-10':
      return 'le.playtime_forever >= 120 AND le.playtime_forever < 600';
    case '10-50':
      return 'le.playtime_forever >= 600 AND le.playtime_forever < 3000';
    case '50plus':
      return 'le.playtime_forever >= 3000';
  }
}
