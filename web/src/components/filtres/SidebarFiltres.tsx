import { useMemo, useState } from 'react'
import {
  DUREES,
  ETATS,
  MODES,
  compterFiltresActifs,
  type DureeJeu,
  type EtatJeu,
  type Filtres,
  type ModeJeu,
} from '../../filters'
import type { Facettes } from '../../library'

type Props = {
  filtres: Filtres
  facettes: Facettes | null
  ouvert: boolean
  onChanger: (filtres: Filtres) => void
  onEffacer: () => void
  onFermer: () => void
}

const GENRES_VISIBLES = 7

/**
 * Colonne de filtres de la bibliothèque (desktop). Sur mobile elle est
 * masquée et remplacée par le panneau `<dialog>` de `BarreFiltres`.
 */
export default function SidebarFiltres({
  filtres,
  facettes,
  ouvert,
  onChanger,
  onEffacer,
  onFermer,
}: Props) {
  const [rechercheGenre, setRechercheGenre] = useState('')
  const [tousGenres, setTousGenres] = useState(false)

  const genresFiltres = useMemo(() => {
    const liste = facettes?.genres ?? []
    const recherche = rechercheGenre.trim().toLowerCase()
    if (!recherche) return liste
    return liste.filter((genre) =>
      genre.label.toLowerCase().includes(recherche),
    )
  }, [facettes, rechercheGenre])

  const genresAffiches =
    tousGenres || rechercheGenre.trim().length > 0
      ? genresFiltres
      : genresFiltres.slice(0, GENRES_VISIBLES)

  const nombreFiltres = compterFiltresActifs(filtres)

  const compterMode = (mode: ModeJeu) =>
    facettes?.modes.find((facette) => facette.value === mode)?.count ?? 0
  const compterDuree = (duree: DureeJeu) =>
    facettes?.durees.find((facette) => facette.value === duree)?.count ?? 0
  const compterEtat = (etat: EtatJeu) =>
    facettes?.etats.find((facette) => facette.value === etat)?.count ?? 0

  const basculerGenre = (id: number) => {
    if (!filtres.genres.includes(id) && filtres.genres.length >= 8) return
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

  const note = (nombre: number) =>
    nombre > 0
      ? `${nombre} sélectionné${nombre > 1 ? 's' : ''}`
      : 'Tous'

  return (
    <aside
      className="filtres-sidebar"
      aria-label="Filtres de la bibliothèque"
      aria-hidden={!ouvert}
      inert={!ouvert}
    >
      <div className="filtres-sidebar-entete">
        <div>
          <h2>Filtres</h2>
          <p className="filtres-sidebar-resume">
            {nombreFiltres > 0
              ? `${nombreFiltres} filtre${nombreFiltres > 1 ? 's' : ''} actif${nombreFiltres > 1 ? 's' : ''}`
              : 'Aucun filtre actif'}
          </p>
        </div>
        <div className="filtres-sidebar-actions">
          <button
            type="button"
            className="filtres-sidebar-lien"
            onClick={onEffacer}
          >
            Tout effacer
          </button>
          <button
            type="button"
            className="filtres-sidebar-fermer"
            aria-label="Masquer les filtres"
            title="Masquer les filtres"
            onClick={onFermer}
          >
            ‹
          </button>
        </div>
      </div>

      <details className="filtre-section" open>
        <summary className="filtre-section-tete">
          <span className="filtre-chevron" aria-hidden="true">
            ▸
          </span>
          <h3>
            Genres{' '}
            <span className="filtre-section-note">
              {note(filtres.genres.length)}
            </span>
          </h3>
        </summary>
        <div className="filtre-section-corps">
          <input
            type="search"
            className="filtre-recherche-genre"
            placeholder="Rechercher un genre…"
            value={rechercheGenre}
            onChange={(event) => setRechercheGenre(event.target.value)}
            aria-label="Rechercher un genre"
          />
          {facettes === null ? (
            <p className="filtre-attente">Chargement des genres…</p>
          ) : genresAffiches.length === 0 ? (
            <p className="filtre-attente">Aucun genre trouvé.</p>
          ) : (
            <>
              {genresAffiches.map((genre) => (
                <label key={genre.id} className="filtre-case">
                  <input
                    type="checkbox"
                    checked={filtres.genres.includes(genre.id)}
                    onChange={() => basculerGenre(genre.id)}
                  />
                  <span>{genre.label}</span>
                  <span className="filtre-compte">{genre.count}</span>
                </label>
              ))}
              {!rechercheGenre && genresFiltres.length > GENRES_VISIBLES && (
                <button
                  type="button"
                  className="filtres-sidebar-lien filtre-voir-plus"
                  onClick={() => setTousGenres((valeur) => !valeur)}
                >
                  {tousGenres ? 'Voir moins de genres' : 'Voir plus de genres'}
                </button>
              )}
            </>
          )}
        </div>
      </details>

      <details className="filtre-section" open>
        <summary className="filtre-section-tete">
          <span className="filtre-chevron" aria-hidden="true">
            ▸
          </span>
          <h3>
            Modes de jeu{' '}
            <span className="filtre-section-note">
              {note(filtres.modes.length)}
            </span>
          </h3>
        </summary>
        <div className="filtre-section-corps">
          <div className="filtre-pills">
            {MODES.map((mode) => {
              const actif = filtres.modes.includes(mode.value)
              const compte = compterMode(mode.value)
              return (
                <button
                  key={mode.value}
                  type="button"
                  className="filtre-pill"
                  aria-pressed={actif}
                  disabled={compte === 0 && !actif}
                  onClick={() => basculerMode(mode.value)}
                >
                  {mode.label}
                  <span className="filtre-compte">{compte}</span>
                </button>
              )
            })}
          </div>
        </div>
      </details>

      <details className="filtre-section" open>
        <summary className="filtre-section-tete">
          <span className="filtre-chevron" aria-hidden="true">
            ▸
          </span>
          <h3>
            Temps de jeu{' '}
            <span className="filtre-section-note">
              {note((filtres.etat ? 1 : 0) + filtres.duree.length)}
            </span>
          </h3>
        </summary>
        <div className="filtre-section-corps">
          <p className="filtre-sous-titre">État</p>
          <div className="filtre-temps">
            {ETATS.map((etat) => (
              <button
                key={etat.value}
                type="button"
                className="filtre-temps-ligne"
                aria-pressed={filtres.etat === etat.value}
                onClick={() => choisirEtat(etat.value)}
              >
                {etat.label}
                <span className="filtre-compte">
                  {compterEtat(etat.value)}
                </span>
              </button>
            ))}
          </div>
          <p className="filtre-sous-titre">Durée</p>
          <div className="filtre-temps">
            {DUREES.map((duree) => (
              <button
                key={duree.value}
                type="button"
                className="filtre-temps-ligne"
                aria-pressed={filtres.duree.includes(duree.value)}
                disabled={filtres.etat === 'jamais'}
                onClick={() => basculerDuree(duree.value)}
              >
                {duree.label}
                <span className="filtre-compte">
                  {compterDuree(duree.value)}
                </span>
              </button>
            ))}
          </div>
          {filtres.etat === 'jamais' && (
            <p className="filtre-note">
              Les tranches de durée ne s’appliquent pas aux jeux jamais lancés.
            </p>
          )}
        </div>
      </details>

      <div className="filtre-manette">
        <span>Manette</span>
        <button
          type="button"
          className="filtre-switch"
          aria-pressed={filtres.manette === 'full'}
          aria-label="Filtrer les jeux compatibles manette"
          title="Manette complète"
          onClick={() =>
            onChanger({
              ...filtres,
              manette: filtres.manette === 'full' ? null : 'full',
            })
          }
        />
      </div>
    </aside>
  )
}
