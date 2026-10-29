import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formaterScore, urlHeros } from '../resultat'
import type { ResultatRecherche } from '../search'

/**
 * Résultat mis en avant : l'artwork occupe la carte, le titre est posé dessus
 * et un bouton de lancement direct donne envie de jouer. Le visuel vient de
 * `library_hero` (1920 px) ; on retombe sur la pochette 460×215, puis sur rien,
 * si le CDN ne la fournit pas.
 */
export default function VedetteResultat({
  resultat,
}: {
  resultat: ResultatRecherche
}) {
  const heros = urlHeros(resultat.appId)
  const [source, setSource] = useState<string | null>(
    resultat.headerImageUrl ? heros : null,
  )

  const surErreurImage = () => {
    setSource((actuelle) =>
      actuelle === heros && resultat.headerImageUrl
        ? resultat.headerImageUrl
        : null,
    )
  }

  return (
    <article className="resultat-vedette">
      {source && (
        <img
          className="resultat-vedette-fond"
          src={source}
          alt=""
          onError={surErreurImage}
        />
      )}

      {resultat.score !== null && (
        <span
          className="resultat-vedette-score"
          title="Score de similarité cosinus"
        >
          {formaterScore(resultat.score)}
        </span>
      )}

      <div className="resultat-vedette-corps">
        <p className="resultat-etiquette">Le meilleur choix pour toi</p>
        <h2 className="resultat-vedette-nom">{resultat.name}</h2>

        {resultat.shortDescription && (
          <p className="resultat-vedette-pitch">{resultat.shortDescription}</p>
        )}

        <div className="resultat-vedette-actions">
          <a className="resultat-lancer" href={`steam://run/${resultat.appId}`}>
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M8 5v14l11-7z" />
            </svg>
            Lancer le jeu
          </a>
          <Link className="resultat-fiche" to={`/jeu/${resultat.appId}`}>
            Voir la fiche
          </Link>
        </div>
      </div>
    </article>
  )
}
