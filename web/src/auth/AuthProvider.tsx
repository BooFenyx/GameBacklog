import { useCallback, useEffect, useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import {
  AuthContext,
  type AuthContextValue,
  type SteamUser,
} from './AuthContext'
import { urlApi } from '../api'

/**
 * Lit `GET /api/auth/me` avec le cookie de session. Renvoie `null` si
 * l'API est injoignable ou si le corps est illisible : mieux vaut un
 * visiteur déconnecté qu'un état de connexion fantôme.
 */
async function lireSession(): Promise<SteamUser | null> {
  try {
    const res = await fetch(urlApi('/api/auth/me'), { credentials: 'include' })
    const data = (await res.json()) as { user: SteamUser | null } | null
    return data?.user ?? null
  } catch {
    return null
  }
}

/**
 * Lit la session au montage de l'application : c'est ce qui rend la connexion
 * persistante après la redirection OpenID de Steam et à chaque rechargement
 * de page (le cookie de session survivant 7 jours côté serveur).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<SteamUser | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let actif = true
    void (async () => {
      const session = await lireSession()
      if (!actif) return
      setUser(session)
      setLoading(false)
    })()
    return () => {
      actif = false
    }
  }, [])

  const login = useCallback(() => {
    window.location.assign(urlApi('/api/auth/steam'))
  }, [])

  const logout = useCallback(async () => {
    try {
      await fetch(urlApi('/api/auth/logout'), {
        method: 'POST',
        credentials: 'include',
      })
    } finally {
      setUser(null)
    }
  }, [])

  const refresh = useCallback(async () => {
    setUser(await lireSession())
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, login, logout, refresh }),
    [user, loading, login, logout, refresh],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
