import { Link } from 'react-router-dom'
import type { JeuBibliotheque } from '../../library'
import Etiquette from '../ui/Etiquette'
import ImageJeu from './ImageJeu'
import {
  GENRES_VISIBLES,
  contexteCarte,
  etatJeu,
  libelleMode,
  metaJeu,
  succesAffiche,
} from './affichage'

type Props = {
  jeu: JeuBibliotheque
}

/** Ligne compacte d'un jeu dans la vue liste. */
export default function LigneJeu({ jeu }: Props) {
  const etat = etatJeu(jeu)
  const meta = metaJeu(jeu)
  const succes = succesAffiche(jeu)
  const genres = jeu.genres.slice(0, GENRES_VISIBLES)
  const genresRestants = jeu.genres.length - genres.length

  return (
    <li className="ligne-jeu">
      <Link
        to={`/jeu/${jeu.appId}`}
        className="ligne-jeu__lien"
        aria-label={`Ouvrir la fiche de ${jeu.name} — ${contexteCarte(jeu, etat)}`}
      />

      <div className="ligne-jeu__media">
        <ImageJeu src={jeu.headerImageUrl} nom={jeu.name} />
      </div>

      <div className="ligne-jeu__principal">
        <div className="ligne-jeu__titre">
          <span>{jeu.name}</span>
          <Etiquette variante={etat.recent ? 'etat-recent' : 'etat'}>
            {etat.label}
          </Etiquette>
        </div>
      </div>

      <div className="ligne-jeu__genres">
        {genres.map((genre) => (
          <Etiquette key={genre} variante="genre">
            {genre}
          </Etiquette>
        ))}
        {genresRestants > 0 && (
          <Etiquette
            variante="genre"
            className="etiquette--plus"
            title={jeu.genres.slice(GENRES_VISIBLES).join(', ')}
          >
            +{genresRestants}
          </Etiquette>
        )}
      </div>

      <div className="ligne-jeu__modes">
        {jeu.modes.map((mode) => (
          <Etiquette key={mode} variante={mode === 'solo' ? 'solo' : 'mode'}>
            {libelleMode(mode)}
          </Etiquette>
        ))}
      </div>

      <div className="ligne-jeu__meta">
        <div className="ligne-jeu__temps">
          <strong>{meta.temps ?? '—'}</strong>
          <span>{meta.temps ? 'de jeu' : 'jamais'}</span>
        </div>
        <div className="ligne-jeu__dernier">
          {meta.dernier ?? 'jamais lancé'}
        </div>
        {(jeu.controllerSupport === 'full' || succes !== null) && (
          <div className="ligne-jeu__fin">
            {jeu.controllerSupport === 'full' && (
              <Etiquette variante="manette">Manette</Etiquette>
            )}
            {succes !== null && (
              <Etiquette variante="succes">{succes}</Etiquette>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
