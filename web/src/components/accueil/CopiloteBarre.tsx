import { useState, type FormEvent } from 'react'

const PRESETS: { demande: string; label: string }[] = [
  { demande: 'calme', label: 'Plus calme' },
  { demande: 'court', label: 'Plus court' },
  { demande: 'surprends', label: 'Surprends-moi' },
]

type Props = {
  message: string | null
  onDemande: (demande: string) => void
}

/**
 * Barre du copilote : presets et texte libre. Aucun LLM, aucun appel réseau
 * propre : la demande est traduite localement en réglages de sélection.
 */
export default function CopiloteBarre({ message, onDemande }: Props) {
  const [texte, setTexte] = useState('')

  const envoyer = (evenement: FormEvent<HTMLFormElement>): void => {
    evenement.preventDefault()
    const demande = texte.trim()
    if (!demande) return
    onDemande(demande)
    setTexte('')
  }

  return (
    <div className="accueil-copilote" role="group" aria-label="Copilote">
      <span className="accueil-copilote-invite">Une autre envie&nbsp;?</span>

      <div
        className="accueil-copilote-chips"
        role="group"
        aria-label="Demandes rapides au copilote"
      >
        {PRESETS.map((preset) => (
          <button
            key={preset.demande}
            type="button"
            className="accueil-copilote-chip"
            onClick={() => onDemande(preset.demande)}
          >
            {preset.label}
          </button>
        ))}
      </div>

      <form className="accueil-copilote-form" onSubmit={envoyer}>
        <label className="sr-only" htmlFor="accueil-copilote-champ">
          Demander un jeu au copilote
        </label>
        <input
          id="accueil-copilote-champ"
          type="text"
          maxLength={120}
          value={texte}
          onChange={(evenement) => setTexte(evenement.target.value)}
          placeholder="Ex. : plus calme, plus court…"
        />
        <button type="submit" aria-label="Envoyer la demande au copilote">
          →
        </button>
      </form>

      {message && (
        <p className="accueil-copilote-reponse" role="status">
          {message}
        </p>
      )}
    </div>
  )
}
