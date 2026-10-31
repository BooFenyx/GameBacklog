import { Link } from 'react-router-dom'
import type { JeuBibliotheque } from '../../library'
import Etiquette from '../ui/Etiquette'
import { IconeCouronne } from '../ui/Icones'
import ImageJeu from './ImageJeu'
import {
  GENRES_VISIBLES,
  contexteCarte,
  etatJeu,
  libelleMode,
  metaJeu,
  succesAffiche,
  succesComplet,
} from './affichage'

type Props = {
  jeu: JeuBibliotheque
}

/** Carte d'un jeu dans la vue grille. */
export default function CarteJeu({ jeu }: Props) {
  const etat = etatJeu(jeu)
  const meta = metaJeu(jeu)
  const succes = succesAffiche(jeu)
  const complet = succesComplet(jeu)
  const genres = jeu.genres.slice(0, GENRES_VISIBLES)
  const genresRestants = jeu.genres.length - genres.length

  return (
    <li className="carte-jeu">
      <Link
        to={`/jeu/${jeu.appId}`}
        className="carte-jeu__lien"
        aria-label={`Ouvrir la fiche de ${jeu.name} — ${contexteCarte(jeu, etat)}`}
      />

      <div className="carte-jeu__media">
        <ImageJeu src={jeu.headerImageUrl} nom={jeu.name} />
      </div>

      <div className="carte-jeu__corps">
        <h2 className="carte-jeu__titre">{jeu.name}</h2>

        <p className="carte-jeu__meta">
          {meta.temps ? (
            <span>
              <strong>{meta.temps}</strong> de jeu
            </span>
          ) : (
            <span className="jamais">Jamais lancé</span>
          )}
          {meta.activite && (
            <span className="dernier" title={meta.activiteTitre ?? undefined}>
              {meta.activite}
            </span>
          )}
        </p>

        {genres.length > 0 && (
          <div className="carte-jeu__chips">
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
        )}

        {(jeu.modes.length > 0 ||
          jeu.controllerSupport === 'full' ||
          succes !== null) && (
          <div className="carte-jeu__badges">
            {jeu.modes.map((mode) => (
              <Etiquette
                key={mode}
                variante={mode === 'solo' ? 'solo' : 'mode'}
              >
                {libelleMode(mode)}
              </Etiquette>
            ))}
            {jeu.controllerSupport === 'full' && (
              <Etiquette variante="manette">Manette</Etiquette>
            )}
            {succes !== null && (
              <Etiquette variante={complet ? 'succes-complet' : 'succes'}>
                {complet && <IconeCouronne />}
                {succes}
              </Etiquette>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
