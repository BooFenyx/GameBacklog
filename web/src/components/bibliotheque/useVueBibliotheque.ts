import { useCallback, useState } from 'react'

export type VueBibliotheque = 'grille' | 'liste'

export const CLE_VUE_BIBLIOTHEQUE = 'gamebacklog:biblio:vue'

/** Sous-ensemble de `Storage` suffisant pour tester sans DOM. */
export type StockageVue = {
  getItem(cle: string): string | null
  setItem(cle: string, valeur: string): void
}

function stockageParDefaut(): StockageVue | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Lit la préférence de vue ; retombe sur la grille si elle est absente. */
export function lireVue(stockage?: StockageVue | null): VueBibliotheque {
  try {
    const cible = stockage ?? stockageParDefaut()
    return cible?.getItem(CLE_VUE_BIBLIOTHEQUE) === 'liste'
      ? 'liste'
      : 'grille'
  } catch {
    return 'grille'
  }
}

/** Écrit la préférence de vue, sans jamais faire échouer la page. */
export function ecrireVue(
  vue: VueBibliotheque,
  stockage?: StockageVue | null,
): void {
  try {
    const cible = stockage ?? stockageParDefaut()
    cible?.setItem(CLE_VUE_BIBLIOTHEQUE, vue)
  } catch {
    // Stockage indisponible (navigation privée, quota) : on ignore.
  }
}

/** Préférence grille/liste, mémorisée dans `localStorage`. */
export function useVueBibliotheque(): [
  VueBibliotheque,
  (vue: VueBibliotheque) => void,
] {
  const [vue, setVue] = useState<VueBibliotheque>(() => lireVue())

  const changerVue = useCallback((suivante: VueBibliotheque) => {
    setVue(suivante)
    ecrireVue(suivante)
  }, [])

  return [vue, changerVue]
}
