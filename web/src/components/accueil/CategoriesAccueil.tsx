import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  metaJeu,
  metaSucces,
  raisonJeu,
  type HomeCategories,
  type HomeGame,
} from '../../home'
import ImageJeu from '../bibliotheque/ImageJeu'
import { IconeMelange } from '../ui/Icones'
import BarreProgression from '../ui/BarreProgression'
import {
  fenetreCategorie,
  pageCategorie,
  pagesCategorie,
} from './categories'

type Section = {
  cle: keyof HomeCategories
  titre: string
  phrase: string
  lien: string
  libelleLien: string
  items: HomeGame[]
}

type Props = {
  categories: HomeCategories
  nomAncre: string
}

function metaCarte(jeu: HomeGame, cle: keyof HomeCategories): string {
  const succes = metaSucces(jeu)
  if (cle === 'aFinir' && succes) {
    return `${succes} · ${metaJeu(jeu)}`
  }
  if (cle === 'aDecouvrir') {
    return jeu.genres.slice(0, 3).join(' · ') || 'Jamais lancé'
  }
  return metaJeu(jeu)
}

/**
 * Trois portes d'entrée dans la bibliothèque, affichées par pages de 3 cartes.
 * Le bouton « D’autres jeux » fait tourner les pages à la demande.
 * `prefers-reduced-motion` est respecté par les animations CSS.
 */
export default function CategoriesAccueil({ categories, nomAncre }: Props) {
  const sections: Section[] = [
    {
      cle: 'aFinir',
      titre: 'À finir',
      phrase: 'Commencés, presque terminés : la dernière ligne droite.',
      lien: '/bibliotheque?tri=temps',
      libelleLien: 'Voir les plus joués',
      items: categories.aFinir,
    },
    {
      cle: 'aDecouvrir',
      titre: 'À découvrir',
      phrase: 'Jamais lancés, mais proches de ton jeu du moment.',
      lien: '/bibliotheque?etat=jamais',
      libelleLien: 'Voir les jamais lancés',
      items: categories.aDecouvrir,
    },
    {
      cle: 'aRetrouver',
      titre: 'À retrouver',
      phrase: 'Tes dernières activités connues, sans date exacte.',
      lien: '/bibliotheque?tri=recent',
      libelleLien: 'Trier par activité',
      items: categories.aRetrouver,
    },
  ]

  const [tour, setTour] = useState(0)
  const aPlusieursPages = sections.some(
    (section) => pagesCategorie(section.items.length) > 1,
  )

  const melanger = (): void => {
    setTour((valeur) => valeur + 1)
  }

  return (
    <section className="accueil-categories" aria-labelledby="titre-categories">
      <header className="accueil-categories-entete">
        <div>
          <p className="accueil-eyebrow">Raccord avec ta sélection</p>
          <h2 id="titre-categories">À finir, à découvrir, à retrouver</h2>
          <p className="accueil-sous-titre">
            Trois portes d’entrée dans tes jeux, recalculées depuis ton import.
          </p>
        </div>

        {aPlusieursPages && (
          <div
            className="accueil-categories-outils"
            role="group"
            aria-label="Suggestions de jeux"
          >
            <button
              type="button"
              className="btn accueil-categories-melanger"
              onClick={melanger}
            >
              <IconeMelange /> D’autres jeux
            </button>
          </div>
        )}
      </header>

      <div className="accueil-categories-grille">
        {sections.map((section) => {
          const pages = pagesCategorie(section.items.length)
          const page = pageCategorie(tour, pages)
          const visibles = fenetreCategorie(section.items, page)
          const fin = page * 3 + visibles.length

          return (
            <article className="accueil-categorie" key={section.cle}>
              <header className="accueil-categorie-tete">
                <div>
                  <h3>{section.titre}</h3>
                  <p>{section.phrase}</p>
                </div>
                <div className="accueil-categorie-compteurs">
                  <span className="accueil-categorie-compte">
                    {section.items.length > 0
                      ? `${fin} / ${section.items.length}`
                      : '0'}
                  </span>
                </div>
              </header>

              {visibles.length === 0 ? (
                <p className="accueil-categorie-vide">
                  Rien dans cette catégorie pour l’instant.
                </p>
              ) : (
                <ul
                  className="accueil-cat-liste"
                  key={`${section.cle}-${page}`}
                >
                  {visibles.map((jeu) => {
                    const succes = metaSucces(jeu)
                    const total = jeu.achievementsTotal
                    const debloques = jeu.achievementsUnlocked

                    return (
                      <li
                        className={`accueil-cat-carte accueil-cat-carte--${section.cle}`}
                        key={jeu.appId}
                      >
                        <Link
                          to={`/jeu/${jeu.appId}`}
                          className="accueil-cat-lien"
                          aria-label={`Voir la fiche de ${jeu.name}`}
                        >
                          <span className="accueil-cat-media">
                            <ImageJeu
                              src={jeu.headerImageUrl}
                              nom={jeu.name}
                            />
                          </span>
                          <span
                            className="accueil-cat-voile"
                            aria-hidden="true"
                          />
                          <div className="accueil-cat-contenu">
                            <span className="accueil-cat-titre">
                              {jeu.name}
                            </span>
                            <span className="accueil-cat-raison">
                              {raisonJeu(jeu, nomAncre)}
                            </span>
                            <span className="accueil-cat-meta">
                              {metaCarte(jeu, section.cle)}
                            </span>

                            {section.cle === 'aFinir' &&
                              total !== null &&
                              total > 0 &&
                              debloques !== null && (
                                <div className="accueil-cat-progression">
                                  <BarreProgression
                                    valeur={debloques}
                                    max={total}
                                    label={`Progression des succès de ${jeu.name}`}
                                    className="accueil-cat-barre"
                                  />
                                  <span>{succes}</span>
                                </div>
                              )}
                          </div>
                        </Link>
                      </li>
                    )
                  })}
                </ul>
              )}

              <Link className="accueil-categorie-lien" to={section.lien}>
                {section.libelleLien}
                <span aria-hidden="true">→</span>
              </Link>
            </article>
          )
        })}
      </div>
    </section>
  )
}
