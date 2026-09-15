import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { authorizeUrl, exchangeCode, generatePkce, oauthCallbackParams } from '@/auth/pkce'
import {
  createApiClient,
  loadTokens,
  persistTokens,
  PKCE_VERIFIER_KEY,
  subscribeSignedIn,
} from '@/auth/session'
import { usePlatform } from '@/platform'
import { useSettings } from '@/state/settings'
import { AuthContext, type AuthState } from './auth-context'

export function AuthProvider({ children }: { children: ReactNode }) {
  const platform = usePlatform()
  const [ready, setReady] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [api] = useState(() => createApiClient(platform))

  const redirectUri =
    platform.kind === 'electron' ? 'postall://auth/callback' : `${window.location.origin}/auth/callback`

  const handleRedirectUrl = useCallback(
    async (url: string) => {
      const { code, error: oauthError } = oauthCallbackParams(url)
      const clearCallbackUrl = () => {
        if (platform.kind === 'electron') return
        if (code || oauthError) window.history.replaceState({}, '', '/')
      }
      if (oauthError) {
        setError(oauthError)
        clearCallbackUrl()
        return
      }
      if (!code) return
      const verifier =
        (await platform.getItem(PKCE_VERIFIER_KEY)) ?? (await platform.getSecret(PKCE_VERIFIER_KEY))
      if (!verifier) {
        setError('サインインの途中状態が見つかりませんでした。もう一度お試しください。')
        clearCallbackUrl()
        return
      }
      try {
        const tokens = await exchangeCode({
          supabaseUrl: useSettings.getState().supabaseUrl,
          publishableKey: useSettings.getState().supabasePublishableKey,
          code,
          verifier,
        })
        await platform.removeItem(PKCE_VERIFIER_KEY)
        await platform.deleteSecret(PKCE_VERIFIER_KEY)
        await persistTokens(platform, tokens)
        setError(null)
        clearCallbackUrl()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'サインインに失敗しました')
        clearCallbackUrl()
      }
    },
    [platform],
  )

  useEffect(() => subscribeSignedIn(setSignedIn), [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        await loadTokens(platform)
        const callback = oauthCallbackParams(window.location.href)
        if (callback.code || callback.error) {
          await handleRedirectUrl(window.location.href)
        }
      } finally {
        if (!cancelled) setReady(true)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [handleRedirectUrl, platform])

  useEffect(() => platform.onDeepLink((url) => void handleRedirectUrl(url)), [platform, handleRedirectUrl])

  const signIn = useCallback(async () => {
    try {
      setError(null)
      const { verifier, challenge } = await generatePkce()
      await platform.setItem(PKCE_VERIFIER_KEY, verifier)
      await platform.setSecret(PKCE_VERIFIER_KEY, verifier)
      const { supabaseUrl } = useSettings.getState()
      const url = authorizeUrl({
        supabaseUrl,
        redirectUri,
        challenge,
      })
      if (platform.kind === 'browser') {
        window.location.assign(url)
        return
      }
      await platform.openExternal(url)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'サインインに失敗しました')
    }
  }, [platform, redirectUri])

  const signOut = useCallback(async () => {
    await persistTokens(platform, null)
  }, [platform])

  const value = useMemo<AuthState>(
    () => ({ ready, signedIn, error, api, signIn, signOut, handleRedirect: handleRedirectUrl }),
    [api, error, handleRedirectUrl, ready, signIn, signOut, signedIn],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
