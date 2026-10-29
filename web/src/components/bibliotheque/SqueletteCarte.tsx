type Props = {
  variante?: 'grille' | 'liste'
}

/** Squelette de chargement d'une carte ou d'une ligne de jeu. */
export default function SqueletteCarte({ variante = 'grille' }: Props) {
  return (
    <li
      className={
        variante === 'liste'
          ? 'squelette-carte squelette-carte--liste'
          : 'squelette-carte'
      }
      aria-hidden="true"
    >
      <div className="squelette-carte__media" />
      <div className="squelette-carte__corps">
        <div className="squelette-ligne squelette-ligne--titre" />
        <div className="squelette-ligne" />
        <div className="squelette-ligne squelette-ligne--courte" />
      </div>
    </li>
  )
}
