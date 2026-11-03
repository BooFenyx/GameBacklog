import { useEffect, useRef } from 'react'
import {
  LANCEMENTS,
  type HomeSelection,
  type ParametresSelection,
} from '../../home'
import type { Facettes } from '../../library'

type Props = {
  open: boolean
  onFermer: () => void
  facettes: Facettes | null
  selection: HomeSelection
  parametres: ParametresSelection
  onChanger: (partiel: Partial<ParametresSelection>) => void
  onReinitialiser: () => void
}

/**
 * Panneau « Affiner » : genre prioritaire, découverte, manette, progression et
 * lancement. Les réglages s'appliquent immédiatement au deck (le parent relance
 * `/api/home/selection`), et le bouton ferme seulement le panneau.
 */
export default function DialogueAffiner({
  open,
  onFermer,
  facettes,
  selection,
  parametres,
  onChanger,
  onReinitialiser,
}: Props) {
  const dialogueRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogue = dialogueRef.current
    if (!dialogue) return
    if (open && !dialogue.open) dialogue.showModal()
    if (!open && dialogue.open) dialogue.close()
  }, [open])

  const optionsGenres =
    facettes && facettes.genres.length > 0
      ? facettes.genres.map(({ id, label }) => ({ id, label }))
      : (selection.anchor?.genres ?? []).flatMap((label, index) => {
          const id = selection.anchor?.genreIds[index]
          return id === undefined || id <= 0 ? [] : [{ id, label }]
        })

  const genreActif =
    parametres.genreId === 0
      ? 0
      : (selection.genre?.id ?? parametres.genreId ?? 0)

  const morceaux = [
    parametres.genreId === 0
      ? 'tous genres'
      : selection.genre
        ? `priorité ${selection.genre.label}`
        : 'genre du jeu',
    `découverte ${parametres.decouverte} %`,
    parametres.manette ? 'manette' : 'sans filtre manette',
    parametres.lancement === 'tous'
      ? 'tous les jeux'
      : parametres.lancement === 'deja'
        ? 'déjà lancés'
        : 'jamais lancés',
  ]
  if (parametres.progression) morceaux.push('proches du 100 %')

  return (
    <dialog
      ref={dialogueRef}
      className="accueil-dialogue accueil-dialogue--affiner"
      aria-labelledby="accueil-affiner-titre"
      onCancel={(evenement) => {
        evenement.preventDefault()
        onFermer()
      }}
      onClose={onFermer}
      onClick={(evenement) => {
        if (evenement.target === evenement.currentTarget) onFermer()
      }}
    >
      <div className="accueil-dialogue-tete">
        <div>
          <p className="accueil-eyebrow">Sélection du chef</p>
          <h2 id="accueil-affiner-titre">Affiner la sélection</h2>
          <p>Les réglages s’appliquent immédiatement au deck.</p>
        </div>
        <button
          type="button"
          className="accueil-dialogue-fermer"
          aria-label="Fermer la fenêtre"
          onClick={onFermer}
        >
          ×
        </button>
      </div>

      <div className="accueil-dialogue-corps">
        <fieldset className="accueil-affiner-groupe">
          <legend>Genre à privilégier</legend>
          <div className="accueil-chips">
            <button
              type="button"
              className={`accueil-affiner-chip${genreActif === 0 ? ' actif' : ''}`}
              aria-pressed={genreActif === 0}
              onClick={() => onChanger({ genreId: 0 })}
            >
              Aucun
            </button>
            {optionsGenres.map((genre) => (
              <button
                key={genre.id}
                type="button"
                className={`accueil-affiner-chip${genreActif === genre.id ? ' actif' : ''}`}
                aria-pressed={genreActif === genre.id}
                onClick={() => onChanger({ genreId: genre.id })}
              >
                {genre.label}
              </button>
            ))}
          </div>
        </fieldset>

        <fieldset className="accueil-affiner-groupe">
          <legend>
            Découverte{' '}
            <output
              className="accueil-affiner-valeur"
              htmlFor="accueil-decouverte"
              aria-live="polite"
            >
              {parametres.decouverte} %
            </output>
          </legend>
          <input
            id="accueil-decouverte"
            className="accueil-affiner-range"
            type="range"
            min={10}
            max={100}
            step={5}
            value={parametres.decouverte}
            aria-label="Niveau de découverte, de 10 à 100 %"
            onChange={(evenement) =>
              onChanger({ decouverte: Number(evenement.target.value) })
            }
          />
          <div className="accueil-range-labels" aria-hidden="true">
            <span>Proche de mon jeu</span>
            <span>Surprends-moi</span>
          </div>
        </fieldset>

        <fieldset className="accueil-affiner-groupe">
          <legend>Filtres</legend>
          <label className="accueil-interrupteur">
            <input
              type="checkbox"
              checked={parametres.manette}
              onChange={(evenement) =>
                onChanger({ manette: evenement.target.checked })
              }
            />
            <span className="accueil-rail" aria-hidden="true" />
            <span>Manette complète ou partielle</span>
          </label>
          <label className="accueil-interrupteur">
            <input
              type="checkbox"
              checked={parametres.progression}
              onChange={(evenement) =>
                onChanger({ progression: evenement.target.checked })
              }
            />
            <span className="accueil-rail" aria-hidden="true" />
            <span>Proches du 100 % de succès</span>
          </label>

          <p className="accueil-affiner-sous-titre">Lancement</p>
          <div className="accueil-chips">
            {LANCEMENTS.map((choix) => (
              <button
                key={choix.value}
                type="button"
                className={`accueil-affiner-chip${parametres.lancement === choix.value ? ' actif' : ''}`}
                aria-pressed={parametres.lancement === choix.value}
                onClick={() => onChanger({ lancement: choix.value })}
              >
                {choix.label}
              </button>
            ))}
          </div>
        </fieldset>

        <p className="accueil-affiner-resume">{morceaux.join(' · ')}</p>

        <div className="accueil-affiner-actions">
          <button type="button" className="btn" onClick={onReinitialiser}>
            Réinitialiser
          </button>
          <button
            type="button"
            className="btn btn-principal"
            onClick={onFermer}
          >
            Voir la sélection
          </button>
        </div>
      </div>
    </dialog>
  )
}
