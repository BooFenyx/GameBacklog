import { Link } from 'react-router-dom'
import { formaterAnnee, formaterDuree } from '../../format'
import {
  LIBELLE_MANETTE,
  type FicheJeu,
  type SuccesDetail,
} from '../../games'
import Etiquette from '../ui/Etiquette'
import { IconeCouronne } from '../ui/Icones'

type Props = {
  jeu: FicheJeu
  succes?: SuccesDetail
}

/** En-tête immersif de la fiche : fond, titre, méta et actions. */
export default function EnteteJeu({ jeu, succes }: Props) {
  const image =
    jeu.screenshots[0]?.pleine ??
    jeu.backgroundImageUrl ??
    jeu.headerImageUrl
  const annee = formaterAnnee(jeu.releaseDate)
  const storeUrl = `https://store.steampowered.com/app/${jeu.appId}`
  const totalSucces = succes?.total ?? jeu.achievementsTotal
  // `succes.unlocked === null` signifie « progression indisponible » : on ne
  // retombe pas sur un compteur de bibliothèque potentiellement obsolète.
  const debloquesSucces = succes ? succes.unlocked : jeu.achievementsUnlocked
  const complet =
    totalSucces !== null &&
    totalSucces > 0 &&
    debloquesSucces === totalSucces

  return (
    <header
      className="fiche-hero"
      style={
        image
          ? { backgroundImage: `url("${image}")` }
          : undefined
      }
    >
      <div className="fiche-hero-contenu">
        <Link className="retour" to="/bibliotheque">
          ← Bibliothèque
        </Link>

        <h1>{jeu.name}</h1>

        <div className="fiche-hero-meta">
          {annee && <Etiquette variante="genre">{annee}</Etiquette>}
          {jeu.playtimeForever === 0 && (
            <Etiquette variante="genre">Jamais lancé</Etiquette>
          )}
          {jeu.genres.slice(0, 3).map((genre) => (
            <Etiquette key={genre} variante="genre">
              {genre}
            </Etiquette>
          ))}
          {jeu.detailsAvailable && jeu.controllerSupport !== 'none' && (
            <Etiquette variante="manette">
              {LIBELLE_MANETTE[jeu.controllerSupport]}
            </Etiquette>
          )}
          {jeu.playtimeForever > 0 && (
            <Etiquette variante="genre">
              {formaterDuree(jeu.playtimeForever)} de jeu
            </Etiquette>
          )}
          {totalSucces !== null && totalSucces > 0 && (
            <Etiquette variante={complet ? 'succes-complet' : 'succes'}>
              {complet && <IconeCouronne />}
              {debloquesSucces ?? '—'} / {totalSucces} succès
            </Etiquette>
          )}
        </div>

        <div className="fiche-hero-actions">
          <a className="btn btn-principal" href={jeu.steamUrl}>
            Lancer sur Steam
          </a>
          <a
            className="btn"
            href={storeUrl}
            target="_blank"
            rel="noreferrer"
            aria-label={`Voir ${jeu.name} sur Steam`}
          >
            Voir sur Steam
          </a>
        </div>
      </div>
    </header>
  )
}
