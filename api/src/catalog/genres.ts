import type { Db } from '../db/db.module.js';

/** Ligne minimale pour retrouver les libellés de genres d'un utilisateur. */
export interface LigneGenres {
  genreIds: number[] | null;
  genres: string[] | null;
}

/**
 * Table `id -> libellé` construite à partir des tableaux stockés.
 *
 * `genreIds` et `genres` sont alignés index par index (voir `mapTaxonomie`).
 * En cas de libellé vide, on retombe sur `Genre <id>` pour ne jamais afficher
 * une chaîne vide.
 */
export function libellesDepuisLignes(
  lignes: LigneGenres[],
): Map<number, string> {
  const libelles = new Map<number, string>();

  for (const ligne of lignes) {
    const ids = ligne.genreIds ?? [];
    const labels = ligne.genres ?? [];
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      if (id === undefined || libelles.has(id)) continue;
      const label = labels[index]?.trim();
      libelles.set(id, label && label.length > 0 ? label : `Genre ${id}`);
    }
  }

  return libelles;
}

/**
 * Libellés des genres demandés, lus dans la bibliothèque de l'utilisateur.
 * Une requête vide (aucun genre sélectionné) ne touche pas la base.
 */
export async function libellesGenresUtilisateur(
  db: Db,
  userId: number,
  ids: number[] | undefined,
): Promise<Map<number, string>> {
  if (!ids || ids.length === 0) return new Map();

  const result = await db.$client.query(
    `
      SELECT g.genre_ids AS "genreIds", g.genres
      FROM library_entries le
      JOIN games g ON g.id = le.game_id
      WHERE le.user_id = $1
        AND g.genre_ids && $2::int[]
    `,
    [userId, [...new Set(ids)]],
  );

  return libellesDepuisLignes(result.rows as LigneGenres[]);
}
