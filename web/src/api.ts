/**
 * Base des appels à l'API.
 *
 * En développement, `VITE_API_URL` est absente : les chemins restent relatifs
 * et le proxy Vite (`/api` → `:3000`) prend le relais, avec une seule origine.
 * En production, le front (Vercel) et l'API (Render) sont sur deux origines
 * distinctes : `VITE_API_URL` contient alors l'URL de l'API, injectée à la
 * construction par la variable d'environnement du projet Vercel.
 */
const base = import.meta.env.VITE_API_URL ?? ''

/** Préfixe un chemin d'API (`/api/...`) par l'URL de base. */
export function urlApi(path: string): string {
  return `${base}${path}`
}
