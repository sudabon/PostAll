import { getPlatform } from '@/platform'
import { useUi } from '@/state/ui'

let updateSW: ((reloadPage?: boolean) => Promise<void>) | undefined

export function registerPwa() {
  if (import.meta.env.VITE_E2E === 'true') return
  if (getPlatform().kind === 'electron') return
  if (!('serviceWorker' in navigator)) return
  void import('virtual:pwa-register').then(({ registerSW }) => {
    updateSW = registerSW({
      immediate: true,
      onNeedRefresh() {
        useUi.getState().setUpdateAvailable(true)
      },
    })
  })
}

export function applyPwaUpdate() {
  useUi.getState().setUpdateAvailable(false)
  void updateSW?.(true)
}
