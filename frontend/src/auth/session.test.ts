import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeAdapter } from '@/platform'
import { useSettings } from '@/state/settings'
import { TokenRequestError } from './pkce'
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

  it('keeps the stored tokens when the refresh fails for a transient reason', async () => {
    const platform = createFakeAdapter()
    rememberTokens({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 })
    // status 0 = ネットワーク到達不能。失効ではないのでサインアウトしない。
    mocks.refreshTokens.mockRejectedValue(new TokenRequestError('offline', 0))

    await expect(accessTokenForRequest(platform)).resolves.toBeNull()
    // トークンが残っていれば、次の呼び出しでもう一度 refresh を試みる。
    await expect(accessTokenForRequest(platform)).resolves.toBeNull()
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(2)
  })

  it('signs out when the refresh token itself is rejected', async () => {
    const platform = createFakeAdapter()
    rememberTokens({ accessToken: 'expired', refreshToken: 'refresh', expiresAt: 0 })
    mocks.refreshTokens.mockRejectedValue(new TokenRequestError('invalid_grant', 400))

    await expect(accessTokenForRequest(platform)).resolves.toBeNull()
    // 破棄済みなので 2 回目は refresh を試みない。
    await expect(accessTokenForRequest(platform)).resolves.toBeNull()
    expect(mocks.refreshTokens).toHaveBeenCalledTimes(1)
  })
})