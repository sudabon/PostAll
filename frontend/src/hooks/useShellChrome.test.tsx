import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, waitFor } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/auth/AuthProvider'
import { PlatformProvider } from '@/platform'
import type { MenuTemplate, PlatformAdapter } from '@/platform'
import { createFakeAdapter } from '@/platform/fake'
import { useShellChrome } from '@/hooks/useShellChrome'

function Probe() {
  useShellChrome()
  return null
}

function renderChrome() {
  const base = createFakeAdapter({
    seedSecrets: {
      'auth.tokens': JSON.stringify({
        accessToken: 'a',
        idToken: 'i',
        refreshToken: 'r',
        expiresAt: Date.now() + 86_400_000,
      }),
    },
  })
  const templates: MenuTemplate[] = []
  const adapter: PlatformAdapter = {
    ...base,
    async setMenu(template) {
      templates.push(template)
    },
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <PlatformProvider adapter={adapter}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <Probe />
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>,
  )
  return templates
}

describe('application menu', () => {
  // Menu.setApplicationMenu は macOS の既定メニューごと置き換えるため、
  // quit ロールをテンプレートに載せないとデスクトップアプリで Cmd+Q が効かない。
  it('offers a quit role so the desktop app closes with Cmd+Q', async () => {
    const templates = renderChrome()
    await waitFor(() => expect(templates.length).toBeGreaterThan(0))
    const appGroup = templates.at(-1)?.find((group) => group.label === 'PostAll')
    expect(appGroup).toBeDefined()
    expect(appGroup?.submenu).toContainEqual({ type: 'role', role: 'quit' })
  })
})
