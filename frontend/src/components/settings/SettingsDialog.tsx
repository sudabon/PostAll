import { useState } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { Button } from '@/components/ui/button'
import { usePlatform } from '@/platform'
import { useSettings, type ThemePref } from '@/state/settings'
import { useUi } from '@/state/ui'

export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  if (!open) return null
  return <SettingsForm />
}

function SettingsForm() {
  const { signedIn, signOut } = useAuth()
  const settings = useSettings()
  const [apiBaseUrl, setApiBaseUrl] = useState(settings.apiBaseUrl)
  const [cognitoDomain, setCognitoDomain] = useState(settings.cognitoDomain)
  const [cognitoClientId, setCognitoClientId] = useState(settings.cognitoClientId)
  const [theme, setTheme] = useState<ThemePref>(settings.theme)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" data-testid="settings-dialog">
      <div className="w-full max-w-md rounded-lg border border-border bg-card p-6 text-card-foreground shadow-lg">
        <h2 className="mb-4 text-lg font-semibold">設定</h2>
        <GlobalShortcutHint />
        <label className="mb-3 block text-sm">
          API 接続先
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            value={apiBaseUrl}
            onChange={(e) => setApiBaseUrl(e.target.value)}
          />
        </label>
        <label className="mb-3 block text-sm">
          Cognito ドメイン
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            value={cognitoDomain}
            onChange={(e) => setCognitoDomain(e.target.value)}
            placeholder="xxx.auth.ap-northeast-1.amazoncognito.com"
          />
        </label>
        <label className="mb-3 block text-sm">
          Cognito クライアント ID
          <input
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
            value={cognitoClientId}
            onChange={(e) => setCognitoClientId(e.target.value)}
          />
        </label>
        <label className="mb-4 block text-sm">
          テーマ
          <select
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2"
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
              useSettings.getState().update({ apiBaseUrl, cognitoDomain, cognitoClientId, theme })
              useUi.getState().setSettingsOpen(false)
            }}
          >
            保存
          </Button>
        </div>
      </div>
    </div>
  )
}

function GlobalShortcutHint() {
  const platform = usePlatform()
  if (!platform.has('globalShortcuts')) return null
  return (
    <p className="mb-3 text-sm text-muted-foreground" data-testid="global-shortcut-hint">
      グローバルショートカットは OS のメニューから利用できます。
    </p>
  )
}
