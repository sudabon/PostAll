import { useEffect } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { SignInScreen } from '@/components/auth/SignInScreen'
import { AppShell } from '@/components/layout/AppShell'
import { SettingsDialog } from '@/components/settings/SettingsDialog'
import { SearchDialog } from '@/components/search/SearchDialog'
import { UpdateBanner } from '@/components/pwa/UpdateBanner'
import { useChannels } from '@/hooks/useChannels'
import { useShellChrome } from '@/hooks/useShellChrome'
import { useChangeSync } from '@/hooks/useChangeSync'
import { useOnline } from '@/hooks/useOnline'
import { useSettings } from '@/state/settings'
import { useUi } from '@/state/ui'

export default function App() {
  const { ready, signedIn, api } = useAuth()
  useShellChrome()
  const theme = useSettings((s) => s.theme)
  const connectionState = useUi((s) => s.connectionState)
  const searchOpen = useUi((s) => s.searchOpen)
  const { data: channels = [] } = useChannels()
  const online = useOnline()
  useChangeSync(signedIn)
  const offline = !online || connectionState === 'offline'
  const syncStatusMessage = connectionState === 'offline'
    ? '接続されていません。変更操作は利用できません'
    : connectionState === 'degraded'
      ? 'リアルタイム更新へ再接続中'
      : connectionState === 'connecting'
        ? 'リアルタイム更新へ接続中'
        : null
  const statusMessage = signedIn && connectionState === 'offline'
    ? syncStatusMessage
    : !online
      ? 'ネットワークに接続できません'
      : null
  const syncHint = signedIn && !offline && syncStatusMessage
    ? syncStatusMessage
    : null

  useEffect(() => {
    const root = document.documentElement
    const apply = (pref: string) => {
      root.classList.remove('light', 'dark')
      if (pref === 'system') {
        root.classList.add(window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')
      } else {
        root.classList.add(pref)
      }
    }
    apply(theme)
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => {
      if (useSettings.getState().theme === 'system') apply('system')
    }
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [theme])

  if (!ready) return <div className="p-8 text-muted-foreground">読み込み中…</div>
  return (
    <>
      {signedIn ? <AppShell /> : <SignInScreen />}
      <SettingsDialog />
      <UpdateBanner />
      {signedIn ? (
        <SearchDialog
          open={searchOpen}
          channels={channels}
          search={(input) => api.searchPosts(input)}
          onClose={() => useUi.getState().setSearchOpen(false)}
          onSelect={(result) => useUi.getState().navigateToSearchResult(result)}
        />
      ) : null}
      {statusMessage ? (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border border-destructive bg-card px-4 py-3 shadow"
          data-testid="connection-error"
        >
          <p className="text-sm">{statusMessage}</p>
          <button
            type="button"
            className="mt-1 text-sm text-primary"
            onClick={() => {
              if (!navigator.onLine) {
                window.location.reload()
                return
              }
              useUi.getState().setConnectionState('connecting')
              window.dispatchEvent(new Event('online'))
            }}
          >
            再試行
          </button>
        </div>
      ) : syncHint ? (
        <div
          aria-live="polite"
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md border bg-card px-4 py-3 shadow"
          data-testid="connection-status"
        >
          <p className="text-sm">{syncHint}</p>
        </div>
      ) : null}
    </>
  )
}
