import { Link } from 'react-router-dom'
import { formaterScore, pourquoiMaintenant } from '../resultat'
import type { ResultatRecherche } from '../search'

/**
 * Carte de la grille « Aussi dans tes résultats » : pochette, titre, une phrase
 * qui dit pourquoi le jeu mérite une session, genres et score. Toute la carte
 * mène à la fiche.
 */
export default function CarteResultat({
  resultat,
}: {
  resultat: ResultatRecherche
}) {
  const pourquoi = pourquoiMaintenant(resultat)

  return (
    <article className="resultat-carte">
      <Link
        className="resultat-carte-lien"
        to={`/jeu/${resultat.appId}`}
        aria-label={`Ouvrir la fiche de ${resultat.name}`}
      />

      {resultat.headerImageUrl && (
        <img
          className="resultat-carte-image"
          src={resultat.headerImageUrl}
          alt=""
          loading="lazy"
        />
      )}

      <div className="resultat-carte-corps">
        <h3 className="resultat-carte-nom">{resultat.name}</h3>
        <p
          className={
            pourquoi.jamais ? 'resultat-pourquoi jamais' : 'resultat-pourquoi'
          }
        >
          {pourquoi.texte}
        </p>

        <p className="resultat-carte-meta">
          <span className="resultat-carte-genres">
            {resultat.genres.slice(0, 2).join(' · ')}
          </span>
          {resultat.score !== null && (
            <span
              className="resultat-carte-score"
              title="Score de similarité cosinus"
            >
              {formaterScore(resultat.score)}
            </span>
          )}
        </p>
      </div>
    </article>
  )
}
