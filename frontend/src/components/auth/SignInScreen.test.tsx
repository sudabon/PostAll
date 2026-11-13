import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useEffect } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInScreen } from './SignInScreen'
import { AuthProvider, useAuth } from '@/auth/AuthProvider'
import { rememberTokens } from '@/auth/session'
import { PlatformProvider, createFakeAdapter } from '@/platform'
import { useSettings } from '@/state/settings'
import { WIDE_VIEWPORT_QUERY } from '@/lib/viewport'

function mockMatchMedia(overrides: Record<string, boolean> = {}) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: overrides[query] ?? (query === WIDE_VIEWPORT_QUERY ? false : false),
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

function renderScreen() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <PlatformProvider adapter={createFakeAdapter({ capabilities: { appMenu: false } })}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SignInScreen />
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>,
  )
}

describe('SignInScreen standalone note', () => {
  beforeEach(() => {
    useSettings.getState().hydrate({
      supabaseUrl: 'https://auth.example.invalid',
      supabasePublishableKey: 'publishable-key',
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('hides the storage isolation note in a browser tab', async () => {
    mockMatchMedia({ '(display-mode: standalone)': false })
    renderScreen()
    expect(await screen.findByTestId('sign-in-button')).toBeTruthy()
    expect(screen.queryByTestId('standalone-signin-note')).toBeNull()
  })

  it('shows the storage isolation note in standalone display mode', async () => {
    mockMatchMedia({ '(display-mode: standalone)': true })
    renderScreen()
    expect(await screen.findByTestId('standalone-signin-note')).toHaveTextContent(/ホーム画面/)
  })
})

function RejectOnce() {
  const { api } = useAuth()
  useEffect(() => {
    void api.listChannels().catch(() => {})
  }, [api])
  return null
}

describe('SignInScreen account_not_allowed notice', () => {
  beforeEach(() => {
    useSettings.getState().hydrate({
      apiBaseUrl: 'https://api.example.invalid',
      supabaseUrl: 'https://auth.example.invalid',
      supabasePublishableKey: 'publishable-key',
    })
    rememberTokens({ accessToken: 'rejected', refreshToken: 'rejected', expiresAt: Date.now() + 3_600_000 })
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: 'account_not_allowed', message: 'server message' }), { status: 403 }),
      ),
    )
  })

  afterEach(() => {
    rememberTokens(null)
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('shows the notice through the existing auth-error path and keeps it until sign-in starts', async () => {
    const adapter = createFakeAdapter({ capabilities: { appMenu: false } })
    const openExternal = vi.spyOn(adapter, 'openExternal').mockResolvedValue()
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const tree = (
      <PlatformProvider adapter={adapter}>
        <QueryClientProvider client={client}>
          <AuthProvider>
            <RejectOnce />
            <SignInScreen />
          </AuthProvider>
        </QueryClientProvider>
      </PlatformProvider>
    )
    const { rerender } = render(tree)

    const notice = await screen.findByTestId('auth-error')
    expect(notice).toHaveTextContent('このアカウントでは利用が許可されていません')
    expect(screen.getAllByTestId('auth-error')).toHaveLength(1)

    rerender(tree)
    expect(screen.getByTestId('auth-error')).toHaveTextContent('このアカウントでは利用が許可されていません')

    fireEvent.click(screen.getByTestId('sign-in-button'))
    await waitFor(() => expect(openExternal).toHaveBeenCalled())
    expect(screen.queryByTestId('auth-error')).toBeNull()
  })
})
