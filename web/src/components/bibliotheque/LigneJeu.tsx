import { Link } from 'react-router-dom'
import type { JeuBibliotheque } from '../../library'
import Etiquette from '../ui/Etiquette'
import { IconeCouronne, IconeManette } from '../ui/Icones'
import ImageJeu from './ImageJeu'
import {
  LIBELLE_MANETTE,
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

/** Ligne compacte d'un jeu dans la vue liste. */
export default function LigneJeu({ jeu }: Props) {
  const etat = etatJeu(jeu)
  const meta = metaJeu(jeu)
  const succes = succesAffiche(jeu)
  const complet = succesComplet(jeu)
  const dernierJamais = meta.dernier === null
  const genres = jeu.genres

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
        </div>
      </div>

      <div className="ligne-jeu__genres">
        {genres.map((genre) => (
          <Etiquette key={genre} variante="genre">
            {genre}
          </Etiquette>
        ))}
      </div>

      <div className="ligne-jeu__modes">
        {jeu.modes.map((mode) => (
          <Etiquette key={mode} variante={mode === 'solo' ? 'solo' : 'mode'}>
            {libelleMode(mode)}
          </Etiquette>
        ))}
      </div>

      <div className="ligne-jeu__temps">
        <strong>{meta.temps ?? '—'}</strong>
        {meta.temps && <span>de jeu</span>}
      </div>

      <div
        className={
          dernierJamais
            ? 'ligne-jeu__dernier ligne-jeu__dernier--jamais'
            : 'ligne-jeu__dernier'
        }
      >
        {meta.dernier ?? 'jamais lancé'}
      </div>

      <div className="ligne-jeu__manette">
        <span
          className={`manette-icone manette-icone--${jeu.controllerSupport}`}
          title={LIBELLE_MANETTE[jeu.controllerSupport]}
          role="img"
          aria-label={LIBELLE_MANETTE[jeu.controllerSupport]}
        >
          <IconeManette />
        </span>
      </div>

      <div className="ligne-jeu__succes">
        {succes !== null ? (
          <Etiquette variante={complet ? 'succes-complet' : 'succes'}>
            {complet && <IconeCouronne />}
            {succes}
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
