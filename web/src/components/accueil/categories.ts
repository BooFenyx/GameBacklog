/** Nombre de cartes visibles par page dans une catégorie. */
export const TAILLE_PAGE_CATEGORIES = 3

/** Nombre de pages nécessaires, au moins 1. */
export function pagesCategorie(nombre: number): number {
  return Math.max(1, Math.ceil(Math.max(0, nombre) / TAILLE_PAGE_CATEGORIES))
}

/** Page courante à partir d'un tour global, avec repli circulaire. */
export function pageCategorie(tour: number, pages: number): number {
  if (pages <= 1) return 0
  return ((tour % pages) + pages) % pages
}

/** Fenêtre de cartes d'une page, sans doublon ni débordement. */
export function fenetreCategorie<T>(items: T[], page: number): T[] {
  const pages = pagesCategorie(items.length)
  const courante = pageCategorie(page, pages)
  return items.slice(
    courante * TAILLE_PAGE_CATEGORIES,
    (courante + 1) * TAILLE_PAGE_CATEGORIES,
  )
}
