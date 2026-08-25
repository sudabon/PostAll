import { StrictMode, useEffect, useState, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.tsx'
import { AuthProvider } from '@/auth/AuthProvider'
import { PlatformProvider, getPlatform } from '@/platform'
import { registerPwa } from '@/pwa/register'
import { loadSettings, watchSettings } from '@/state/settings'
import { loadUi, watchUi } from '@/state/ui'

const queryClient = new QueryClient()

function Boot({ children }: { children: ReactNode }) {
  const [booted, setBooted] = useState(false)

  useEffect(() => {
    const adapter = getPlatform()
    let unsubSettings = () => {}
    let unsubUi = () => {}
    let cancelled = false
    void (async () => {
      await loadSettings(adapter)
      await loadUi(adapter)
      if (cancelled) return
      unsubSettings = watchSettings(adapter)
      unsubUi = watchUi(adapter)
      setBooted(true)
    })()
    return () => {
      cancelled = true
      unsubSettings()
      unsubUi()
    }
  }, [])

  if (!booted) return <div className="p-8 text-muted-foreground">読み込み中…</div>
  return children
}

registerPwa()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <PlatformProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <Boot>
            <App />
          </Boot>
        </AuthProvider>
      </QueryClientProvider>
    </PlatformProvider>
  </StrictMode>,
)
