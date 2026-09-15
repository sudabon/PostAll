import { useEffect, useState, type ReactNode } from 'react'
import { getPlatform } from '@/platform'
import { loadSettings, watchSettings } from '@/state/settings'
import { loadUi, watchUi } from '@/state/ui'

export function Boot({ children }: { children: ReactNode }) {
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
