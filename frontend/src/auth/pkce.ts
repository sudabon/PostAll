export async function generatePkce(): Promise<{ verifier: string; challenge: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const verifier = base64Url(bytes)
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))
  return { verifier, challenge: base64Url(new Uint8Array(digest)) }
}

function base64Url(data: Uint8Array): string {
  let binary = ''
  data.forEach((b) => {
    binary += String.fromCharCode(b)
  })
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')
}

export type TokenSet = {
  accessToken: string
  idToken?: string
  refreshToken?: string
  expiresAt: number
}

export function parseTokenResponse(json: Record<string, unknown>): TokenSet {
  const expiresIn = Number(json.expires_in ?? 3600)
  return {
    accessToken: String(json.access_token ?? ''),
    idToken: json.id_token ? String(json.id_token) : undefined,
    refreshToken: json.refresh_token ? String(json.refresh_token) : undefined,
    expiresAt: Date.now() + expiresIn * 1000,
  }
}

export function authorizeUrl(input: {
  supabaseUrl: string
  redirectUri: string
  challenge: string
}): string {
  const url = new URL(`${input.supabaseUrl.replace(/\/$/, '')}/auth/v1/authorize`)
  url.searchParams.set('redirect_to', input.redirectUri)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  return url.toString()
}

export async function exchangeCode(input: {
  supabaseUrl: string
  publishableKey: string
  code: string
  verifier: string
}): Promise<TokenSet> {
  return tokenRequest(input.supabaseUrl, input.publishableKey, {
    auth_code: input.code,
    code_verifier: input.verifier,
  }, 'pkce')
}

export async function refreshTokens(input: {
  supabaseUrl: string
  publishableKey: string
  refreshToken: string
}): Promise<TokenSet> {
  return tokenRequest(input.supabaseUrl, input.publishableKey, {
    refresh_token: input.refreshToken,
  }, 'refresh_token')
}

async function tokenRequest(
  supabaseUrl: string,
  publishableKey: string,
  body: Record<string, string>,
  grantType: 'pkce' | 'refresh_token',
): Promise<TokenSet> {
  const res = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/token?grant_type=${grantType}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: publishableKey,
    },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(String(json.error_description ?? json.error ?? json.msg ?? 'token exchange failed'))
  }
  return parseTokenResponse(json)
}
