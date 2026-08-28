import { describe, expect, it } from 'vitest'
import { authorizeUrl, oauthCallbackParams } from './pkce'

describe('authorizeUrl', () => {
  it('selects GitHub OAuth by default', () => {
    const url = new URL(authorizeUrl({
      supabaseUrl: 'https://auth.example.invalid/',
      redirectUri: 'postall://auth/callback',
      challenge: 'challenge',
    }))

    expect(url.searchParams.get('provider')).toBe('github')
    expect(url.searchParams.get('redirect_to')).toBe('postall://auth/callback')
    expect(url.searchParams.get('code_challenge')).toBe('challenge')
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
  })

  it('keeps explicit provider selection source-compatible', () => {
    const url = new URL(authorizeUrl({
      supabaseUrl: 'https://auth.example.invalid',
      redirectUri: 'postall://auth/callback',
      challenge: 'challenge',
      provider: 'gitlab',
    }))

    expect(url.searchParams.get('provider')).toBe('gitlab')
  })
})

describe('oauthCallbackParams', () => {
  it('reads the authorization code from the query string on any path', () => {
    expect(oauthCallbackParams('https://app.example/auth/callback?code=abc').code).toBe('abc')
    expect(oauthCallbackParams('https://app.example/?code=abc').code).toBe('abc')
  })

  it('reads OAuth errors from the query string or hash', () => {
    expect(oauthCallbackParams('https://app.example/?error=access_denied&error_description=Signups+not+allowed').error).toBe(
      'Signups not allowed',
    )
    expect(oauthCallbackParams('https://app.example/#error_description=denied').error).toBe('denied')
  })
})
