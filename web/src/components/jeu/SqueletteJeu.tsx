/** Squelette de chargement de la fiche de jeu. */
export default function SqueletteJeu() {
  return (
    <div className="fiche fiche--squelette" aria-hidden="true">
      <div className="fiche-hero fiche-hero--squelette" />
      <div className="fiche-layout">
        <div className="fiche-principale">
          <div className="squelette-bloc">
            <div className="squelette-ligne squelette-ligne--titre" />
            <div className="squelette-ligne" />
            <div className="squelette-ligne" />
            <div className="squelette-ligne squelette-ligne--courte" />
          </div>
          <div className="squelette-bloc">
            <div className="squelette-ligne squelette-ligne--titre" />
            <div className="squelette-ligne" />
            <div className="squelette-ligne squelette-ligne--courte" />
          </div>
        </div>
        <aside className="fiche-laterale">
          <div className="squelette-bloc">
            <div className="squelette-ligne squelette-ligne--titre" />
            <div className="squelette-ligne" />
            <div className="squelette-ligne" />
            <div className="squelette-ligne squelette-ligne--courte" />
          </div>
          <div className="squelette-bloc">
            <div className="squelette-ligne squelette-ligne--titre" />
            <div className="squelette-ligne" />
            <div className="squelette-ligne squelette-ligne--courte" />
          </div>
        </aside>
      </div>
    </div>
  )
}
