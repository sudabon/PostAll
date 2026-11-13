import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { TokenRequestError } from '@/auth/pkce'
import { AUTH_SECRET_KEY, PKCE_VERIFIER_KEY, rememberTokens } from '@/auth/session'
import { PlatformProvider, createFakeAdapter } from '@/platform'
import { useSettings } from '@/state/settings'

const mocks = vi.hoisted(() => ({
  exchangeCode: vi.fn(),
}))

vi.mock('@/auth/pkce', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/auth/pkce')>()),
  exchangeCode: mocks.exchangeCode,
}))

function renderApp(adapter = createFakeAdapter()) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <PlatformProvider adapter={adapter}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>,
  )
}

async function adapterWithVerifier() {
  const adapter = createFakeAdapter()
  await adapter.setItem(PKCE_VERIFIER_KEY, 'pkce-verifier')
  await adapter.setSecret(PKCE_VERIFIER_KEY, 'pkce-verifier')
  return adapter
}

describe('AuthProvider callback failures', () => {
  beforeEach(() => {
    mocks.exchangeCode.mockReset()
    rememberTokens(null)
    useSettings.getState().hydrate({
      supabaseUrl: 'https://auth.example.invalid',
      supabasePublishableKey: 'publishable-key',
    })
  })

  afterEach(() => {
    rememberTokens(null)
    window.history.replaceState({}, '', '/')
  })

  it('returns to the sign-in screen with an error when token exchange fails', async () => {
    mocks.exchangeCode.mockRejectedValue(new TokenRequestError('Signups not allowed for this instance', 400))
    window.history.pushState({}, '', '/auth/callback?code=authorization-code')

    renderApp(await adapterWithVerifier())

    expect(await screen.findByTestId('sign-in-button')).toBeTruthy()
    expect(screen.getByTestId('auth-error')).toHaveTextContent('Signups not allowed for this instance')
    expect(window.location.pathname).toBe('/')
  })

  it('exchanges the code when GitHub returns to the site URL instead of /auth/callback', async () => {
    mocks.exchangeCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60_000,
    })
    window.history.pushState({}, '', '/?code=authorization-code')

    renderApp(await adapterWithVerifier())

    expect(await screen.findByTestId('channel-tree')).toBeTruthy()
    expect(mocks.exchangeCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'authorization-code', verifier: 'pkce-verifier' }),
    )
    expect(window.location.search).toBe('')
  })

  it('shows the OAuth error when GitHub returns to the site URL', async () => {
    window.history.pushState({}, '', '/?error=access_denied&error_description=Signups+not+allowed+for+this+instance')

    renderApp()

    expect(await screen.findByTestId('auth-error')).toHaveTextContent('Signups not allowed for this instance')
    expect(window.location.search).toBe('')
  })

  it('does not restore the OAuth callback URL after replaceState', async () => {
    mocks.exchangeCode.mockResolvedValue({
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      expiresAt: Date.now() + 60_000,
    })
    window.history.pushState({ postallNarrow: 'channels' }, '', '/')
    window.history.pushState({}, '', '/auth/callback?code=authorization-code')

    renderApp(await adapterWithVerifier())

    expect(await screen.findByTestId('channel-tree')).toBeTruthy()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).toBe('')
    window.history.back()
    expect(window.location.pathname).toBe('/')
    expect(window.location.search).not.toContain('code=')
  })
})

function ParallelRejectedRequests() {
  const { api, signedIn } = useAuth()
  useEffect(() => {
    if (!signedIn) return
    void Promise.allSettled([api.listChannels(), api.listEmojis()])
  }, [api, signedIn])
  return null
}

describe('AuthProvider account_not_allowed', () => {
  beforeEach(() => {
    rememberTokens(null)
    useSettings.getState().hydrate({
      apiBaseUrl: 'https://api.example.invalid',
      supabaseUrl: 'https://auth.example.invalid',
      supabasePublishableKey: 'publishable-key',
    })
  })

  afterEach(() => {
    rememberTokens(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('signs out once and shows a single notice when parallel requests are rejected together', async () => {
    const fetchMock = vi.fn().mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/v1/')) {
        return new Response(
          JSON.stringify({ code: 'account_not_allowed', message: 'このアカウントでは利用が許可されていません' }),
          { status: 403, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response('{}', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const adapter = createFakeAdapter({
      seedSecrets: {
        [AUTH_SECRET_KEY]: JSON.stringify({
          accessToken: 'rejected-access-token',
          refreshToken: 'rejected-refresh-token',
          expiresAt: Date.now() + 3_600_000,
        }),
      },
    })
    const deleteSecret = vi.spyOn(adapter, 'deleteSecret')
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })

    render(
      <PlatformProvider adapter={adapter}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <ParallelRejectedRequests />
            <App />
          </AuthProvider>
        </QueryClientProvider>
      </PlatformProvider>,
    )

    expect(await screen.findByTestId('sign-in-button')).toBeTruthy()
    await waitFor(() => {
      expect(screen.getAllByTestId('auth-error')).toHaveLength(1)
    })
    expect(screen.getByTestId('auth-error')).toHaveTextContent('このアカウントでは利用が許可されていません')
    const rejected = fetchMock.mock.calls.filter(([input]) => String(input).includes('/v1/'))
    expect(rejected.length).toBeGreaterThanOrEqual(2)
    expect(deleteSecret.mock.calls.filter(([key]) => key === AUTH_SECRET_KEY)).toHaveLength(1)
    expect(await adapter.getSecret(AUTH_SECRET_KEY)).toBeNull()
    expect(screen.queryByTestId('channel-tree')).toBeNull()
  })
})
