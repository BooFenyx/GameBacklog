/** Puce d'un filtre actif, avec bouton de retrait accessible. */
export default function PuceFiltre({
  label,
  onRetirer,
}: {
  label: string
  onRetirer: () => void
}) {
  return (
    <span className="puce-filtre">
      {label}
      <button
        type="button"
        className="puce-filtre-retirer"
        aria-label={`Retirer le filtre ${label}`}
        onClick={onRetirer}
      >
        ×
      </button>
    </span>
  )
}
