import {
  useEffect,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  SELECTION_DEFAUT,
  chargerSelection,
  metaJeu,
  parametresDepuisSelection,
  raisonJeu,
  sousTitreSelection,
  titreSelection,
  type HomeGame,
  type HomeSelection,
  type ParametresSelection,
} from '../../home'
import type { Facettes } from '../../library'
import { IconeFiltre } from '../ui/Icones'
import CarteSelection from './CarteSelection'
import DialogueAffiner from './DialogueAffiner'
import DialogueAncre from './DialogueAncre'
import DialoguePourquoi from './DialoguePourquoi'

const DUREE_ANIMATION_MS = 430
const SEUIL_CLIC_MS = 250

type VariablesGlisse = CSSProperties & {
  '--glisse'?: string
  '--glisse-rot'?: string
  '--glisse-progress'?: string
}

type Props = {
  selectionInitial: HomeSelection
  facettes: Facettes | null
}

type PropsDeck = {
  items: HomeGame[]
  nomAncre: string
}

/** Signature stable des réglages : remonte le deck quand la sélection change. */
function signature(selection: HomeSelection): string {
  return [
    selection.anchor?.appId ?? 'none',
    selection.genre?.id ?? 'none',
    selection.decouverte,
    selection.manette ? 'manette' : '',
    selection.lancement,
    selection.progression ? 'progression' : '',
    selection.items.map((jeu) => jeu.appId).join('-'),
  ].join('|')
}

/**
 * Deck portrait : flèches, clavier, points et glissement tactile/souris.
 * La carte de devant seule est interactive (`inert` sur les autres), et les
 * animations sont verrouillées ~430 ms pour éviter les chevauchements.
 */
