import { useRef, useState } from 'react'
import type { CaptureEcran } from '../../games'

type Props = {
  captures: CaptureEcran[]
  nom: string
}

/** Galerie de captures avec dialogue plein écran. */
export default function GalerieJeu({ captures, nom }: Props) {
  const dialogue = useRef<HTMLDialogElement>(null)
  const [active, setActive] = useState<CaptureEcran | null>(null)

  if (captures.length === 0) return null

  const ouvrir = (capture: CaptureEcran) => {
    setActive(capture)
    dialogue.current?.showModal()
  }

  const fermer = () => dialogue.current?.close()

  return (
    <section className="fiche-section" aria-labelledby="titre-galerie">
      <h2 className="titre-section" id="titre-galerie">
        Captures d'écran
      </h2>

      <div className="galerie">
        {captures.map((capture, index) => (
          <button
            key={capture.pleine}
            type="button"
            className="galerie-item"
            onClick={() => ouvrir(capture)}
            aria-label={`Agrandir la capture ${index + 1} de ${nom}`}
          >
            <img
              src={capture.miniature}
              alt={`Capture d'écran ${index + 1} de ${nom}`}
              loading="lazy"
              decoding="async"
              onError={(event) => {
                event.currentTarget.style.display = 'none'
              }}
            />
          </button>
        ))}
      </div>

      <dialog
        ref={dialogue}
        className="dialog-capture"
        aria-label={`Capture d'écran de ${nom}`}
        onClick={(event) => {
          if (event.target === event.currentTarget) fermer()
        }}
      >
        <button
          type="button"
          className="dialog-fermer"
          aria-label="Fermer la capture"
          onClick={fermer}
        >
          ×
        </button>
        {active && (
          <img src={active.pleine} alt={`Capture d'écran de ${nom}`} />
        )}
        <p className="dialog-legende">Capture d'écran de {nom}</p>
      </dialog>
    </section>
  )
}
