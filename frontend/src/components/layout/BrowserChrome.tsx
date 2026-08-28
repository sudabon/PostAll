import { Settings } from 'lucide-react'
import { usePlatform } from '@/platform'
import { useUi } from '@/state/ui'
import { Button } from '@/components/ui/button'

export function BrowserChrome() {
  const platform = usePlatform()
  if (platform.has('appMenu')) return null
  return (
    <div className="ml-auto flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        data-testid="settings-button"
        aria-label="設定"
        title="設定"
        onClick={() => useUi.getState().setSettingsOpen(true)}
      >
        <Settings className="size-4" />
      </Button>
    </div>
  )
}
