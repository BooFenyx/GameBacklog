import { createContext, useContext } from 'react'

export type SteamUser = {
  steamId: string
  displayName: string
  avatarUrl: string
  profileUrl: string
}

export type AuthContextValue = {
  /** Profil de la session, ou `null` si personne n'est connecté. */
  user: SteamUser | null
  /** `true` tant que la première vérification de session n'a pas répondu. */
  loading: boolean
  /** Redirige le navigateur vers l'authentification OpenID de Steam. */
  login: () => void
  /** Détruit la session côté API puis deconnecte l'état local. */
  logout: () => Promise<void>
  /** Re-relit `GET /api/auth/me` (après une connexion, pour rafraîchir). */
  refresh: () => Promise<void>
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth doit être appelé dans un AuthProvider')
  }
  return context
}
