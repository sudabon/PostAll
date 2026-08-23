import { usePlatform } from '@/platform'
import { useUi } from '@/state/ui'

export function BrowserChrome() {
  const platform = usePlatform()
  if (platform.has('appMenu')) return null
  return (
    <div className="ml-auto flex items-center gap-2">
      <button type="button" data-testid="settings-button" onClick={() => useUi.getState().setSettingsOpen(true)}>
        設定
      </button>
    </div>
  )
}
