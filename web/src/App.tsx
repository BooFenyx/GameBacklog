import type { ReactNode } from 'react'
import {
  BrowserRouter,
  Navigate,
  Route,
  Routes,
  useLocation,
  useParams,
} from 'react-router-dom'
import { useAuth } from './auth/AuthContext'
import { AuthProvider } from './auth/AuthProvider'
import RootLayout from './components/RootLayout'
import Accueil from './pages/Accueil'
import Bibliotheque from './pages/Bibliotheque'
import Connexion from './pages/Connexion'
import JeuDetail from './pages/JeuDetail'
import NotFound from './pages/NotFound'
import Recherche from './pages/Recherche'

function Chargement() {
  return <p className="chargement">Chargement de la session…</p>
}

/** Remonte la fiche quand l'appId change : aucun état de l'ancien jeu ne fuit. */
function JeuDetailRoute() {
  const { appId } = useParams()
  return <JeuDetail key={appId} />
}

/** Route réservée : redirige vers l'écran de connexion si la session est absente. */
function RouteProtegee({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()

  if (loading) return <Chargement />
  if (!user) return <Navigate to="/" replace />
  return children
}

/** `GET /` : la page d'accueil si la session est ouverte, sinon la connexion. */
function Racine() {
  const { user, loading } = useAuth()
  const location = useLocation()

  if (loading) return <Chargement />
  // Le paramètre `auth=success|error` est conservé à la redirection, sinon le
  // bandeau de résultat affiché par `RootLayout` disparaîtrait d'un coup.
  if (user) {
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
        <Routes>
          <Route element={<RootLayout />}>
            <Route path="/" element={<Racine />} />
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
      </BrowserRouter>
    </AuthProvider>
  )
}

export default App
