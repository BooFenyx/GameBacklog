import { useState } from 'react'
import { useAuth } from '../auth/AuthContext'

const sections = [
  {
    titre: 'À relancer',
    texte: 'Tes jeux laissés en cours, reprends-les où tu t’étais arrêté.',
    etat: 'Aucun jeu importé pour le moment.',
  },
  {
    titre: 'À découvrir',
    texte: 'Les jeux de ta bibliothèque que tu n’as jamais lancés.',
    etat: 'Aucun jeu importé pour le moment.',
  },
  {
    titre: 'Proches de tes derniers jeux',
    texte: 'Des propositions calculées à partir de ce que tu viens de jouer.',
    etat: 'Arrive avec la recherche par similarité.',
  },
]

/** Page d'accueil, accessible une fois la session Steam ouverte. */
export default function Accueil() {
  const { user, refresh } = useAuth()
  const [verifieLe, setVerifieLe] = useState<string | null>(null)

  if (!user) return null

  const reVerifier = async () => {
    await refresh()
    setVerifieLe(new Date().toLocaleTimeString('fr-FR'))
  }

  return (
    <section className="accueil">
      <div className="accueil-tete">
        {user.avatarUrl && (
          <img
            className="avatar avatar-grand"
            src={user.avatarUrl}
            alt=""
            width="72"
            height="72"
          />
        )}
        <div>
          <p className="sur-titre">Bonjour</p>
          <h1>{user.displayName || 'Joueur Steam'}</h1>
        </div>
      </div>

      <div className="cartes">
        {sections.map((section) => (
          <article className="carte" key={section.titre}>
            <h2>{section.titre}</h2>
            <p>{section.texte}</p>
            <p className="carte-etat">{section.etat}</p>
          </article>
        ))}
      </div>

      <p className="accueil-import">
        L’import de ta bibliothèque Steam arrive à la prochaine étape : les
        sections ci-dessus se rempliront automatiquement.
      </p>

      <aside className="session">
        <h2>Session</h2>
        <dl>
          <div>
            <dt>Steam ID</dt>
            <dd>
              <code>{user.steamId}</code>
            </dd>
          </div>
          <div>
            <dt>Profil</dt>
            <dd>
              {user.profileUrl ? (
                <a href={user.profileUrl} target="_blank" rel="noreferrer">
                  Voir sur Steam
                </a>
              ) : (
                '—'
              )}
            </dd>
          </div>
        </dl>
        <p className="session-aide">
          La session est conservée 7 jours sur cet appareil : un
          rechargement de la page (ou un retour de Steam) te laisse connecté.
        </p>
        <button type="button" className="btn" onClick={() => void reVerifier()}>
          Re-vérifier la session
        </button>
        {verifieLe && (
          <p className="session-ok" role="status">
            Session confirmée à {verifieLe}.
          </p>
        )}
      </aside>
    </section>
  )
}
