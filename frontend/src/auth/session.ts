import { ApiClient } from '@/api/client'
import { refreshTokens, TokenRequestError, type TokenSet } from '@/auth/pkce'
import type { PlatformAdapter } from '@/platform'
import { useSettings } from '@/state/settings'

export const AUTH_SECRET_KEY = 'auth.tokens'
export const PKCE_VERIFIER_KEY = 'auth.pkceVerifier'

let tokens: TokenSet | null = null
let refreshInFlight: Promise<string | null> | null = null
const listeners = new Set<(signedIn: boolean) => void>()

export function subscribeSignedIn(listener: (signedIn: boolean) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function rememberTokens(next: TokenSet | null) {
  tokens = next
  const signedIn = Boolean(next?.accessToken)
  listeners.forEach((fn) => fn(signedIn))
}

export async function persistTokens(platform: PlatformAdapter, next: TokenSet | null) {
  rememberTokens(next)
  if (next) await platform.setSecret(AUTH_SECRET_KEY, JSON.stringify(next))
  else await platform.deleteSecret(AUTH_SECRET_KEY)
}

export async function loadTokens(platform: PlatformAdapter) {
  const raw = await platform.getSecret(AUTH_SECRET_KEY)
  rememberTokens(raw ? (JSON.parse(raw) as TokenSet) : null)
}

export async function accessTokenForRequest(platform: PlatformAdapter): Promise<string | null> {
  const cur = tokens
  if (!cur) return null
  if (cur.expiresAt - Date.now() > 60_000) return cur.accessToken
  if (refreshInFlight) return refreshInFlight

  const refresh = refreshAccessToken(platform, cur)
  refreshInFlight = refresh
  try {
    return await refresh
  } finally {
    if (refreshInFlight === refresh) refreshInFlight = null
  }
}

async function refreshAccessToken(platform: PlatformAdapter, cur: TokenSet): Promise<string | null> {
  const { supabaseUrl, supabasePublishableKey } = useSettings.getState()
  if (!cur.refreshToken || !supabaseUrl || !supabasePublishableKey) {
    await persistTokens(platform, null)
    return null
  }
  try {
    const next = await refreshTokens({
      supabaseUrl,
      publishableKey: supabasePublishableKey,
      refreshToken: cur.refreshToken,
    })
    const merged = { ...next, refreshToken: next.refreshToken ?? cur.refreshToken }
    await persistTokens(platform, merged)
    return merged.accessToken
  } catch (err) {
    const status = err instanceof TokenRequestError ? err.status : 0
    if (status === 400 || status === 401) {
      await persistTokens(platform, null)
    }
    return null
  }
}

export function createApiClient(platform: PlatformAdapter): ApiClient {
  return new ApiClient(
    () => useSettings.getState().apiBaseUrl.replace(/\/$/, ''),
    () => accessTokenForRequest(platform),
  )
}
