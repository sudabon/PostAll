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
  domain: string
  clientId: string
  redirectUri: string
  challenge: string
}): string {
  const url = new URL(`https://${input.domain}/oauth2/authorize`)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('client_id', input.clientId)
  url.searchParams.set('redirect_uri', input.redirectUri)
  url.searchParams.set('code_challenge', input.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('scope', 'openid email')
  return url.toString()
}

export async function exchangeCode(input: {
  domain: string
  clientId: string
  redirectUri: string
  code: string
  verifier: string
}): Promise<TokenSet> {
  return tokenRequest(input.domain, {
    grant_type: 'authorization_code',
    client_id: input.clientId,
    redirect_uri: input.redirectUri,
    code: input.code,
    code_verifier: input.verifier,
  })
}

export async function refreshTokens(input: {
  domain: string
  clientId: string
  refreshToken: string
}): Promise<TokenSet> {
  return tokenRequest(input.domain, {
    grant_type: 'refresh_token',
    client_id: input.clientId,
    refresh_token: input.refreshToken,
  })
}

async function tokenRequest(domain: string, body: Record<string, string>): Promise<TokenSet> {
  const res = await fetch(`https://${domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  })
  const json = (await res.json()) as Record<string, unknown>
  if (!res.ok) {
    throw new Error(String(json.error_description ?? json.error ?? 'token exchange failed'))
  }
  return parseTokenResponse(json)
}
