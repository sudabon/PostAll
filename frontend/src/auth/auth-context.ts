import { createContext, useContext } from 'react'
import type { ApiClient } from '@/api/client'

export type AuthState = {
  ready: boolean
  signedIn: boolean
  error: string | null
  api: ApiClient
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  handleRedirect: (url: string) => Promise<void>
}

export const AuthContext = createContext<AuthState | null>(null)

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
