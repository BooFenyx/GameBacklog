import type { ReactNode } from 'react'

export type VarianteEtiquette =
  | 'genre'
  | 'mode'
  | 'solo'
  | 'manette'
  | 'succes'
  | 'succes-complet'

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
  if (variante === 'succes-complet') {
    classes.push('etiquette--succes', 'etiquette--succes-complet')
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
