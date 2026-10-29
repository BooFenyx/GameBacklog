import { Link } from 'react-router-dom'
import { formaterDuree } from '../../format'
import {
  LIBELLE_MANETTE,
  type FicheJeu,
} from '../../games'
import Etiquette from '../ui/Etiquette'

type Props = {
  jeu: FicheJeu
}

function anneeSortie(iso: string | null): number | null {
  if (!iso) return null
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? null : date.getFullYear()
}

/** En-tête immersif de la fiche : fond, titre, méta et actions. */
export default function EnteteJeu({ jeu }: Props) {
  const image =
    jeu.screenshots[0]?.pleine ??
    jeu.backgroundImageUrl ??
    jeu.headerImageUrl
  const annee = anneeSortie(jeu.releaseDate)
  const storeUrl = `https://store.steampowered.com/app/${jeu.appId}`

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
          {jeu.genres.slice(0, 3).map((genre) => (
            <Etiquette key={genre} variante="genre">
              {genre}
            </Etiquette>
          ))}
          {jeu.controllerSupport !== 'none' && (
            <Etiquette variante="manette">
              {LIBELLE_MANETTE[jeu.controllerSupport]}
            </Etiquette>
          )}
          {jeu.playtimeForever > 0 && (
            <Etiquette variante="genre">
              {formaterDuree(jeu.playtimeForever)} de jeu
            </Etiquette>
          )}
          {jeu.achievements.total > 0 && (
            <Etiquette variante="succes">
              {jeu.achievements.unlocked} / {jeu.achievements.total} succès
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
