import { useEffect, useRef, useState } from 'react'
import { FILTRES_VIDES } from '../../filters'
import { chargerBibliotheque, type JeuBibliotheque } from '../../library'
import ImageJeu from '../bibliotheque/ImageJeu'

type Props = {
  open: boolean
  anchorActuel: number | null
  onFermer: () => void
  onChoisir: (appId: number) => void
}

/**
 * « Changer de jeu » : recherche l'ancre dans `/api/library`, avec un debounce
 * de 250 ms. Aucun nouvel endpoint : la bibliothèque expose déjà `q` et `tri`.
 */
export default function DialogueAncre({
  open,
  anchorActuel,
  onFermer,
  onChoisir,
}: Props) {
  const [q, setQ] = useState('')
  const [resultats, setResultats] = useState<JeuBibliotheque[]>([])
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const dialogueRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogue = dialogueRef.current
    if (!dialogue) return
    if (open && !dialogue.open) dialogue.showModal()
    if (!open && dialogue.open) dialogue.close()
  }, [open])

  useEffect(() => {
    if (!open) return

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setChargement(true)
      void chargerBibliotheque(
        { ...FILTRES_VIDES, q, tri: 'recent' },
        0,
        controller.signal,
        20,
      )
        .then((page) => {
          if (controller.signal.aborted) return
          setResultats(page.items)
          setErreur(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          setErreur(
            error instanceof Error
              ? error.message
              : 'Impossible de chercher dans la bibliothèque.',
          )
        })
        .finally(() => {
          if (!controller.signal.aborted) setChargement(false)
        })
    }, 250)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [open, q])

  return (
    <dialog
      ref={dialogueRef}
      className="accueil-dialogue"
      aria-labelledby="accueil-ancre-titre"
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
          <p className="accueil-eyebrow">Changer de jeu</p>
          <h2 id="accueil-ancre-titre">Sur quel jeu se baser&nbsp;?</h2>
          <p>
            Choisis n’importe quel jeu de ta bibliothèque. La sélection se
            recalcule autour de lui.
          </p>
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
        <input
          className="accueil-dialogue-recherche"
          type="search"
          value={q}
          onChange={(evenement) => setQ(evenement.target.value)}
          placeholder="Rechercher un jeu…"
          aria-label="Rechercher un jeu dans la bibliothèque"
        />

        {erreur && <p className="accueil-erreur-inline">{erreur}</p>}
        {chargement && <p className="accueil-note">Recherche…</p>}

        <ul className="accueil-ancre-liste">
          {resultats.map((jeu) => {
            const actif = jeu.appId === anchorActuel
            return (
              <li key={jeu.appId}>
                <button
                  type="button"
                  className={`accueil-ancre-option${actif ? ' actif' : ''}`}
                  aria-current={actif ? 'true' : undefined}
                  onClick={() => {
                    onChoisir(jeu.appId)
                    onFermer()
                  }}
                >
                  <span className="accueil-ancre-media">
                    <ImageJeu src={jeu.headerImageUrl} nom={jeu.name} />
                  </span>
                  <span className="accueil-ancre-texte">
                    <strong>{jeu.name}</strong>
                    <small>{jeu.genres.slice(0, 3).join(' · ')}</small>
                  </span>
                  <span className="accueil-ancre-fleche" aria-hidden="true">
                    →
                  </span>
                </button>
              </li>
            )
          })}
        </ul>

        {!chargement && !erreur && resultats.length === 0 && q.trim().length > 0 && (
          <p className="accueil-note">Aucun jeu trouvé.</p>
        )}
      </div>
    </dialog>
  )
}
