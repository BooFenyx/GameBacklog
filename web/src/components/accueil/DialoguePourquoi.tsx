import { useEffect, useRef } from 'react'
import { raisonJeu, type HomeSelection } from '../../home'

type Props = {
  open: boolean
  onFermer: () => void
  selection: HomeSelection
}

function resumeSelection(selection: HomeSelection): string {
  const morceaux = [
    selection.genre
      ? `priorité ${selection.genre.label}`
      : 'sans genre prioritaire',
    `découverte ${selection.decouverte} %`,
    selection.manette ? 'manette' : 'sans manette',
    selection.lancement === 'deja'
      ? 'déjà lancés'
      : selection.lancement === 'jamais'
        ? 'jamais lancés'
        : 'tous les jeux',
  ]
  if (selection.progression) morceaux.push('proches du 100 %')
  return morceaux.join(' · ')
}

/** Dialogue « Pourquoi ces jeux ? » : raisons du deck, sans score brut. */
export default function DialoguePourquoi({
  open,
  onFermer,
  selection,
}: Props) {
  const dialogueRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogue = dialogueRef.current
    if (!dialogue) return
    if (open && !dialogue.open) dialogue.showModal()
    if (!open && dialogue.open) dialogue.close()
  }, [open])

  return (
    <dialog
      ref={dialogueRef}
      className="accueil-dialogue"
      aria-labelledby="accueil-pourquoi-titre"
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
          <p className="accueil-eyebrow">La sélection du chef</p>
          <h2 id="accueil-pourquoi-titre">Pourquoi ces jeux&nbsp;?</h2>
          <p>
            Une proximité calculée à partir des données du jeu, pas d’un genre
            inventé.
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
        <p>
          Cinq voisins de{' '}
          <strong>{selection.anchor?.name ?? 'ton jeu'}</strong>, classés par
          proximité. Aucun jeu hors de ta bibliothèque.
        </p>
        <p className="accueil-note">{resumeSelection(selection)}</p>
        <ul className="accueil-pourquoi-liste">
          {selection.items.map((jeu) => (
            <li key={jeu.appId}>
              <strong>{jeu.name}</strong>
              <span>
                {raisonJeu(jeu, selection.anchor?.name ?? 'ton jeu')}
              </span>
            </li>
          ))}
        </ul>
        <details className="accueil-note-technique">
          <summary>Comment c’est calculé ?</summary>
          <p>
            Chaque jeu possède un <em>embedding</em> calculé à l’import à partir
            de son nom, de sa description, de ses genres et de ses catégories.
            Une distance cosinus classe les plus proches. La similarité vient de{' '}
            <code>games.embedding</code> (<code>gemini-embedding-001</code>, 1 024
            dimensions) et de la distance pgvector <code>&lt;=&gt;</code>. Aucun
            nouvel appel n’est fait au chargement de l’accueil.
          </p>
          <p>
            Le genre principal est un <strong>bonus de score</strong>, jamais un
            filtre strict. « Roguelike » n’est pas un genre Steam : Hades est{' '}
            <code>Action · Indépendant · RPG</code>, et le mot vient de sa
            description, donc de l’embedding.
          </p>
        </details>
      </div>
    </dialog>
  )
}
