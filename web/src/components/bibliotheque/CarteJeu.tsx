import { Link } from 'react-router-dom'
import type { JeuBibliotheque } from '../../library'
import Etiquette from '../ui/Etiquette'
import { IconeCouronne } from '../ui/Icones'
import ImageJeu from './ImageJeu'
import { champsCarteJeu } from './affichage'

type Props = {
  jeu: JeuBibliotheque
}

/** Carte d'un jeu dans la vue grille. */
export default function CarteJeu({ jeu }: Props) {
  const champs = champsCarteJeu(jeu)

  return (
    <li className="carte-jeu">
      <Link
        to={`/jeu/${champs.appId}`}
        className="carte-jeu__lien"
        aria-label={`Ouvrir la fiche de ${champs.nom} — ${champs.contexte}`}
      />

      <div className="carte-jeu__media">
        <ImageJeu src={champs.image} nom={champs.nom} />
      </div>

      <div className="carte-jeu__corps">
        <h2 className="carte-jeu__titre">{champs.nom}</h2>

        <p className="carte-jeu__meta">
          {champs.temps ? (
            <span>
              <strong>{champs.temps}</strong> de jeu
            </span>
          ) : (
            <span className="jamais">Jamais lancé</span>
          )}
          {champs.activite && (
            <span
              className="dernier"
              title={champs.activiteTitre ?? undefined}
            >
              {champs.activite}
            </span>
          )}
        </p>

        {champs.genres.length > 0 && (
          <div className="carte-jeu__chips">
            {champs.genres.map((genre) => (
              <Etiquette key={genre} variante="genre">
                {genre}
              </Etiquette>
            ))}
            {champs.genresRestants > 0 && (
              <Etiquette
                variante="genre"
                className="etiquette--plus"
                title={jeu.genres.slice(champs.genres.length).join(', ')}
              >
                +{champs.genresRestants}
              </Etiquette>
            )}
          </div>
        )}

        {(champs.modes.length > 0 || champs.manette || champs.succes !== null) && (
          <div className="carte-jeu__badges">
            {champs.modes.map((mode) => (
              <Etiquette key={mode.valeur} variante={mode.variante}>
                {mode.libelle}
              </Etiquette>
            ))}
            {champs.manette && <Etiquette variante="manette">Manette</Etiquette>}
            {champs.succes !== null && (
              <Etiquette
                variante={champs.complet ? 'succes-complet' : 'succes'}
              >
                {champs.complet && <IconeCouronne />}
                {champs.succes}
              </Etiquette>
            )}
          </div>
        )}
      </div>
    </li>
  )
}
