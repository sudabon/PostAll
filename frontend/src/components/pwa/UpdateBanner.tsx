import { applyPwaUpdate } from '@/pwa/register'
import { useUi } from '@/state/ui'

export function UpdateBanner() {
  const available = useUi((s) => s.updateAvailable)
  if (!available) return null
  return (
    <div
      className="fixed top-3 left-1/2 z-50 -translate-x-1/2 rounded-md border border-border bg-card px-4 py-3 shadow"
      data-testid="update-banner"
    >
      <p className="text-sm">新しいバージョンがあります</p>
      <button type="button" className="mt-1 text-sm text-primary" onClick={() => applyPwaUpdate()}>
        更新を適用
      </button>
    </div>
  )
}
