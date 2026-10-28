import { useEffect, useRef } from 'react'
import {
  DUREES,
  ETATS,
  MODES,
  type DureeJeu,
  type EtatJeu,
  type Filtres,
  type ModeJeu,
} from '../../filters'
import type { Facettes } from '../../library'

type Props = {
  ouvert: boolean
  filtres: Filtres
  facettes: Facettes | null
  total: number
  onFermer: () => void
  onChanger: (filtres: Filtres) => void
  onEffacer: () => void
}

/**
 * Panneau de filtres partagé par la bibliothèque et la recherche.
 *
 * Un seul `<dialog>` pour les deux tailles d'écran : centré sur desktop,
 * plein écran sur mobile via le CSS. Les compteurs viennent des facettes.
 */
export default function PanneauFiltres({
  ouvert,
  filtres,
  facettes,
  total,
  onFermer,
  onChanger,
  onEffacer,
}: Props) {
  const dialogue = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const element = dialogue.current
    if (!element) return
    if (ouvert && !element.open) element.showModal()
    if (!ouvert && element.open) element.close()
  }, [ouvert])

  const compterMode = (mode: ModeJeu) =>
    facettes?.modes.find((facette) => facette.value === mode)?.count ?? 0
  const compterDuree = (duree: DureeJeu) =>
    facettes?.durees.find((facette) => facette.value === duree)?.count ?? 0

  const basculerGenre = (id: number) => {
    const genres = filtres.genres.includes(id)
      ? filtres.genres.filter((genre) => genre !== id)
      : [...filtres.genres, id]
    onChanger({ ...filtres, genres })
  }

  const basculerMode = (mode: ModeJeu) => {
    const modes = filtres.modes.includes(mode)
      ? filtres.modes.filter((valeur) => valeur !== mode)
      : [...filtres.modes, mode]
    onChanger({ ...filtres, modes })
  }

  const basculerDuree = (duree: DureeJeu) => {
    const durees = filtres.duree.includes(duree)
      ? filtres.duree.filter((valeur) => valeur !== duree)
      : [...filtres.duree, duree]
    onChanger({ ...filtres, duree: durees })
  }

  const choisirEtat = (etat: EtatJeu) => {
    const suivant = filtres.etat === etat ? null : etat
    onChanger({
      ...filtres,
      etat: suivant,
      duree: suivant === 'jamais' ? [] : filtres.duree,
    })
  }

  return (
    <dialog
      ref={dialogue}
      className="filtres-dialogue"
      aria-labelledby="filtres-titre"
      onClose={onFermer}
      onClick={(event) => {
        if (event.target === dialogue.current) onFermer()
      }}
    >
      <div className="filtres-entete">
        <h2 id="filtres-titre">Filtres</h2>
        <button
          type="button"
          className="filtres-fermer"
          aria-label="Fermer les filtres"
          onClick={onFermer}
        >
          ×
        </button>
      </div>

      <div className="filtres-corps">
        <fieldset className="filtres-groupe">
          <legend>Genres</legend>
          {facettes === null ? (
            <p className="filtres-attente">Chargement des genres…</p>
          ) : facettes.genres.length === 0 ? (
            <p className="filtres-attente">Aucun genre indexé.</p>
          ) : (
            <div className="filtres-genres">
              {facettes.genres.map((genre) => (
                <label key={genre.id} className="filtres-case">
                  <input
                    type="checkbox"
                    checked={filtres.genres.includes(genre.id)}
                    onChange={() => basculerGenre(genre.id)}
                  />
                  <span>{genre.label}</span>
                  <span className="filtres-compte">{genre.count}</span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <fieldset className="filtres-groupe">
          <legend>Modes de jeu</legend>
          <div className="filtres-options">
            {MODES.map((mode) => {
              const actif = filtres.modes.includes(mode.value)
              const compte = compterMode(mode.value)
              return (
                <button
                  key={mode.value}
                  type="button"
                  className="filtres-bouton"
                  aria-pressed={actif}
                  disabled={compte === 0 && !actif}
                  onClick={() => basculerMode(mode.value)}
                >
                  {mode.label}
                  <span className="filtres-compte">{compte}</span>
                </button>
              )
            })}
          </div>
        </fieldset>

        <fieldset className="filtres-groupe">
          <legend>Manette</legend>
          <div className="filtres-options">
            <button
              type="button"
              className="filtres-bouton"
              aria-pressed={filtres.manette === 'full'}
              onClick={() =>
                onChanger({
                  ...filtres,
                  manette: filtres.manette === 'full' ? null : 'full',
                })
              }
            >
              Complète
              <span className="filtres-compte">
                {facettes?.manettes.find(
                  (facette) => facette.value === 'full',
                )?.count ?? 0}
              </span>
            </button>
          </div>
        </fieldset>

        <fieldset className="filtres-groupe">
          <legend>Temps de jeu</legend>
          <div className="filtres-options">
            {ETATS.map((etat) => (
              <button
                key={etat.value}
                type="button"
                className="filtres-bouton"
                aria-pressed={filtres.etat === etat.value}
                onClick={() => choisirEtat(etat.value)}
              >
                {etat.label}
                <span className="filtres-compte">
                  {facettes?.etats.find(
                    (facette) => facette.value === etat.value,
                  )?.count ?? 0}
                </span>
              </button>
            ))}
          </div>
          <div className="filtres-options filtres-options-duree">
            {DUREES.map((duree) => (
              <button
                key={duree.value}
                type="button"
                className="filtres-bouton"
                aria-pressed={filtres.duree.includes(duree.value)}
                disabled={filtres.etat === 'jamais'}
                onClick={() => basculerDuree(duree.value)}
              >
                {duree.label}
                <span className="filtres-compte">
                  {compterDuree(duree.value)}
                </span>
              </button>
            ))}
          </div>
          {filtres.etat === 'jamais' && (
            <p className="filtres-note">
              Les tranches de durée ne s’appliquent pas aux jeux jamais lancés.
            </p>
          )}
        </fieldset>
      </div>

      <div className="filtres-pied">
        <button type="button" className="btn" onClick={onEffacer}>
          Réinitialiser
        </button>
        <button
          type="button"
          className="btn btn-principal"
          onClick={onFermer}
        >
          {total > 0
            ? `Voir ${total} résultat${total > 1 ? 's' : ''}`
            : 'Fermer'}
        </button>
      </div>
    </dialog>
  )
}
