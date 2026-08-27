import { describe, expect, it } from 'vitest'
import { authorizeUrl } from './pkce'

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
