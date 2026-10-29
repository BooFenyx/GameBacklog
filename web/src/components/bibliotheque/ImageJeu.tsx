type Props = {
  src: string | null
  nom: string
}

/** Image 16:9 d'un jeu, avec repli dégradé + initiale si l'URL manque. */
export default function ImageJeu({ src, nom }: Props) {
  if (!src) {
    return (
      <span className="image-jeu image-jeu--vide" aria-hidden="true">
        {nom.slice(0, 1).toUpperCase()}
      </span>
    )
  }

  return (
    <img
      className="image-jeu"
      src={src}
      alt=""
      width="460"
      height="215"
      loading="lazy"
      decoding="async"
    />
  )
}
