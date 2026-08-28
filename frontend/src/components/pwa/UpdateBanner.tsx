import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { Button } from '@/components/ui/button'
import { springPresets } from '@/lib/motion/springs'
import { applyPwaUpdate } from '@/pwa/register'
import { useUi } from '@/state/ui'

export function UpdateBanner() {
  const available = useUi((s) => s.updateAvailable)
  const shouldReduceMotion = useReducedMotion()
  return (
    <AnimatePresence>
      {available ? (
        <m.div
          initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, y: -20 }}
          transition={shouldReduceMotion ? { duration: 0.14, ease: 'easeOut' } : springPresets.sheet}
          className="material-regular fixed left-1/2 top-3 z-50 -translate-x-1/2 rounded-xl border border-border px-4 py-3 shadow-md"
          data-testid="update-banner"
        >
          <p className="text-body font-medium">新しいバージョンがあります</p>
          <Button type="button" variant="ghost" size="sm" className="mt-1 h-8 px-2 text-primary" onClick={() => applyPwaUpdate()}>
            更新を適用
          </Button>
        </m.div>
      ) : null}
    </AnimatePresence>
  )
}
