import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { urlApi } from '../api'
import { formaterDate, formaterDuree } from '../format'

type Succes = {
  apiName: string
  displayName: string
  description: string | null
  iconUrl: string | null
  unlockedAt: string | null
}

type FicheJeu = {
  appId: number
  name: string
  shortDescription: string | null
  genres: string[]
  categories: string[]
  controllerSupport: 'none' | 'partial' | 'full'
  releaseDate: string | null
  headerImageUrl: string | null
  playtimeForever: number
  playtimeLast2Weeks: number
  lastPlayedAt: string | null
  achievementsUnlocked: number
  achievements: { total: number; unlocked: number; list: Succes[] }
  steamUrl: string
}

type Etat =
  | { statut: 'chargement' }
  | { statut: 'erreur'; message: string }
  | { statut: 'pret'; jeu: FicheJeu }

const LIBELLE_MANETTE: Record<FicheJeu['controllerSupport'], string> = {
  none: 'Manette non supportée',
  partial: 'Manette partielle',
  full: 'Manette complète',
}

/** Page détail d'un jeu : fiche `GET /api/games/:appId` + succès et temps de jeu. */
export default function JeuDetail() {
  const { appId } = useParams<{ appId: string }>()
  const [etat, setEtat] = useState<Etat>({ statut: 'chargement' })

  useEffect(() => {
    let actif = true
    if (!appId) return
    void (async () => {
      try {
        const res = await fetch(urlApi(`/api/games/${appId}`), {
          credentials: 'include',
        })
        if (!res.ok) {
          const corps = (await res.json().catch(() => null)) as {
            message?: string
          } | null
          throw new Error(corps?.message ?? `Réponse ${res.status}`)
        }
        const jeu = (await res.json()) as FicheJeu
        if (actif) setEtat({ statut: 'pret', jeu })
      } catch (error) {
        if (!actif) return
        setEtat({
          statut: 'erreur',
          message:
            error instanceof Error
              ? error.message
              : 'Impossible de récupérer la fiche du jeu.',
        })
      }
    })()
    return () => {
      actif = false
    }
  }, [appId])

  // L'URL ne matche la route que si un `appId` est présent ; ce garde-fou
  // couvre le cas d'une navigation programmée vers une route sans paramètre.
  if (!appId) {
    return (
      <section className="detail">
        <h1>Fiche du jeu</h1>
        <p className="message-erreur">Identifiant de jeu manquant.</p>
        <Link className="btn" to="/bibliotheque">
          Retour à la bibliothèque
        </Link>
      </section>
    )
  }

  if (etat.statut === 'chargement') {
    return <p className="chargement">Chargement de la fiche…</p>
  }

  if (etat.statut === 'erreur') {
    return (
      <section className="detail">
        <h1>Fiche du jeu</h1>
        <p className="message-erreur">{etat.message}</p>
        <Link className="btn" to="/bibliotheque">
          Retour à la bibliothèque
        </Link>
      </section>
    )
  }

  const { jeu } = etat
  const dureeTotale = formaterDuree(jeu.playtimeForever)

  return (
    <section className="detail">
      {jeu.headerImageUrl && (
        <img
          className="detail-image"
          src={jeu.headerImageUrl}
          alt=""
          width="616"
          height="353"
        />
      )}

      <div className="detail-tete">
        <h1>{jeu.name}</h1>
        <Link className="btn" to="/bibliotheque">
          ← Bibliothèque
        </Link>
      </div>

      {jeu.shortDescription && (
        <p className="detail-description">{jeu.shortDescription}</p>
      )}

      <dl className="detail-infos">
        <div>
          <dt>Genres</dt>
          <dd>
            {jeu.genres.length > 0 ? jeu.genres.join(', ') : '—'}
          </dd>
        </div>
        <div>
          <dt>Caractéristiques</dt>
          <dd>{jeu.categories.length > 0 ? jeu.categories.join(', ') : '—'}</dd>
        </div>
        <div>
          <dt>Manette</dt>
          <dd>{LIBELLE_MANETTE[jeu.controllerSupport]}</dd>
        </div>
        {jeu.releaseDate && (
          <div>
            <dt>Sortie</dt>
            <dd>{formaterDate(jeu.releaseDate)}</dd>
          </div>
        )}
        <div>
          <dt>Temps de jeu</dt>
          <dd>
            {dureeTotale}
            {jeu.playtimeLast2Weeks > 0 &&
              ` (dont ${formaterDuree(jeu.playtimeLast2Weeks)} sur les 2 dernières semaines)`}
          </dd>
        </div>
        {jeu.lastPlayedAt && (
          <div>
            <dt>Dernière partie</dt>
            <dd>{formaterDate(jeu.lastPlayedAt)}</dd>
          </div>
        )}
      </dl>

      <div className="detail-actions">
        <a className="btn btn-principal" href={jeu.steamUrl}>
          Lancer sur Steam
        </a>
      </div>

      <div className="detail-succes">
        <h2>
          Succès — {jeu.achievements.unlocked}/{jeu.achievements.total}
        </h2>
        {jeu.achievements.list.length === 0 ? (
          <p>Aucun succès public pour ce jeu.</p>
        ) : (
          <ul className="liste-succes">
            {jeu.achievements.list.map((succes) => (
              <li
                key={succes.apiName}
                className={succes.unlockedAt ? 'succes-debloque' : 'succes-verrouille'}
              >
                {succes.iconUrl && (
                  <img src={succes.iconUrl} alt="" width="32" height="32" />
                )}
                <span className="succes-texte">
                  <strong>{succes.displayName}</strong>
                  {succes.description && (
                    <em>{succes.description}</em>
                  )}
                  {succes.unlockedAt && (
                    <small>Débloqué le {formaterDate(succes.unlockedAt)}</small>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  )
}