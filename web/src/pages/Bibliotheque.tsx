import { useEffect, useState } from 'react'
import { urlApi } from '../api'

export type JeuBibliotheque = {
  appId: number
  name: string
  playtimeForever: number
  playtimeLast2Weeks: number
  lastPlayedAt: string | null
}

/** État du composant Bibliothèque. */
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
        const rawJeux = (await res.json()) as Array<{
          appId: number
          name: string
          playtimeForever: number
          playtimeLast2Weeks: number
          lastPlayedAt: string | null
        }>
        if (!actif) return
        const jeux = rawJeux.map((j) => ({
          appId: j.appId,
          name: j.name,
          playtimeForever: j.playtimeForever,
          playtimeLast2Weeks: j.playtimeLast2Weeks,
          lastPlayedAt: j.lastPlayedAt ?? null,
        }))
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
          <li key={jeu.appId}>
            <span className="jeu-nom">{jeu.name}</span>
            <span className="jeu-infos">
              {jeu.playtimeForever > 0 && `${jeu.playtimeForever} min`}
              {jeu.playtimeLast2Weeks > 0 && ` | ${jeu.playtimeLast2Weeks} min 2sem`}
              {jeu.lastPlayedAt && ` | joué le ${jeu.lastPlayedAt}`}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}