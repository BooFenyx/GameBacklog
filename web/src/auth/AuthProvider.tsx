import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AuthContext,
  CLE_APRES_LOGIN,
  type AuthContextValue,
  type SteamUser,
} from './AuthContext'
import { urlApi } from '../api'
import { appelApi, ErreurApi, surSessionExpiree } from '../http'

/**
 * Lit `GET /api/auth/me` avec le cookie de session. Une panne réseau remonte
 * comme erreur : elle ne doit pas être confondue avec un visiteur déconnecté,
 * sinon un cold start Render déconnecte l'utilisateur à tort.
 */
async function lireSession(): Promise<SteamUser | null> {
  const data = await appelApi<{ user: SteamUser | null }>('/api/auth/me', {
    // Render free peut mettre ~50 s à démarrer après 15 min d'inactivité.
    timeoutMs: 60_000,
  })
  return data?.user ?? null
}

function messageSession(error: unknown): string {
  if (error instanceof ErreurApi) {
    if (error.statut === 0) {
      return "L'API ne répond pas encore. Réessaie dans un instant."
    }
    if (error.statut >= 500) {
      return 'Le serveur est momentanément indisponible. Réessaie plus tard.'
    }
    return error.message
  }
  return 'Impossible de vérifier la session.'
}

/**
 * Lit la session au montage de l'application : c'est ce qui rend la connexion
 * persistante après la redirection OpenID de Steam et à chaque rechargement
 * de page (le cookie de session survivant 7 jours côté serveur).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SteamUser | null>(null)
  const [loading, setLoading] = useState(true)
  const [erreurSession, setErreurSession] = useState<string | null>(null)
  const monte = useRef(true)

  useEffect(() => {
    monte.current = true
    return () => {
      monte.current = false
    }
  }, [])

  const charger = useCallback(async () => {
    try {
      const session = await lireSession()
      if (monte.current) {
        setUser(session)
        setErreurSession(null)
      }
    } catch (error) {
      if (monte.current) {
        setUser(null)
        setErreurSession(messageSession(error))
      }
    } finally {
      if (monte.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    // Chargement initial de la session : effet de synchronisation avec l'API,
    // pas un état dérivé. Le setState a lieu après l'await de `lireSession`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void charger()
  }, [charger])

  // Un 401 sur n'importe quel appel remet l'utilisateur à zéro et affiche la
  // reconnexion, au lieu de laisser une page bloquée sur « Réessayer ».
  useEffect(
    () =>
      surSessionExpiree(() => {
        setUser(null)
        setErreurSession('Ta session a expiré. Reconnecte-toi.')
      }),
    [],
  )

  const login = useCallback(() => {
    // Conserve la page demandée pour rouvrir un lien profond après Steam.
    // La racine est exclue même avec `?auth=error`, sinon un nouvel essai
    // rejouerait le message d'échec précédent après une connexion réussie.
    const { pathname, search } = window.location
    if (pathname !== '/' && !pathname.startsWith('/api')) {
      try {
        sessionStorage.setItem(CLE_APRES_LOGIN, `${pathname}${search}`)
      } catch {
        // Navigation privée ou stockage désactivé : le login reste possible,
        // on perd seulement le retour vers la page demandée.
      }
    }
    window.location.assign(urlApi('/api/auth/steam'))
  }, [])

  const logout = useCallback(async () => {
    try {
      await appelApi<void>('/api/auth/logout', {
        method: 'POST',
        timeoutMs: 8_000,
      })
      // Ne vide l'état local qu'après confirmation serveur : sinon un reload
      // retrouverait la session et donnerait l'impression d'un faux logout.
      setUser(null)
      setErreurSession(null)
      try {
        sessionStorage.removeItem(CLE_APRES_LOGIN)
      } catch {
        // Stockage indisponible : sans conséquence sur la déconnexion.
      }
    } catch {
      // Le bouton reste disponible : l'utilisateur peut réessayer.
    }
  }, [])

  const refresh = useCallback(async () => {
    setLoading(true)
    setErreurSession(null)
    await charger()
  }, [charger])

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      loading,
      erreurSession,
      login,
      logout,
      refresh,
    }),
    [user, loading, erreurSession, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
