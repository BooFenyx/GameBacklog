import { IconeGrille, IconeListe } from '../ui/Icones'
import type { VueBibliotheque } from './useVueBibliotheque'

type Props = {
  vue: VueBibliotheque
  onChanger: (vue: VueBibliotheque) => void
}

/** Bascule grille/liste de la barre de résultats. */
export default function BasculeVue({ vue, onChanger }: Props) {
  return (
    <div className="bascule-vue" role="group" aria-label="Mode d'affichage">
      <button
        type="button"
        aria-pressed={vue === 'grille'}
        aria-label="Afficher en grille"
        onClick={() => onChanger('grille')}
      >
        <IconeGrille />
      </button>
      <button
        type="button"
        aria-pressed={vue === 'liste'}
        aria-label="Afficher en liste"
        onClick={() => onChanger('liste')}
      >
        <IconeListe />
      </button>
    </div>
  )
}
