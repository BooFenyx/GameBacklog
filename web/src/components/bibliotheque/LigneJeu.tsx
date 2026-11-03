import { Link } from 'react-router-dom'
import type { JeuBibliotheque } from '../../library'
import Etiquette from '../ui/Etiquette'
import { IconeCouronne, IconeManette } from '../ui/Icones'
import ImageJeu from './ImageJeu'
import { champsLigneJeu } from './affichage'

type Props = {
  jeu: JeuBibliotheque
}

/** Ligne compacte d'un jeu dans la vue liste. */
export default function LigneJeu({ jeu }: Props) {
  const champs = champsLigneJeu(jeu)

  return (
    <li className="ligne-jeu">
      <Link
        to={`/jeu/${champs.appId}`}
        className="ligne-jeu__lien"
        aria-label={`Ouvrir la fiche de ${champs.nom} — ${champs.contexte}`}
      />

      <div className="ligne-jeu__media">
        <ImageJeu src={champs.image} nom={champs.nom} />
      </div>

      <div className="ligne-jeu__principal">
        <div className="ligne-jeu__titre">
          <span>{champs.nom}</span>
        </div>
      </div>

      <div className="ligne-jeu__genres">
        {champs.genres.map((genre) => (
          <Etiquette key={genre} variante="genre">
            {genre}
          </Etiquette>
        ))}
      </div>

      <div className="ligne-jeu__modes">
        {champs.modes.map((mode) => (
          <Etiquette key={mode.valeur} variante={mode.variante}>
            {mode.libelle}
          </Etiquette>
        ))}
      </div>

      <div className="ligne-jeu__temps">
        <strong>{champs.temps ?? '—'}</strong>
        {champs.temps && <span>de jeu</span>}
      </div>

      <div
        className={
          champs.jamais
            ? 'ligne-jeu__dernier ligne-jeu__dernier--jamais'
            : 'ligne-jeu__dernier'
        }
        title={champs.activiteTitre ?? undefined}
      >
        {champs.jamais ? 'jamais lancé' : (champs.activite ?? '—')}
      </div>

      <div className="ligne-jeu__manette">
        <span
          className={`manette-icone manette-icone--${champs.manetteSupport}`}
          title={champs.manetteLibelle}
          role="img"
          aria-label={champs.manetteLibelle}
        >
          <IconeManette />
        </span>
      </div>

      <div className="ligne-jeu__succes">
        {champs.succes !== null ? (
          <Etiquette
            variante={champs.complet ? 'succes-complet' : 'succes'}
          >
            {champs.complet && <IconeCouronne />}
            {champs.succes}
          </Etiquette>
        ) : (
          <span className="ligne-jeu__vide" aria-hidden="true">
            —
          </span>
        )}
      </div>
    </li>
  )
}
