import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AuthProvider } from '@/auth/AuthProvider'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { PlatformProvider } from '@/platform'
import { createFakeAdapter } from '@/platform/fake'
import { useUi } from '@/state/ui'

function renderSettings(capabilities: { globalShortcuts: boolean }) {
  const adapter = createFakeAdapter({ capabilities: { globalShortcuts: capabilities.globalShortcuts, appMenu: false } })
  useUi.getState().setSettingsOpen(true)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <PlatformProvider adapter={adapter}>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <SettingsDialog />
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>,
  )
}

describe('SettingsDialog capability branching', () => {
  it('hides global shortcut hint when the adapter cannot provide them', () => {
    const { queryByTestId } = renderSettings({ globalShortcuts: false })
    expect(queryByTestId('global-shortcut-hint')).toBeNull()
  })

  it('shows global shortcut hint when the adapter can provide them', () => {
    const { getByTestId } = renderSettings({ globalShortcuts: true })
    expect(getByTestId('global-shortcut-hint')).toBeTruthy()
  })
})
