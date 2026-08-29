import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AppShell } from './AppShell'
import { AuthProvider } from '@/auth/AuthProvider'
import { PlatformProvider, createFakeAdapter } from '@/platform'
import { useUi } from '@/state/ui'
import { WIDE_VIEWPORT_QUERY } from '@/lib/viewport'

const tokens = JSON.stringify({
  accessToken: 'access',
  refreshToken: 'refresh',
  expiresAt: Date.now() + 3_600_000,
})

function mockViewport(wide: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>()
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    get matches() {
      return query === WIDE_VIEWPORT_QUERY ? wide : false
    },
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: (_event: string, fn: EventListener) => {
      listeners.add(fn as (event: MediaQueryListEvent) => void)
    },
    removeEventListener: (_event: string, fn: EventListener) => {
      listeners.delete(fn as (event: MediaQueryListEvent) => void)
    },
    dispatchEvent: () => false,
  }))
  return {
    setWide(next: boolean) {
      wide = next
      listeners.forEach((fn) => fn({ matches: next, media: WIDE_VIEWPORT_QUERY } as MediaQueryListEvent))
    },
  }
}

function renderShell() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const adapter = createFakeAdapter({
    seedSecrets: { 'auth.tokens': tokens },
    capabilities: { appMenu: false },
  })
  return render(
    <PlatformProvider adapter={adapter}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <AppShell />
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>,
  )
}

describe('AppShell viewport layouts', () => {
  beforeEach(() => {
    window.history.replaceState({}, '', '/')
    useUi.getState().hydrate({
      selectedChannelId: '11111111-1111-1111-1111-111111111111',
      threadPostId: '22222222-2222-2222-2222-222222222222',
      narrowScreen: 'timeline',
      sidebarCollapsed: false,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('shows the three-pane shell on a wide viewport', async () => {
    mockViewport(true)
    renderShell()
    expect(await screen.findByTestId('sidebar')).toBeTruthy()
    expect(screen.getByTestId('channel-tree')).toBeTruthy()
    expect(screen.queryByTestId('narrow-shell')).toBeNull()
    expect(screen.queryByTestId('narrow-back')).toBeNull()
  })

  it('shows a single stacked screen on a narrow viewport', async () => {
    mockViewport(false)
    renderShell()
    expect(await screen.findByTestId('narrow-shell')).toBeTruthy()
    expect(screen.queryByTestId('sidebar')).toBeNull()
    expect(screen.getByTestId('narrow-back')).toBeTruthy()
  })

  it('keeps the selected channel and thread when crossing the breakpoint', async () => {
    const viewport = mockViewport(false)
    renderShell()
    expect(await screen.findByTestId('narrow-shell')).toBeTruthy()
    expect(useUi.getState().selectedChannelId).toBe('11111111-1111-1111-1111-111111111111')
    expect(useUi.getState().threadPostId).toBe('22222222-2222-2222-2222-222222222222')
    viewport.setWide(true)
    expect(await screen.findByTestId('sidebar')).toBeTruthy()
    expect(useUi.getState().selectedChannelId).toBe('11111111-1111-1111-1111-111111111111')
    expect(useUi.getState().threadPostId).toBe('22222222-2222-2222-2222-222222222222')
  })
})
