import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from './App'
import { AuthProvider } from '@/auth/AuthProvider'
import { PlatformProvider } from '@/platform'

function renderApp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <PlatformProvider>
      <QueryClientProvider client={client}>
        <AuthProvider>
          <App />
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>,
  )
}

describe('App', () => {
  afterEach(() => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: true })
  })

  it('shows sign-in and does not render the workspace', async () => {
    const { findByTestId, queryByTestId } = renderApp()
    expect(await findByTestId('sign-in-button')).toBeTruthy()
    expect(queryByTestId('channel-tree')).toBeNull()
  })

  it('shows an offline warning before sign-in', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false })
    const { findByTestId } = renderApp()

    expect(await findByTestId('connection-error')).toHaveTextContent('ネットワークに接続できません')
  })
})
