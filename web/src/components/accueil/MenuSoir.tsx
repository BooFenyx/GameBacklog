import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  INTENTIONS,
  TEMPS,
  TEMPS_LABELS,
  chargerMenu,
  libelleManette,
  metaJeu,
  metaSucces,
  raisonJeu,
  type HomeAnchor,
  type HomeIntention,
  type HomeMenuResponse,
  type HomeTemps,
} from '../../home'
import ImageJeu from '../bibliotheque/ImageJeu'
import Etiquette from '../ui/Etiquette'
import { IconeManette } from '../ui/Icones'
import DialoguePourquoi from './DialoguePourquoi'
import DialogueSources from './DialogueSources'

type Props = {
  menuInitial: HomeMenuResponse
  anchor: HomeAnchor | null
}

/**
 * Menu « On joue à quoi ? ». Le temps est une préférence de classement, pas une
 * durée de session : aucun texte ne promet une partie de 30 ou 45 minutes.
 */
export default function MenuSoir({ menuInitial, anchor }: Props) {
  const [temps, setTemps] = useState<HomeTemps>(menuInitial.temps)
  const [intention, setIntention] = useState<HomeIntention>(
    menuInitial.intention,
  )
  const [manette, setManette] = useState(menuInitial.manette)
  const [menu, setMenu] = useState(menuInitial)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [dialoguePourquoi, setDialoguePourquoi] = useState(false)
  const [dialogueSources, setDialogueSources] = useState(false)
  const premierRendu = useRef(true)
  const anchorId = anchor?.appId ?? null

  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setChargement(true)
      void chargerMenu(
        { anchor: anchorId, temps, intention, manette },
        controller.signal,
      )
        .then((reponse) => {
          if (controller.signal.aborted) return
          setMenu(reponse)
          setErreur(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setErreur(
            error instanceof Error
              ? error.message
              : 'Impossible de calculer le menu.',
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setChargement(false)
        })
    }, 150)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [anchorId, temps, intention, manette])

  const nomAncre = anchor?.name ?? 'ton jeu du moment'
  const resultat = menu.resultat
  const succes = resultat ? metaSucces(resultat) : null

  return (
    <section className="accueil-menu" aria-labelledby="titre-menu">
      <div className="accueil-menu-reglages">
        <p className="accueil-eyebrow">Le menu du soir</p>
        <h2 id="titre-menu">On joue à quoi&nbsp;?</h2>
        <p className="accueil-sous-titre">
          Le temps que tu as, l’envie du moment.
        </p>

        <div className="accueil-reglage">
          <span className="accueil-reglage-label" id="label-temps">
            Temps disponible
          </span>
          <div
            className="accueil-chips"
            role="radiogroup"
            aria-labelledby="label-temps"
          >
            {TEMPS.map((valeur) => (
              <label className="accueil-chip" key={valeur}>
                <input
                  type="radio"
                  name="menu-temps"
                  value={valeur}
                  checked={temps === valeur}
                  onChange={() => setTemps(valeur)}
                />
                <span>{TEMPS_LABELS[valeur]}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="accueil-reglage">
          <span className="accueil-reglage-label" id="label-intention">
            Intention
          </span>
          <div
            className="accueil-chips"
            role="radiogroup"
            aria-labelledby="label-intention"
          >
            {INTENTIONS.map((choix) => (
              <label className="accueil-chip" key={choix.value}>
                <input
                  type="radio"
                  name="menu-intention"
                  value={choix.value}
                  checked={intention === choix.value}
                  onChange={() => setIntention(choix.value)}
                />
                <span>{choix.label}</span>
              </label>
            ))}
          </div>
        </div>

        <label className="accueil-interrupteur">
          <input
            type="checkbox"
            checked={manette}
            onChange={(evenement) => setManette(evenement.target.checked)}
          />
          <span className="accueil-rail" aria-hidden="true" />
          <span>Manette</span>
        </label>

        <p className="accueil-note" aria-live="polite">
          {manette
            ? 'Manette complète ou partielle, la distinction reste affichée.'
            : 'Sans filtre de manette.'}
        </p>

        <div className="accueil-menu-liens">
          <button
            type="button"
            className="accueil-lien"
            onClick={() => setDialoguePourquoi(true)}
          >
            Pourquoi&nbsp;?
          </button>
          <button
            type="button"
            className="accueil-lien"
            onClick={() => setDialogueSources(true)}
          >
            Sources
          </button>
        </div>
      </div>

      <div
        className="accueil-menu-resultat"
        aria-live="polite"
        aria-busy={chargement}
      >
        {resultat ? (
          <article className="accueil-resultat">
            <div className="accueil-resultat-media">
              <ImageJeu
                src={resultat.headerImageUrl}
                nom={resultat.name}
              />
            </div>
            <div className="accueil-resultat-corps">
              <p className="accueil-eyebrow">Le choix du menu</p>
              <h3>{resultat.name}</h3>
              <p className="accueil-resultat-raison">
                {raisonJeu(resultat, nomAncre)}
              </p>
              <p className="accueil-resultat-meta">{metaJeu(resultat)}</p>

              <div className="accueil-carte-badges">
                {resultat.controllerSupport !== 'none' && (
                  <Etiquette variante="manette">
                    <IconeManette />{' '}
                    {libelleManette(resultat.controllerSupport)}
                  </Etiquette>
                )}
                {succes && <Etiquette variante="succes">{succes}</Etiquette>}
              </div>

              <div className="accueil-carte-actions">
                <a
                  className="btn btn-principal"
                  href={`steam://run/${resultat.appId}`}
                >
                  Lancer
                </a>
                <Link className="btn" to={`/jeu/${resultat.appId}`}>
                  Voir la fiche
                </Link>
              </div>
            </div>
          </article>
        ) : (
          <p className="accueil-vide">
            Aucun jeu ne correspond à ces réglages. Élargis les filtres ou
            change de jeu de référence.
          </p>
        )}

        {erreur && <p className="accueil-erreur-inline">{erreur}</p>}
      </div>

      <DialoguePourquoi
        open={dialoguePourquoi}
        mode="menu"
        onFermer={() => setDialoguePourquoi(false)}
        selection={null}
        menu={menu}
      />

      <DialogueSources
        open={dialogueSources}
        onFermer={() => setDialogueSources(false)}
      />
    </section>
  )
}
