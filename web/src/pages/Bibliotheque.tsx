import { useEffect, useState } from 'react'
import { urlApi } from '../api'

export type JeuBibliotheque = {
  appId: number
  name: string
}

type Etat =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; jeux: JeuBibliotheque[] }

/** Page bibliothèque : liste des noms des jeux possédés, depuis `GET /api/library`. */
export default function Bibliotheque() {
  const [etat, setEtat] = useState<Etat>({ statut: 'chargement' })

  useEffect(() => {
    let actif = true
    void (async () => {
      try {
        const res = await fetch(urlApi('/api/library'), {
          credentials: 'include',
        })
        if (!res.ok) {
          const corps = (await res.json().catch(() => null)) as {
            message?: string
          } | null
          throw new Error(corps?.message ?? `Réponse ${res.status}`)
        }
        const jeux = (await res.json()) as JeuBibliotheque[]
        if (!actif) return
        setEtat({ statut: 'pret', jeux })
      } catch (error) {
        if (!actif) return
        setEtat({
          statut: 'erreur',
          message:
            error instanceof Error
              ? error.message
              : 'Impossible de récupérer la bibliothèque.',
        })
      }
    })()
    return () => {
      actif = false
    }
  }, [])

  if (etat.statut === 'chargement') {
    return <p className="chargement">Import de la bibliothèque…</p>
  }

  if (etat.statut === 'erreur') {
    return (
      <section className="bibliotheque bibliotheque-erreur">
        <h1>Bibliothèque</h1>
        <p className="message-erreur">{etat.message}</p>
      </section>
    )
  }

  return (
    <section className="bibliotheque">
      <div className="bibliotheque-tete">
        <h1>Bibliothèque</h1>
        <p className="bibliotheque-compte">
          {etat.jeux.length} jeu{etat.jeux.length > 1 ? 'x' : ''}
        </p>
      </div>

      <ul className="liste-jeux">
        {etat.jeux.map((jeu) => (
          <li key={jeu.appId}>{jeu.name}</li>
        ))}
      </ul>
    </section>
  )
}