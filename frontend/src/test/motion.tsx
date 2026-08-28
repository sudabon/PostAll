import { LazyMotion, domAnimation } from 'motion/react'
import type { ReactNode } from 'react'

/**
 * `m` コンポーネントはアニメーション機能を LazyMotion から受け取るため、
 * プロバイダなしで描画すると `initial` の値のまま止まる。
 * アプリのルート（main.tsx）と同じ機能セットをテストにも与える。
 */
export function MotionTestProvider({ children }: { children: ReactNode }) {
  return <LazyMotion features={domAnimation}>{children}</LazyMotion>
}