function Deck({ items, nomAncre }: PropsDeck) {
  const [index, setIndex] = useState(0)
  const [sens, setSens] = useState<'suivant' | 'precedent' | null>(null)
  const [glisse, setGlisse] = useState<{
    dx: number
    progress: number
  } | null>(null)
  const deckRef = useRef<HTMLDivElement>(null)
  const verrou = useRef(false)
  const timer = useRef<number | null>(null)
  const glisseRef = useRef<{
    id: number
    x: number
    y: number
    dx: number
  } | null>(null)
  const ignorerClic = useRef(false)
  const terminerRef = useRef<(evenement?: { pointerId?: number }) => void>(
    () => undefined,
  )

  const total = items.length
  const courant = items[index]

  const seuilGlisse = (): number => {
    const largeur = deckRef.current?.clientWidth ?? 320
    return Math.max(50, Math.min(90, largeur * 0.2))
  }

  const allerA = (cible: number, direction?: 1 | -1): void => {
    if (verrou.current || total === 0) return
    const destination = ((cible % total) + total) % total
    if (destination === index) return

    let sensChoisi = direction
    if (!sensChoisi) {
      const delta = (destination - index + total) % total
      sensChoisi = delta > total / 2 ? -1 : 1
    }

    verrou.current = true
    setSens(sensChoisi < 0 ? 'precedent' : 'suivant')
    setIndex(destination)

    if (timer.current !== null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      setSens(null)
      verrou.current = false
      timer.current = null
    }, DUREE_ANIMATION_MS)
  }

  const changer = (delta: 1 | -1): void => {
    allerA(index + delta, delta)
  }

  const clicFleche = (delta: 1 | -1): void => {
    if (ignorerClic.current) return
    changer(delta)
  }

  const surTouche = (evenement: KeyboardEvent<HTMLDivElement>): void => {
    if (evenement.key === 'ArrowLeft') {
      evenement.preventDefault()
      changer(-1)
    } else if (evenement.key === 'ArrowRight') {
      evenement.preventDefault()
      changer(1)
    }
  }

  const demarrerGlisse = (evenement: ReactPointerEvent<HTMLDivElement>): void => {
    if (verrou.current) return
    if (evenement.button !== 0) return
    const cible = evenement.target
    if (!(cible instanceof Element)) return
    if (cible.closest('a, button')) return
    if (!cible.closest('.accueil-deck-carte[data-position="0"]')) return

    // Évite la sélection de texte et le drag natif de l'image pendant le geste.
    evenement.preventDefault()
    window.getSelection()?.removeAllRanges()

    glisseRef.current = {
      id: evenement.pointerId,
      x: evenement.clientX,
      y: evenement.clientY,
      dx: 0,
    }
    setGlisse({ dx: 0, progress: 0 })
    try {
      deckRef.current?.setPointerCapture(evenement.pointerId)
    } catch {
      /* pointeur déjà relâché */
    }
  }

  const deplacerGlisse = (evenement: ReactPointerEvent<HTMLDivElement>): void => {
    const geste = glisseRef.current
    if (!geste || evenement.pointerId !== geste.id) return

    const dx = evenement.clientX - geste.x
    const dy = evenement.clientY - geste.y
    if (Math.abs(dx) > Math.abs(dy)) {
      geste.dx = dx
      setGlisse({
        dx,
        progress: Math.min(1, Math.abs(dx) / seuilGlisse()),
      })
    }
  }

  const terminerGlisse = (evenement?: { pointerId?: number }): void => {
    const geste = glisseRef.current
    if (!geste) return
    if (
      evenement?.pointerId !== undefined &&
      evenement.pointerId !== geste.id
    ) {
      return
    }

    const dx = geste.dx
    glisseRef.current = null
    setGlisse(null)

    try {
      if (deckRef.current?.hasPointerCapture(geste.id)) {
        deckRef.current.releasePointerCapture(geste.id)
      }
    } catch {
      /* pointeur déjà relâché */
    }

    // Un geste qui se termine sur une flèche ne doit pas déclencher son clic.
    if (Math.abs(dx) > 8) {
      ignorerClic.current = true
      window.setTimeout(() => {
        ignorerClic.current = false
      }, SEUIL_CLIC_MS)
    }

    if (Math.abs(dx) > seuilGlisse()) {
      changer(dx < 0 ? 1 : -1)
    }
  }

  useEffect(() => {
    terminerRef.current = terminerGlisse
  })

  useEffect(() => {
    const finir = (evenement: PointerEvent): void => {
      terminerRef.current(evenement)
    }
    window.addEventListener('pointerup', finir)
    window.addEventListener('pointercancel', finir)
    return () => {
      window.removeEventListener('pointerup', finir)
      window.removeEventListener('pointercancel', finir)
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [])

  const styleDeck: VariablesGlisse | undefined =
    glisse === null
      ? undefined
      : {
          '--glisse': `${glisse.dx}px`,
          '--glisse-rot': `${glisse.dx / 28}deg`,
          '--glisse-progress': String(glisse.progress),
        }

  const classes = ['accueil-deck']
  if (sens) classes.push(`accueil-deck--${sens}`)
  if (glisse !== null) classes.push('accueil-deck--glisse')

  const annonce = courant
    ? `${courant.name}. ${raisonJeu(courant, nomAncre)}. ${metaJeu(
        courant,
      )}. ${index + 1} sur ${total}.`
    : ''

  return (
    <>
      <div className="accueil-deck-scene">
        <button
          type="button"
          className="accueil-deck-fleche"
          aria-label="Jeu précédent"
          onClick={() => clicFleche(-1)}
        >
          <span aria-hidden="true">‹</span>
        </button>

        <div
          ref={deckRef}
          className={classes.join(' ')}
          style={styleDeck}
          data-sens={glisse !== null && glisse.dx < 0 ? 'gauche' : undefined}
          tabIndex={0}
          role="group"
          aria-roledescription="carrousel"
          aria-label="Sélection du chef"
          aria-keyshortcuts="ArrowLeft ArrowRight"
          onKeyDown={surTouche}
          onDragStart={(evenement) => evenement.preventDefault()}
          onPointerDown={demarrerGlisse}
          onPointerMove={deplacerGlisse}
          onPointerUp={terminerGlisse}
          onPointerCancel={terminerGlisse}
        >
          {items.map((jeu, position) => (
            <CarteSelection
              key={jeu.appId}
              jeu={jeu}
              nomAncre={nomAncre}
              position={(position - index + total) % total}
            />
          ))}
        </div>

        <button
          type="button"
          className="accueil-deck-fleche"
          aria-label="Jeu suivant"
          onClick={() => clicFleche(1)}
        >
          <span aria-hidden="true">›</span>
        </button>
      </div>

      <div className="accueil-deck-pied">
        <span className="accueil-deck-compteur">
          {String(index + 1).padStart(2, '0')} /{' '}
          {String(total).padStart(2, '0')}
        </span>

        <div
          className="accueil-deck-points"
          role="group"
          aria-label="Choisir un jeu de la sélection"
        >
          {items.map((jeu, position) => {
            const actif = position === index
            return (
              <button
                key={jeu.appId}
                type="button"
                className={`accueil-deck-point${actif ? ' actif' : ''}`}
                aria-label={`Voir ${jeu.name} (${position + 1} sur ${total})`}
                aria-current={actif ? 'true' : undefined}
                onClick={() => {
                  if (ignorerClic.current) return
                  allerA(position)
                }}
              />
            )
          })}
        </div>

        <span className="accueil-deck-aide">Glisse ou utilise les flèches.</span>
      </div>

      <p className="sr-only" aria-live="polite" aria-atomic="true">
        {annonce}
      </p>
    </>
  )
}

/**
 * Sélection du chef : en-tête, deck portrait, panneau Affiner et changement
 * d'ancre. Chaque réglage relance `/api/home/selection` ; l'ancien deck reste
 * affiché pendant le calcul (débounce 150 ms + AbortController).
 */
export default function SelectionChef({
  selectionInitial,
  facettes,
}: Props) {
  const [parametres, setParametres] = useState<ParametresSelection>(() =>
    parametresDepuisSelection(selectionInitial),
  )
  const [selection, setSelection] = useState(selectionInitial)
  const [chargement, setChargement] = useState(false)
  const [erreur, setErreur] = useState<string | null>(null)
  const [reessai, setReessai] = useState(0)
  const [dialogueAncre, setDialogueAncre] = useState(false)
  const [dialogueAffiner, setDialogueAffiner] = useState(false)
  const [dialoguePourquoi, setDialoguePourquoi] = useState(false)
  const premierRendu = useRef(true)
  const selectionRef = useRef(selection)

  useEffect(() => {
    selectionRef.current = selection
  })

  useEffect(() => {
    if (premierRendu.current) {
      premierRendu.current = false
      return
    }

    const controller = new AbortController()
    const timer = window.setTimeout(() => {
      setChargement(true)
      void chargerSelection(parametres, controller.signal)
        .then((reponse) => {
          if (controller.signal.aborted) return
          setSelection(reponse)
          setErreur(null)
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return
          const message =
            error instanceof Error
              ? error.message
              : 'Impossible de recalculer la sélection.'
          if (message.includes('introuvable')) {
            // Revenir au jeu du moment. Ne jamais réécrire la même ancre :
            // cela relancerait la requête en boucle toutes les 150 ms.
            setParametres((actuels) =>
              actuels.anchor === null ? actuels : { ...actuels, anchor: null },
            )
            setErreur(
              'Ce jeu de référence n’est plus disponible. Retour au jeu du moment.',
            )
          } else {
            setErreur(message)
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) setChargement(false)
        })
    }, 150)

    return () => {
      controller.abort()
      window.clearTimeout(timer)
    }
  }, [parametres, reessai])

  const changerReglages = (partiel: Partial<ParametresSelection>): void => {
    setParametres((actuels) => ({ ...actuels, ...partiel }))
  }

  const choisirAncre = (appId: number): void => {
    setParametres((actuels) => ({
      ...actuels,
      anchor: appId,
      genreId: null,
    }))
  }

  const reinitialiser = (): void => {
    setParametres({
      ...SELECTION_DEFAUT,
      anchor: selectionRef.current.anchor?.appId ?? null,
    })
  }

  const nomAncre = selection.anchor?.name ?? 'ton jeu du moment'

  return (
    <section
      className="accueil-selection"
      aria-labelledby="titre-selection"
      aria-busy={chargement}
    >
      <div className="accueil-section-entete">
        <header className="accueil-section-tete">
          <p className="accueil-eyebrow">Sélection du chef</p>
          <h2 id="titre-selection">{titreSelection(selection)}</h2>
          <p className="accueil-sous-titre">{sousTitreSelection(selection)}</p>
        </header>

        <div className="accueil-section-actions">
          <button
            type="button"
            className="accueil-lien"
            onClick={() => setDialoguePourquoi(true)}
          >
            Pourquoi ces jeux&nbsp;?
          </button>
        </div>
      </div>

      {chargement && (
        <p className="accueil-note" role="status">
          Mise à jour de la sélection…
        </p>
      )}

      {erreur && (
        <div className="accueil-erreur-selection">
          <p className="accueil-erreur-inline">{erreur}</p>
          <button
            type="button"
            className="btn"
            onClick={() => setReessai((valeur) => valeur + 1)}
          >
            Réessayer
          </button>
        </div>
      )}

      {selection.items.length === 0 ? (
        <p className="accueil-vide">
          Aucun jeu ne correspond à ces réglages. Élargis les filtres ou change
          de jeu de référence.
        </p>
      ) : (
        <Deck
          key={signature(selection)}
          items={selection.items}
          nomAncre={nomAncre}
        />
      )}

      <div className="accueil-actions-selection">
        <button
          type="button"
          className="btn btn-principal accueil-action-principale"
          onClick={() => setDialogueAffiner(true)}
        >
          <IconeFiltre /> Affiner la sélection
        </button>
        <button
          type="button"
          className="btn accueil-action-secondaire"
          onClick={() => setDialogueAncre(true)}
        >
          Changer de jeu
        </button>
      </div>

      <DialogueAncre
        open={dialogueAncre}
        anchorActuel={selection.anchor?.appId ?? null}
        onFermer={() => setDialogueAncre(false)}
        onChoisir={choisirAncre}
      />

      <DialogueAffiner
        open={dialogueAffiner}
        onFermer={() => setDialogueAffiner(false)}
        facettes={facettes}
        selection={selection}
        parametres={parametres}
        onChanger={changerReglages}
        onReinitialiser={reinitialiser}
      />

      <DialoguePourquoi
        open={dialoguePourquoi}
        onFermer={() => setDialoguePourquoi(false)}
        selection={selection}
      />
    </section>
  )
}
