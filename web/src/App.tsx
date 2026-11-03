import type { ReactNode } from 'react'
import { useEffect, useState } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { CLE_APRES_LOGIN } from './auth/AuthContext'
import { AuthProvider } from './auth/AuthProvider'
import RootLayout from './components/RootLayout'
import ErrorBoundary from './components/ErrorBoundary'
import Accueil from './pages/Accueil'
import Bibliotheque from './pages/Bibliotheque'
import Connexion from './pages/Connexion'
import Confidentialite from './pages/Confidentialite'
import JeuDetail from './pages/JeuDetail'
import NotFound from './pages/NotFound'
import Recherche from './pages/Recherche'

function Chargement() {
  const { erreurSession, refresh, login } = useAuth()

  if (erreurSession) {
    return (
      <section className="chargement" role="alert">
        <p>{erreurSession}</p>
        <div className="chargement-actions">
          <button
            type="button"
            className="btn btn-principal"
            onClick={() => void refresh()}
          >
            Réessayer
          </button>
          <button type="button" className="btn" onClick={login}>
            Se reconnecter avec Steam
          </button>
        </div>
      </section>
    )
  }

  return <p className="chargement">Chargement de la session…</p>
}

/** Valide une cible de redirection interne (pas d'open redirect). */
function cibleInterneSure(cible: string | null): string | null {
  if (!cible) return null
  if (!cible.startsWith('/') || cible.startsWith('//')) return null
  if (cible.startsWith('/api')) return null
  // Certains navigateurs normalisent `/\evil.com` en `//evil.com`.
  if (cible.includes('\\')) return null
  return cible
}

/** Remonte la fiche quand l'appId change : aucun état de l'ancien jeu ne fuit. */
function JeuDetailRoute() {
  const { appId } = useParams()
  return <JeuDetail key={appId} />
}

/** Route réservée : redirige vers l'écran de connexion si la session est absente. */
function RouteProtegee({ children }: { children: ReactNode }) {
  const { user, loading, erreurSession } = useAuth()
  const location = useLocation()

  if (loading) return <Chargement />
  if (!user && erreurSession) return <Chargement />
  if (!user) {
    // Un lien profond partagé (/jeu/730, /bibliotheque?genres=25) est mémorisé
    // avant la redirection vers la connexion, puis restauré par `Racine`.
    if (location.pathname !== '/' && !location.pathname.startsWith('/api')) {
      try {
        sessionStorage.setItem(
          CLE_APRES_LOGIN,
          `${location.pathname}${location.search}`,
        )
      } catch {
        // Stockage indisponible : on retombe sur /accueil après login.
      }
    }
    return <Navigate to="/" replace />
  }
  return children
}

/** `GET /` : la page d'accueil si la session est ouverte, sinon la connexion. */
function Racine() {
  const { user, loading, erreurSession } = useAuth()
  const location = useLocation()
  // Mémorisé une fois : l'effet ci-dessous efface la clé, mais la cible reste
  // stable le temps de la navigation (et sous StrictMode).
  const [cibleApresLogin] = useState(() => {
    try {
      return cibleInterneSure(sessionStorage.getItem(CLE_APRES_LOGIN))
    } catch {
      return null
    }
  })

  useEffect(() => {
    if (user && cibleApresLogin) {
      try {
        sessionStorage.removeItem(CLE_APRES_LOGIN)
      } catch {
        // Le stockage peut être indisponible en navigation privée.
      }
    }
  }, [user, cibleApresLogin])

  if (loading) return <Chargement />
  if (!user && erreurSession) return <Chargement />
  // Le paramètre `auth=success|error` est conservé à la redirection, sinon le
  // bandeau de résultat affiché par `RootLayout` disparaîtrait d'un coup.
  if (user) {
    if (cibleApresLogin) {
      // Conserve `auth=success|error` pour que le bandeau de RootLayout
      // s'affiche aussi après la restauration d'un lien profond.
      const cible = new URL(cibleApresLogin, window.location.origin)
      const auth = new URLSearchParams(location.search).get('auth')
      if (auth) cible.searchParams.set('auth', auth)
      return (
        <Navigate
          to={`${cible.pathname}${cible.search}${cible.hash}`}
          replace
        />
      )
    }
    return (
      <Navigate to={{ pathname: '/accueil', search: location.search }} replace />
    )
  }
  return <Connexion />
}

function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <ErrorBoundary>
          <Routes>
            <Route element={<RootLayout />}>
              <Route path="/" element={<Racine />} />
              <Route path="/confidentialite" element={<Confidentialite />} />
              <Route
                path="/accueil"
                element={
                  <RouteProtegee>
                    <Accueil />
                  </RouteProtegee>
                }
              />
              <Route
                path="/bibliotheque"
                element={
                  <RouteProtegee>
                    <Bibliotheque />
                  </RouteProtegee>
                }
              />
              <Route
                path="/jeu/:appId"
                element={
                  <RouteProtegee>
                    <JeuDetailRoute />
                  </RouteProtegee>
                }
              />
              <Route
                path="/recherche"
                element={
                  <RouteProtegee>
                    <Recherche />
                  </RouteProtegee>
                }
              />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </ErrorBoundary>
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
