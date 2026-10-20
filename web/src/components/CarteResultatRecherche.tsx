import { Link } from 'react-router-dom'
import type { ResultatRecherche, SourceResultat } from '../search'

const LIBELLE_SOURCE: Record<SourceResultat, string> = {
  name: 'Nom',
  semantic: 'Similarité',
  series: 'Série',
}

const LIBELLE_MANETTE: Record<ResultatRecherche['controllerSupport'], string> =
  {
    none: 'manette non supportée',
    partial: 'manette partielle',
    full: 'manette complète',
  }

function formaterDuree(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} h`
  return `${h} h ${String(m).padStart(2, '0')}`
}

function formaterScore(score: number): string {
  return `${Math.round(score * 100)} %`
}

/** Carte d'un résultat de recherche, réutilisable dans l'aperçu et la page. */
export default function CarteResultatRecherche({
  resultat,
}: {
  resultat: ResultatRecherche
}) {
  return (
    <article
      className={
        resultat.headerImageUrl
          ? 'carte-resultat'
          : 'carte-resultat carte-resultat-sans-image'
      }
    >
      <Link
        className="carte-resultat-lien"
        to={`/jeu/${resultat.appId}`}
        aria-label={`Ouvrir la fiche de ${resultat.name}`}
      />

      {resultat.headerImageUrl && (
        <img
          className="carte-resultat-image"
          src={resultat.headerImageUrl}
          alt=""
          loading="lazy"
        />
      )}

      <div className="carte-resultat-corps">
        <div className="carte-resultat-tete">
          <h2 className="carte-resultat-nom">{resultat.name}</h2>
          {resultat.score !== null && (
            <span
              className="carte-resultat-score"
              title="Score de similarité cosinus"
            >
              {formaterScore(resultat.score)}
            </span>
          )}
        </div>

        {resultat.shortDescription && (
          <p className="carte-resultat-description">
            {resultat.shortDescription}
          </p>
        )}

        <p className="carte-resultat-meta">
          {resultat.playtimeForever > 0
            ? `${formaterDuree(resultat.playtimeForever)} de jeu`
            : 'Jamais lancé'}
          {resultat.genres.length > 0 && ` • ${resultat.genres.join(', ')}`}
          {resultat.controllerSupport !== 'none' &&
            ` • ${LIBELLE_MANETTE[resultat.controllerSupport]}`}
        </p>

        <div className="carte-resultat-pied">
          <span
            className={`carte-resultat-badge carte-resultat-badge-${resultat.source}`}
          >
            {LIBELLE_SOURCE[resultat.source]}
          </span>
          {resultat.criteria.length > 0 && (
            <ul className="carte-resultat-criteres">
              {resultat.criteria.map((critere) => (
                <li key={critere}>{critere}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </article>
  )
}
