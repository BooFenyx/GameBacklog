import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import DescriptionJeu from '../components/jeu/DescriptionJeu'
import EnteteJeu from '../components/jeu/EnteteJeu'
import GalerieJeu from '../components/jeu/GalerieJeu'
import PanneauJeu from '../components/jeu/PanneauJeu'
import SqueletteJeu from '../components/jeu/SqueletteJeu'
import SuccesJeu from '../components/jeu/SuccesJeu'
import { IconeAlerte } from '../components/ui/Icones'
import {
  ErreurFiche,
  chargerFicheJeu,
  type FicheJeu,
} from '../games'

type Etat =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string; introuvable: boolean }
  | { statut: 'pret'; jeu: FicheJeu }

const MESSAGE_INTROUVABLE =
  "Ce jeu n'est pas dans ta bibliothèque, ou sa fiche n'est plus disponible."

/** Page détail d'un jeu : fiche `GET /api/games/:appId`, succès et galerie. */
export default function JeuDetail() {
  const { appId } = useParams<{ appId: string }>()
  const [etat, setEtat] = useState<Etat>({ statut: 'chargement' })
  const [recharger, setRecharger] = useState(0)

  useEffect(() => {
    if (!appId) return
    const controller = new AbortController()
    let actif = true

    void chargerFicheJeu(appId, controller.signal)
      .then((jeu) => {
        if (actif) setEtat({ statut: 'pret', jeu })
      })
      .catch((error: unknown) => {
        if (!actif || controller.signal.aborted) return
        if (error instanceof ErreurFiche && error.statut === 404) {
          setEtat({
            statut: 'erreur',
            message: MESSAGE_INTROUVABLE,
            introuvable: true,
          })
          return
        }
        setEtat({
          statut: 'erreur',
          message:
            error instanceof Error
              ? error.message
              : 'Impossible de récupérer la fiche du jeu.',
          introuvable: false,
        })
      })

    return () => {
      actif = false
      controller.abort()
    }
  }, [appId, recharger])

  if (!appId) {
    return (
      <section className="detail detail--erreur">
        <div className="etat-biblio">
          <span className="etat-biblio__icone" aria-hidden="true">
            <IconeAlerte />
          </span>
          <p>Identifiant de jeu manquant.</p>
          <Link className="btn" to="/bibliotheque">
            Retour à la bibliothèque
          </Link>
        </div>
      </section>
    )
  }

  if (etat.statut === 'chargement') {
    return (
      <>
        <p className="sr-only" role="status">
          Chargement de la fiche…
        </p>
        <SqueletteJeu />
      </>
    )
  }

  if (etat.statut === 'erreur') {
    return (
      <section className="detail detail--erreur">
        <div className="etat-biblio" role="alert">
          <span className="etat-biblio__icone" aria-hidden="true">
            <IconeAlerte />
          </span>
          <p>{etat.message}</p>
          <div className="etat-erreur-actions">
            {!etat.introuvable && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setEtat({ statut: 'chargement' })
                  setRecharger((valeur) => valeur + 1)
                }}
              >
                Réessayer
              </button>
            )}
            <Link className="btn" to="/bibliotheque">
              Retour à la bibliothèque
            </Link>
          </div>
        </div>
      </section>
    )
  }

  const { jeu } = etat

  return (
    <article className="fiche">
      <EnteteJeu jeu={jeu} />
      <div className="fiche-layout">
        <div className="fiche-principale">
          <DescriptionJeu
            blocs={jeu.descriptionBlocks}
            descriptionCourte={jeu.shortDescription}
          />
          <GalerieJeu captures={jeu.screenshots} nom={jeu.name} />
          <SuccesJeu succes={jeu.achievements} />
        </div>
        <PanneauJeu jeu={jeu} />
      </div>
    </article>
  )
}
