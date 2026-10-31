/** Formatage partagé des durées et des dates (bibliothèque, recherche, fiche). */

const DATE_SEULE = /^\d{4}-\d{2}-\d{2}$/

/** Minutes → « 12 h », « 1 h 05 », « 42 min ». */
export function formaterDuree(minutes: number): string {
  const heures = Math.floor(minutes / 60)
  const reste = minutes % 60
  if (heures === 0) return `${reste} min`
  if (reste === 0) return `${heures} h`
  return `${heures} h ${String(reste).padStart(2, '0')}`
}

/**
 * Date ISO → date courte française, ou `null` si illisible.
 * Une date seule `YYYY-MM-DD` est lue en UTC : pas de décalage de fuseau.
 */
export function formaterDate(valeur: string | null): string | null {
  if (!valeur) return null

  if (DATE_SEULE.test(valeur)) {
    const [annee, mois, jour] = valeur.split('-').map(Number)
    return new Date(Date.UTC(annee, mois - 1, jour)).toLocaleDateString(
      'fr-FR',
      { timeZone: 'UTC' },
    )
  }

  const date = new Date(valeur)
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleDateString('fr-FR')
}

/** Année d'une date seule ou ISO, sans décalage de fuseau. */
export function formaterAnnee(valeur: string | null): number | null {
  if (!valeur) return null
  if (DATE_SEULE.test(valeur)) return Number(valeur.slice(0, 4))
  const date = new Date(valeur)
  return Number.isNaN(date.getTime()) ? null : date.getFullYear()
}
