import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAdapter } from '@/platform'
import { useSettings } from '@/state/settings'
import { accessTokenForRequest, rememberTokens } from './session'

const mocks = vi.hoisted(() => ({
  refreshTokens: vi.fn(),
}))

vi.mock('@/auth/pkce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/pkce')>()),
  refreshTokens: mocks.refreshTokens,
}))

beforeEach(() => {
  mocks.refreshTokens.mockReset()
  rememberTokens(null)
  useSettings.getState().hydrate({
    supabaseUrl: 'https://auth.example.invalid',
    supabasePublishableKey: 'publishable-key',
  })
})

afterEach(() => {
  rememberTokens(null)
})

describe('accessTokenForRequest', () => {
  it('shares one refresh and returns the refreshed token to concurrent callers', async () => {
    const platform = createFakeAdapter()
    rememberTokens({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 })
    mocks.refreshTokens.mockResolvedValue({
      accessToken: 'fresh',
      refreshToken: 'next-refresh',
      expiresAt: Date.now() + 3_600_000,
    })

    const [first, second] = await Promise.all([
      accessTokenForRequest(platform),
      accessTokenForRequest(platform),
    ])

    expect([first, second]).toEqual(['fresh', 'fresh'])
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(1)
  })

  it('returns a fresh stored token without refreshing it', async () => {
    const platform = createFakeAdapter()
    rememberTokens({ accessToken: 'current', expiresAt: Date.now() + 3_600_000 })

    await expect(accessTokenForRequest(platform)).resolves.toBe('current')
    expect(mocks.refreshTokens).not.toHaveBeenCalled()
  })
})
