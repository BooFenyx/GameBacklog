/** Formatage partagé des durées et des dates (bibliothèque, recherche, fiche). */

/** Minutes → « 12 h », « 1 h 05 », « 42 min ». */
export function formaterDuree(minutes: number): string {
  const heures = Math.floor(minutes / 60)
  const reste = minutes % 60
  if (heures === 0) return `${reste} min`
  if (reste === 0) return `${heures} h`
  return `${heures} h ${String(reste).padStart(2, '0')}`
}

/** Date ISO → date courte française, ou `null` si illisible. */
export function formaterDate(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('fr-FR')
}

/**
 * Date ISO → « aujourd'hui », « hier », « il y a 3 j »… Pour une dernière
 * partie, c'est plus lisible qu'une date brute sur une carte.
 */
export function formaterDepuis(iso: string | null): string | null {
  if (!iso) return null
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return null

  const jours = Math.floor((Date.now() - date.getTime()) / 86_400_000)
  if (jours <= 0) return "aujourd'hui"
  if (jours === 1) return 'hier'
  if (jours < 30) return `il y a ${jours} j`
  if (jours < 365) return `il y a ${Math.floor(jours / 30)} mois`
  const annees = Math.floor(jours / 365)
  return `il y a ${annees} an${annees > 1 ? 's' : ''}`
}
