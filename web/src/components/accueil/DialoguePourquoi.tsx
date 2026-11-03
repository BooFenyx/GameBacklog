import { useEffect, useRef } from 'react'
import {
  raisonJeu,
  type HomeMenuResponse,
  type HomeMenuSignals,
  type HomeSelection,
} from '../../home'

type Props = {
  open: boolean
  mode: 'selection' | 'menu'
  onFermer: () => void
  selection: HomeSelection | null
  menu: HomeMenuResponse | null
}

const SIGNAUX: { cle: keyof HomeMenuSignals; label: string }[] = [
  { cle: 'continuite', label: 'Continuité' },
  { cle: 'progression', label: 'Progression' },
  { cle: 'decouverte', label: 'Découverte' },
  { cle: 'similarite', label: 'Similarité' },
  { cle: 'temps', label: 'Préférence de temps' },
  { cle: 'manette', label: 'Manette' },
]

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

/**
 * Dialogue de transparence. En mode sélection, il liste les cinq raisons ; en
 * mode menu, il affiche les signaux réels (jamais un score brut).
 */
export default function DialoguePourquoi({
  open,
  mode,
  onFermer,
  selection,
  menu,
}: Props) {
  const dialogueRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialogue = dialogueRef.current
    if (!dialogue) return
    if (open && !dialogue.open) dialogue.showModal()
    if (!open && dialogue.open) dialogue.close()
  }, [open])

  const titre = mode === 'selection' ? 'Pourquoi ces jeux ?' : 'Pourquoi ce jeu ?'
  const idTitre =
    mode === 'selection'
      ? 'accueil-pourquoi-titre-selection'
      : 'accueil-pourquoi-titre-menu'

  return (
    <dialog
      ref={dialogueRef}
      className="accueil-dialogue"
      aria-labelledby={idTitre}
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
          <p className="accueil-eyebrow">
            {mode === 'selection' ? 'La sélection du chef' : 'Le détail'}
          </p>
          <h2 id={idTitre}>{titre}</h2>
          <p>
            {mode === 'selection'
              ? 'Une proximité calculée à partir des données du jeu, pas d’un genre inventé.'
              : 'Les signaux réels derrière la proposition, sans score brut.'}
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
        {mode === 'selection' && selection && (
          <>
            <p>
              Cinq voisins de <strong>{selection.anchor?.name ?? 'ton jeu'}</strong>,
              classés par proximité. Aucun jeu hors de ta bibliothèque.
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
                Chaque jeu possède un <em>embedding</em> calculé à l’import à
                partir de son nom, de sa description, de ses genres et de ses
                catégories. Une distance cosinus classe les plus proches. La
                similarité vient de <code>games.embedding</code>{' '}
                (<code>gemini-embedding-001</code>, 1 024 dimensions) et de la
                distance pgvector <code>&lt;=&gt;</code>. Aucun nouvel appel
                n’est fait au chargement de l’accueil.
              </p>
              <p>
                Le genre principal est un <strong>bonus de score</strong>, jamais
                un filtre strict. « Roguelike » n’est pas un genre Steam : Hades
                est <code>Action · Indépendant · RPG</code>, et le mot vient de
                sa description, donc de l’embedding.
              </p>
            </details>
          </>
        )}

        {mode === 'menu' && menu?.resultat && menu.signals && (
          <>
            <p>
              <strong>{menu.resultat.name}</strong> — {menu.resultat.reason}
            </p>
            <ul className="accueil-pourquoi-liste">
              {SIGNAUX.map((signal) => (
                <li key={signal.cle}>
                  <strong>{signal.label}</strong>
                  <span>{menu.signals?.[signal.cle]}</span>
                </li>
              ))}
            </ul>
            <p className="accueil-note">
              Aucun score brut n’est affiché : seules les raisons lisibles le
              sont. Le temps choisi est une préférence de classement, pas une
              durée de session.
            </p>
          </>
        )}

        {mode === 'menu' && (!menu?.resultat || !menu.signals) && (
          <p className="accueil-note">
            Aucun résultat à expliquer pour ces réglages.
          </p>
        )}
      </div>
    </dialog>
  )
}
