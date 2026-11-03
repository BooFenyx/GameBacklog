import { Link } from 'react-router-dom'
import { raisonJeu, type HomeCategories, type HomeGame } from '../../home'
import ImageJeu from '../bibliotheque/ImageJeu'

type Section = {
  cle: keyof HomeCategories
  titre: string
  phrase: string
  items: HomeGame[]
}

type Props = {
  categories: HomeCategories
  nomAncre: string
}

/** Trois colonnes « À finir / À découvrir / À retrouver », 3 cartes max. */
export default function CategoriesAccueil({ categories, nomAncre }: Props) {
  const sections: Section[] = [
    {
      cle: 'aFinir',
      titre: 'À finir',
      phrase: 'Reprends là où tu t’es arrêté.',
      items: categories.aFinir,
    },
    {
      cle: 'aDecouvrir',
      titre: 'À découvrir',
      phrase: 'Jamais lancés, mais proches de ton jeu du moment.',
      items: categories.aDecouvrir,
    },
    {
      cle: 'aRetrouver',
      titre: 'À retrouver',
      phrase: 'Tes dernières activités connues.',
      items: categories.aRetrouver,
    },
  ]

  return (
    <section className="accueil-categories" aria-label="Tes jeux par envie">
      <div className="accueil-categories-grille">
        {sections.map((section) => (
          <article className="accueil-categorie" key={section.cle}>
            <header className="accueil-categorie-tete">
              <h2>{section.titre}</h2>
              <p>{section.phrase}</p>
            </header>

            {section.items.length === 0 ? (
              <p className="accueil-categorie-vide">Rien pour l’instant.</p>
            ) : (
              <ul className="accueil-liste-compacte">
                {section.items.map((jeu) => (
                  <li key={jeu.appId}>
                    <Link
                      className="accueil-compacte"
                      to={`/jeu/${jeu.appId}`}
                      aria-label={`Voir la fiche de ${jeu.name}`}
                    >
                      <span className="accueil-compacte-media">
                        <ImageJeu src={jeu.headerImageUrl} nom={jeu.name} />
                      </span>
                      <span className="accueil-compacte-texte">
                        <span className="accueil-compacte-titre">
                          {jeu.name}
                        </span>
                        <span className="accueil-compacte-meta">
                          {raisonJeu(jeu, nomAncre)}
                        </span>
                      </span>
                      <span
                        className="accueil-compacte-fleche"
                        aria-hidden="true"
                      >
                        →
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </article>
        ))}
      </div>
    </section>
  )
}
