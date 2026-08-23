import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { ApiClient } from '@/api/client'
import { authorizeUrl, exchangeCode, generatePkce } from '@/auth/pkce'
import {
  createApiClient,
  loadTokens,
  persistTokens,
  PKCE_VERIFIER_KEY,
  subscribeSignedIn,
} from '@/auth/session'
import { usePlatform } from '@/platform'
import { useSettings } from '@/state/settings'

type AuthState = {
  ready: boolean
  signedIn: boolean
  api: ApiClient
  signIn: () => Promise<void>
  signOut: () => Promise<void>
  handleRedirect: (url: string) => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform()
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [api] = useState(() => createApiClient(platform))

  const redirectUri =
    platform.kind === 'electron' ? 'postall://auth/callback' : `${window.location.origin}/auth/callback`

  const handleRedirectUrl = useCallback(
    async (url: string) => {
      const parsed = new URL(url)
      const code = parsed.searchParams.get('code')
      if (!code) return
      const verifier = await platform.getSecret(PKCE_VERIFIER_KEY)
      if (!verifier) return
      const tokens = await exchangeCode({
        domain: useSettings.getState().cognitoDomain,
        clientId: useSettings.getState().cognitoClientId,
        redirectUri,
        code,
        verifier,
      })
      await platform.deleteSecret(PKCE_VERIFIER_KEY)
      await persistTokens(platform, tokens)
      if (parsed.pathname.includes('/auth/callback') && platform.kind !== 'electron') {
        window.history.replaceState({}, '', '/')
      }
    },
    [platform, redirectUri],
  )

  useEffect(() => subscribeSignedIn(setSignedIn), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      await loadTokens(platform)
      if (window.location.pathname === '/auth/callback') {
        await handleRedirectUrl(window.location.href)
      }
      if (!cancelled) setReady(true)
    })()
    return () => {
      cancelled = true
    }
  }, [handleRedirectUrl, platform])

  useEffect(() => platform.onDeepLink((url) => void handleRedirectUrl(url)), [platform, handleRedirectUrl])

  const signIn = useCallback(async () => {
    const { verifier, challenge } = await generatePkce()
    await platform.setSecret(PKCE_VERIFIER_KEY, verifier)
    const { cognitoDomain, cognitoClientId } = useSettings.getState()
    const url = authorizeUrl({
      domain: cognitoDomain,
      clientId: cognitoClientId,
      redirectUri,
      challenge,
    })
    await platform.openExternal(url)
  }, [platform, redirectUri])

  const signOut = useCallback(async () => {
    await persistTokens(platform, null)
  }, [platform])

  const value = useMemo<AuthState>(
    () => ({ ready, signedIn, api, signIn, signOut, handleRedirect: handleRedirectUrl }),
    [api, handleRedirectUrl, ready, signIn, signOut, signedIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
