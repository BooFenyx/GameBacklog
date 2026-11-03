import { useEffect, useRef } from 'react'

type Props = {
  open: boolean
  onFermer: () => void
}

const LIGNES: { vu: string; source: string }[] = [
  {
    vu: 'Jeu du moment, temps de jeu, 14 derniers jours',
    source: 'Steam GetOwnedGames, persisté à l’import',
  },
  {
    vu: 'Genres, manette, image, description',
    source: 'Steam Store appdetails (l=french)',
  },
  {
    vu: 'Succès débloqués et total',
    source: 'GetPlayerAchievements et GetSchemaForGame',
  },
  {
    vu: 'Activité récente',
    source:
      'Dérivée localement : delta de temps de jeu, fenêtre de 14 jours, dernier succès',
  },
  {
    vu: 'Similarité entre jeux',
    source:
      'games.embedding, calculé à l’import avec Gemini puis lu en pgvector',
  },
  {
    vu: 'Temps disponible dans le menu',
    source:
      'Préférence de classement choisie par toi, pas une durée de session',
  },
  {
    vu: 'Dernière activité',
    source:
      'Une borne (« récemment », « ces 14 derniers jours »), jamais une date exacte',
  },
]

/** Provenance statique des données affichées sur l’accueil. */
export default function DialogueSources({ open, onFermer }: Props) {
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
      aria-labelledby="accueil-sources-titre"
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
          <p className="accueil-eyebrow">Transparence</p>
          <h2 id="accueil-sources-titre">D’où viennent ces données&nbsp;?</h2>
          <p>
            Tout ce qui est affiché vient de Steam ou d’un calcul local sur ces
            données.
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
        <table className="accueil-sources-table">
          <caption className="sr-only">
            Provenance de chaque information affichée sur la page
          </caption>
          <thead>
            <tr>
              <th scope="col">Ce que tu vois</th>
              <th scope="col">D’où ça vient</th>
            </tr>
          </thead>
          <tbody>
            {LIGNES.map((ligne) => (
              <tr key={ligne.vu}>
                <th scope="row">{ligne.vu}</th>
                <td>{ligne.source}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <p className="accueil-note">
          Aucun appel Steam ou Gemini n’est fait au chargement de l’accueil :
          tout est lu dans la base GameBacklog. Steam ne fournit pas la durée
          d’une session ni la date exacte de dernière partie pour une
          bibliothèque tierce : l’accueil ne les invente pas.
        </p>
      </div>
    </dialog>
  )
}
