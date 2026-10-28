import { useEffect, useRef, useState } from 'react'
import {
  DUREES,
  ETATS,
  MODES,
  TRIS,
  compterFiltresActifs,
  filtresVides,
  type Filtres,
  type TriBibliotheque,
} from '../../filters'
import type { Facettes } from '../../library'
import PanneauFiltres from './PanneauFiltres'
import PuceFiltre from './PuceFiltre'

type Props = {
  filtres: Filtres
  facettes: Facettes | null
  total: number
  chargement: boolean
  avecTri?: boolean
  /** Masque le compteur de résultats (la page de recherche affiche le sien). */
  afficherCompte?: boolean
  /** Longueur maximale de la saisie (100 bibliothèque, 300 recherche). */
  maxLength?: number
  /** Texte d'aide du champ (la bibliothèque filtre, la recherche cherche). */
  placeholderRecherche?: string
  libelleRecherche?: string
  onChanger: (filtres: Filtres, remplacer?: boolean) => void
  onEffacer: () => void
}

/**
 * Barre d'outils commune (recherche locale, tri, filtres) et puces des filtres
 * actifs. La saisie texte est débouncée à 250 ms et écrite en `replace` dans
 * l'URL, pour ne pas empiler une entrée d'historique par frappe.
 */
export default function BarreFiltres({
  filtres,
  facettes,
  total,
  chargement,
  avecTri = true,
  afficherCompte = true,
  maxLength = 100,
  placeholderRecherche = 'Rechercher un jeu…',
  libelleRecherche = 'Rechercher dans ta bibliothèque',
  onChanger,
  onEffacer,
}: Props) {
  const [texte, setTexte] = useState(filtres.q)
  const [panneauOuvert, setPanneauOuvert] = useState(false)
  const derniereQ = useRef(filtres.q)
  const filtresRef = useRef(filtres)

  useEffect(() => {
    filtresRef.current = filtres
  }, [filtres])

  useEffect(() => {
    if (filtres.q !== derniereQ.current) {
      derniereQ.current = filtres.q
      setTexte(filtres.q)
    }
  }, [filtres.q])

  useEffect(() => {
    if (texte === derniereQ.current) return
    const timer = window.setTimeout(() => {
      derniereQ.current = texte
      onChanger({ ...filtresRef.current, q: texte }, true)
    }, 250)
    return () => window.clearTimeout(timer)
  }, [texte, onChanger])

  const nombreFiltres = compterFiltresActifs(filtres)

  const libelleGenre = (id: number) =>
    facettes?.genres.find((genre) => genre.id === id)?.label ?? `Genre ${id}`

  return (
    <>
      <div className="biblio-toolbar">
        <label className="biblio-recherche">
          <span className="sr-only">{libelleRecherche}</span>
          <input
            type="search"
            value={texte}
            placeholder={placeholderRecherche}
            maxLength={maxLength}
            onChange={(event) => setTexte(event.target.value)}
          />
        </label>

        {avecTri && (
          <label className="biblio-tri">
            Trier par
            <select
              value={filtres.tri}
              onChange={(event) =>
                onChanger({
                  ...filtres,
                  tri: event.target.value as TriBibliotheque,
                })
              }
            >
              {TRIS.map((tri) => (
                <option key={tri.value} value={tri.value}>
                  {tri.label}
                </option>
              ))}
            </select>
          </label>
        )}

        <button
          type="button"
          className="btn biblio-bouton-filtres"
          aria-expanded={panneauOuvert}
          onClick={() => setPanneauOuvert(true)}
        >
          Filtres
          {nombreFiltres > 0 && (
            <span className="biblio-badge" aria-hidden="true">
              {nombreFiltres}
            </span>
          )}
        </button>

        {(!filtresVides(filtres) || filtres.q) && (
          <button type="button" className="btn" onClick={onEffacer}>
            Tout effacer
          </button>
        )}

        {afficherCompte && (
          <p className="biblio-compte" aria-live="polite">
            {chargement
              ? 'Chargement…'
              : `${total} résultat${total > 1 ? 's' : ''}`}
          </p>
        )}
      </div>

      {(!filtresVides(filtres) || filtres.q) && (
        <div className="filtres-actifs">
          {filtres.q && (
            <PuceFiltre
              label={`« ${filtres.q} »`}
              onRetirer={() => onChanger({ ...filtres, q: '' }, true)}
            />
          )}
          {filtres.genres.map((id) => (
            <PuceFiltre
              key={`genre-${id}`}
              label={libelleGenre(id)}
              onRetirer={() =>
                onChanger({
                  ...filtres,
                  genres: filtres.genres.filter((genre) => genre !== id),
                })
              }
            />
          ))}
          {filtres.modes.map((mode) => (
            <PuceFiltre
              key={`mode-${mode}`}
              label={MODES.find((item) => item.value === mode)?.label ?? mode}
              onRetirer={() =>
                onChanger({
                  ...filtres,
                  modes: filtres.modes.filter((item) => item !== mode),
                })
              }
            />
          ))}
          {filtres.manette && (
            <PuceFiltre
              label={
                filtres.manette === 'full'
                  ? 'Manette complète'
                  : 'Manette partielle'
              }
              onRetirer={() => onChanger({ ...filtres, manette: null })}
            />
          )}
          {filtres.etat && (
            <PuceFiltre
              label={
                ETATS.find((etat) => etat.value === filtres.etat)?.label ??
                filtres.etat
              }
              onRetirer={() => onChanger({ ...filtres, etat: null })}
            />
          )}
          {filtres.duree.map((duree) => (
            <PuceFiltre
              key={`duree-${duree}`}
              label={
                DUREES.find((item) => item.value === duree)?.label ?? duree
              }
              onRetirer={() =>
                onChanger({
                  ...filtres,
                  duree: filtres.duree.filter((item) => item !== duree),
                })
              }
            />
          ))}
        </div>
      )}

      <PanneauFiltres
        ouvert={panneauOuvert}
        filtres={filtres}
        facettes={facettes}
        total={total}
        onFermer={() => setPanneauOuvert(false)}
        onChanger={(suivants) => onChanger(suivants)}
        onEffacer={() => {
          onEffacer()
          setPanneauOuvert(false)
        }}
      />
    </>
  )
}
