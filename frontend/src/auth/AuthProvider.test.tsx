import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import App from '@/App'
import { AuthProvider } from '@/auth/AuthProvider'
import { TokenRequestError } from '@/auth/pkce'
import { PKCE_VERIFIER_KEY, rememberTokens } from '@/auth/session'
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
