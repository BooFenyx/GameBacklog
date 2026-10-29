import type { DescriptionBlock } from '../../games'

type Props = {
  blocs: DescriptionBlock[]
  descriptionCourte: string | null
}

/** Description longue convertie en blocs sûrs, avec repli sur la courte. */
export default function DescriptionJeu({ blocs, descriptionCourte }: Props) {
  if (blocs.length === 0 && !descriptionCourte) return null

  return (
    <section className="fiche-section" aria-labelledby="titre-description">
      <h2 className="titre-section" id="titre-description">
        À propos du jeu
      </h2>
      <div className="description">
        {blocs.length > 0
          ? blocs.map((bloc, index) => {
              if (bloc.type === 'titre') {
                return <h3 key={index}>{bloc.texte}</h3>
              }
              if (bloc.type === 'liste') {
                return (
                  <ul key={index}>
                    {bloc.items.map((item, itemIndex) => (
                      <li key={itemIndex}>{item}</li>
                    ))}
                  </ul>
                )
              }
              return <p key={index}>{bloc.texte}</p>
            })
          : descriptionCourte && <p>{descriptionCourte}</p>}
      </div>
    </section>
  )
}
