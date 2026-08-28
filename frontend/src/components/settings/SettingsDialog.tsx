import { useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { useOverlayPresence } from '@/lib/motion/useOverlayPresence'
import { usePlatform } from '@/platform'
import { useSettings, type ThemePref } from '@/state/settings'
import { useUi } from '@/state/ui'

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  const onClose = () => useUi.getState().setSettingsOpen(false)
  const {
    dialogRef,
    shouldRender,
    isPresent,
    onCancel,
    onExitComplete,
    motionProps,
  } = useOverlayPresence({ open, onClose })

  if (!shouldRender) return null
  return (
    <dialog
      ref={dialogRef}
      className="m-auto h-dvh max-h-none w-dvw max-w-none overflow-visible border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent"
      aria-labelledby="settings-title"
      data-testid="settings-dialog"
      onCancel={onCancel}
    >
      <AnimatePresence onExitComplete={onExitComplete}>
        {isPresent ? (
          <m.div
            key="settings-overlay"
            {...motionProps.backdrop}
            className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) onClose()
            }}
          >
            <m.div
              {...motionProps.surface}
              className="material-thick w-full max-w-md rounded-xl border border-border p-6 text-foreground shadow-lg"
            >
              <SettingsForm />
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  )
}

function SettingsForm() {
  const { signedIn, signOut } = useAuth()
  const settings = useSettings()
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl)
  const [supabaseUrl, setSupabaseUrl] = useState(settings.supabaseUrl)
  const [supabasePublishableKey, setSupabasePublishableKey] = useState(settings.supabasePublishableKey)
  const [theme, setTheme] = useState<ThemePref>(settings.theme)

  return (
    <>
        <h2 id="settings-title" className="mb-4 text-heading font-semibold">設定</h2>
        <GlobalShortcutHint />
        <label className="mb-3 block text-body">
          API 接続先
          <input
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
          />
        </label>
        <label className="mb-3 block text-body">
          Supabase プロジェクト URL
          <input
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={supabaseUrl}
            onChange={(e) => setSupabaseUrl(e.target.value)}
            placeholder="https://xxxx.supabase.co"
          />
        </label>
        <label className="mb-3 block text-body">
          Supabase publishable key
          <input
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={supabasePublishableKey}
            onChange={(e) => setSupabasePublishableKey(e.target.value)}
          />
        </label>
        <label className="mb-4 block text-body">
          テーマ
          <select
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            value={theme}
            onChange={(e) => setTheme(e.target.value as ThemePref)}
          >
            <option value="system">システムに従う</option>
            <option value="light">ライト</option>
            <option value="dark">ダーク</option>
          </select>
        </label>
        <div className="flex justify-end gap-2">
          {signedIn ? (
            <Button
              type="button"
              variant="ghost"
              data-testid="sign-out-button"
              onClick={() => {
                void signOut()
                useUi.getState().setSettingsOpen(false)
              }}
            >
              サインアウト
            </Button>
          ) : null}
          <Button type="button" variant="ghost" onClick={() => useUi.getState().setSettingsOpen(false)}>
            閉じる
          </Button>
          <Button
            type="button"
            onClick={() => {
              useSettings.getState().update({ apiBaseUrl, supabaseUrl, supabasePublishableKey, theme })
              useUi.getState().setSettingsOpen(false)
            }}
          >
            保存
          </Button>
        </div>
    </>
  )
}

function GlobalShortcutHint() {
  const platform = usePlatform()
  if (!platform.has('globalShortcuts')) return null
  return (
    <p className="mb-3 text-body text-muted-foreground" data-testid="global-shortcut-hint">
      グローバルショートカットは OS のメニューから利用できます。
    </p>
  )
}
