import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useSearchParams,
} from 'react-router-dom'
import { useEffect } from 'react'
import { useAuth } from '../auth/AuthContext'
import BarreRecherche from './BarreRecherche'

/**
 * Coquille commune à toutes les routes : barre de navigation, état de la
 * session et bandeau du résultat de la redirection Steam (`?auth=...`).
 *
 * Le bandeau est dérivé de l'URL, sans état ni effet : le paramètre `auth`
 * reste dans l'adresse tant qu'on ne l'efface pas (bouton « × » ou
 * navigation), ce qui évite de perdre le message pendant la redirection
 * interne vers `/accueil`.
 */
export default function RootLayout() {
  const { user, loading, login, logout } = useAuth()
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()

  useEffect(() => {
    window.scrollTo(0, 0)
  }, [location.pathname])

  useEffect(() => {
    const titres: Record<string, string> = {
      '/accueil': 'Accueil',
      '/bibliotheque': 'Bibliothèque',
      '/recherche': 'Recherche',
      '/confidentialite': 'Confidentialité',
    }
    const section = location.pathname.startsWith('/jeu/')
      ? 'Fiche de jeu'
      : titres[location.pathname]
    document.title = section
      ? `${section} — GameBacklog`
      : 'GameBacklog — ton backlog Steam'
  }, [location.pathname])

  const authResult = searchParams.get('auth')
  let notice: string | null = null
  if (!loading && authResult === 'success') {
    notice = user
      ? 'Connexion Steam réussie.'
      : 'Steam a confirmé la connexion, mais la session n’a pas été conservée : reconnecte-toi.'
  } else if (!loading && authResult === 'error') {
    notice = 'La connexion Steam a échoué. Réessaie.'
  }

  // La fiche d'un jeu est une sous-page de la bibliothèque : le lien reste
  // actif pour que la navigation reflète le contexte.
  const surBibliotheque =
    location.pathname === '/bibliotheque' ||
    location.pathname.startsWith('/jeu/')

  return (
    <div className="app">
      <header className="topbar">
        <div className="topbar-inner">
          <Link className="marque" to="/accueil">
            GameBacklog
          </Link>

          <nav className="nav">
            <NavLink to="/accueil">Accueil</NavLink>
            <Link
              to="/bibliotheque"
              className={surBibliotheque ? 'active' : undefined}
              aria-current={surBibliotheque ? 'page' : undefined}
            >
              Bibliothèque
            </Link>
          </nav>

          {user && (
            <BarreRecherche
              key={
                location.pathname === '/recherche'
                  ? location.search
                  : 'barre'
              }
            />
          )}

          <div className="compte">
            {loading ? (
              <span className="compte-attente">Session…</span>
            ) : user ? (
              <>
                {user.avatarUrl && (
                  <img
                    className="avatar"
                    src={user.avatarUrl}
                    alt=""
                    width="32"
                    height="32"
                  />
                )}
                <span className="compte-nom">
                  {user.displayName || 'Profil Steam'}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => void logout()}
                >
                  Se déconnecter
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-principal"
                onClick={login}
              >
                Se connecter avec Steam
              </button>
            )}
          </div>
        </div>
      </header>

      {notice && (
        <div className="notice" role="status">
          <div className="notice-inner">
            <span>{notice}</span>
            <button
              type="button"
              className="notice-fermer"
              aria-label="Fermer le message"
              onClick={() =>
                setSearchParams(
                  (precedents) => {
                    const suivants = new URLSearchParams(precedents)
                    suivants.delete('auth')
                    return suivants
                  },
                  { replace: true },
                )
              }
            >
              ×
            </button>
          </div>
        </div>
      )}

      <main className="contenu">
        <Outlet />
      </main>

      <footer className="pied">
        <Link to="/confidentialite">Données &amp; confidentialité</Link>
        <span>Projet étudiant — données Steam</span>
      </footer>
    </div>
  )
}
