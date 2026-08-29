import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInScreen } from './SignInScreen'
import { AuthProvider } from '@/auth/AuthProvider'
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
