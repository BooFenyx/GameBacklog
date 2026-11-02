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
  chargerSuccesJeu,
  type FicheJeu,
  type SuccesDetail,
} from '../games'

type EtatFiche =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string; introuvable: boolean }
  | { statut: 'pret'; jeu: FicheJeu }

type EtatSucces =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; succes: SuccesDetail }

const MESSAGE_INTROUVABLE =
  "Ce jeu n'est pas dans ta bibliothèque, ou sa fiche n'est plus disponible."

/** Page détail d'un jeu : fiche et succès sont chargés séparément. */
export default function JeuDetail() {
  const { appId } = useParams<{ appId: string }>()
  const [fiche, setFiche] = useState<EtatFiche>({ statut: 'chargement' })
  const [succes, setSucces] = useState<EtatSucces>({ statut: 'chargement' })
  const [rechargerFiche, setRechargerFiche] = useState(0)
  const [rechargerSucces, setRechargerSucces] = useState(0)

  useEffect(() => {
    if (!appId) return
    const controller = new AbortController()
    let actif = true

    void chargerFicheJeu(appId, controller.signal)
      .then((jeu) => {
        if (actif) setFiche({ statut: 'pret', jeu })
      })
      .catch((error: unknown) => {
        if (!actif || controller.signal.aborted) return
        if (error instanceof ErreurFiche && error.statut === 404) {
          setFiche({
            statut: 'erreur',
            message: MESSAGE_INTROUVABLE,
            introuvable: true,
          })
          return
        }
        setFiche({
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
  }, [appId, rechargerFiche])

  useEffect(() => {
    if (!appId) return
    const controller = new AbortController()
    let actif = true

    void chargerSuccesJeu(appId, controller.signal)
      .then((detail) => {
        if (actif) setSucces({ statut: 'pret', succes: detail })
      })
      .catch((error: unknown) => {
        if (!actif || controller.signal.aborted) return
        if (error instanceof ErreurFiche && error.statut === 404) {
          setSucces({ statut: 'erreur', message: MESSAGE_INTROUVABLE })
          return
        }
        setSucces({
          statut: 'erreur',
          message:
            error instanceof Error
              ? error.message
              : 'Impossible de récupérer les succès.',
        })
      })

    return () => {
      actif = false
      controller.abort()
    }
  }, [appId, rechargerSucces])

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

  if (fiche.statut === 'chargement') {
    return (
      <>
        <p className="sr-only" role="status">
          Chargement de la fiche…
        </p>
        <SqueletteJeu />
      </>
    )
  }

  if (fiche.statut === 'erreur') {
    return (
      <section className="detail detail--erreur">
        <div className="etat-biblio" role="alert">
          <span className="etat-biblio__icone" aria-hidden="true">
            <IconeAlerte />
          </span>
          <p>{fiche.message}</p>
          <div className="etat-erreur-actions">
            {!fiche.introuvable && (
              <button
                type="button"
                className="btn"
                onClick={() => {
                  setFiche({ statut: 'chargement' })
                  setSucces({ statut: 'chargement' })
                  setRechargerFiche((valeur) => valeur + 1)
                  setRechargerSucces((valeur) => valeur + 1)
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

  const detailSucces = succes.statut === 'pret' ? succes.succes : undefined

  return (
    <article className="fiche">
      <EnteteJeu jeu={fiche.jeu} succes={detailSucces} />
      <div className="fiche-layout">
        <div className="fiche-principale">
          <DescriptionJeu
            blocs={fiche.jeu.descriptionBlocks}
            descriptionCourte={fiche.jeu.shortDescription}
          />
          <GalerieJeu
            captures={fiche.jeu.screenshots}
            nom={fiche.jeu.name}
          />

          {succes.statut === 'chargement' && (
            <section
              className="fiche-section fiche-section--succes"
              aria-busy="true"
            >
              <h2 className="titre-section">Succès</h2>
              <p className="succes-vide">Chargement des succès…</p>
            </section>
          )}

          {succes.statut === 'erreur' && (
            <section
              className="fiche-section fiche-section--succes"
              role="alert"
            >
              <h2 className="titre-section">Succès</h2>
              <p className="succes-vide">{succes.message}</p>
              <div className="succes-plus">
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    setSucces({ statut: 'chargement' })
                    setRechargerSucces((valeur) => valeur + 1)
                  }}
                >
                  Réessayer
                </button>
              </div>
            </section>
          )}

          {succes.statut === 'pret' && (
            <SuccesJeu succes={succes.succes} />
          )}
        </div>
        <PanneauJeu jeu={fiche.jeu} succes={detailSucces} />
      </div>
    </article>
  )
}
