/**
 * Base des appels à l'API.
 *
 * `VITE_API_URL` n'est pas définie : les chemins restent relatifs. En
 * développement le proxy Vite (`/api` → `:3000`) prend le relais, et en
 * production le rewrite Vercel (`/api` → Render, voir `web/vercel.json`) garde
 * le navigateur sur une seule origine, ce qui préserve le cookie de session.
 */
const base = import.meta.env.VITE_API_URL ?? ''

/** Préfixe un chemin d'API (`/api/...`) par l'URL de base. */
export function urlApi(path: string): string {
  return `${base}${path}`
}
