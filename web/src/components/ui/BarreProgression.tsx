type Props = {
  valeur: number
  max?: number
  label: string
  className?: string
}

/** Barre de progression accessible, utilisée pour les succès. */
export default function BarreProgression({
  valeur,
  max = 100,
  label,
  className,
}: Props) {
  const borne = Math.max(0, Math.min(valeur, max))
  const pourcentage = max > 0 ? (borne / max) * 100 : 0

  return (
    <div
      className={className ? `barre-progression ${className}` : 'barre-progression'}
      role="progressbar"
      aria-label={label}
      aria-valuenow={borne}
      aria-valuemin={0}
      aria-valuemax={max}
    >
      <span style={{ width: `${pourcentage}%` }} />
    </div>
  )
}
