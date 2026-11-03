import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  imagePortrait,
  libelleManette,
  metaJeu,
  metaSucces,
  raisonJeu,
  type HomeGame,
} from '../../home'
import Etiquette from '../ui/Etiquette'
import { IconeManette } from '../ui/Icones'

type Props = {
  jeu: HomeGame
  nomAncre: string
  /** Position relative à la carte de devant : 0 = devant. */
  position: number
}

function initiales(nom: string): string {
  const mots = nom
    .split(/\s+/)
    .map((mot) => mot.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter((mot) => mot.length > 0)
  if (mots.length === 0) return nom.slice(0, 1).toUpperCase()
  if (mots.length === 1) return mots[0].slice(0, 2).toUpperCase()
  return `${mots[0][0]}${mots[1][0]}`.toUpperCase()
}

/** Image portrait Steam, repli `headerImageUrl`, puis initiales + dégradé. */
function ImagePortrait({ jeu }: { jeu: HomeGame }) {
  const sources = [imagePortrait(jeu.appId), jeu.headerImageUrl].filter(
    (source): source is string => typeof source === 'string' && source.length > 0,
  )
  const [index, setIndex] = useState(0)

  if (index >= sources.length) {
    return (
      <span className="accueil-deck-repli" aria-hidden="true">
        {initiales(jeu.name)}
      </span>
    )
  }

  return (
    <img
      className="accueil-deck-photo"
      src={sources[index]}
      alt=""
      loading="eager"
      decoding="async"
      onError={() => setIndex((valeur) => valeur + 1)}
    />
  )
}

/** Une carte portrait du deck, avec sa raison, sa méta et ses actions. */
export default function CarteSelection({ jeu, nomAncre, position }: Props) {
  const succes = metaSucces(jeu)
  const devant = position === 0

  return (
    <article
      className="accueil-deck-carte"
      data-position={position}
      aria-hidden={!devant}
      inert={!devant}
    >
      <div className="accueil-deck-image">
        <ImagePortrait jeu={jeu} />
      </div>
      <div className="accueil-deck-voile" aria-hidden="true" />

      {jeu.controllerSupport !== 'none' && (
        <span
          className={`accueil-deck-manette accueil-deck-manette--${jeu.controllerSupport}`}
          role="img"
          title={libelleManette(jeu.controllerSupport)}
          aria-label={libelleManette(jeu.controllerSupport)}
        >
          <IconeManette />
          {jeu.controllerSupport === 'partial' && <span>partielle</span>}
        </span>
      )}

      <div className="accueil-deck-contenu">
        <p className="accueil-deck-genres">{jeu.genres.join(' · ')}</p>
        <h3 className="accueil-deck-titre">{jeu.name}</h3>
        <p className="accueil-deck-raison">
          <span className="accueil-deck-puce" aria-hidden="true" />
          {raisonJeu(jeu, nomAncre)}
        </p>
        <p className="accueil-deck-meta">{metaJeu(jeu)}</p>

        <div className="accueil-carte-badges">
          {succes && <Etiquette variante="succes">{succes}</Etiquette>}
        </div>

        <div className="accueil-deck-actions">
          <a
            className="btn btn-principal"
            href={`steam://run/${jeu.appId}`}
            data-lancer={jeu.name}
          >
            Lancer
          </a>
          <Link className="btn" to={`/jeu/${jeu.appId}`}>
            Voir la fiche
          </Link>
        </div>
      </div>
    </article>
  )
}
