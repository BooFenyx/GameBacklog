import type { ReactNode } from 'react'

export type VarianteEtiquette =
  | 'genre'
  | 'mode'
  | 'solo'
  | 'manette'
  | 'succes'
  | 'etat'
  | 'etat-recent'

type Props = {
  variante?: VarianteEtiquette
  className?: string
  title?: string
  children: ReactNode
}

/** Petite étiquette partagée par les cartes, la vue liste et la fiche. */
export default function Etiquette({
  variante = 'genre',
  className,
  title,
  children,
}: Props) {
  const classes = ['etiquette']
  if (variante === 'etat-recent') {
    classes.push('etiquette--etat', 'etiquette--etat-recent')
  } else {
    classes.push(`etiquette--${variante}`)
  }
  if (className) classes.push(className)

  return (
    <span className={classes.join(' ')} title={title}>
      {children}
    </span>
  )
}
