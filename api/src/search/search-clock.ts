/**
 * Horloge injectable des services de recherche (limiteur de fréquence, cache
 * d'embeddings). Permet de tester les fenêtres glissantes et les TTL sans
 * attente réelle.
 */
export const SEARCH_CLOCK = Symbol('SEARCH_CLOCK');
