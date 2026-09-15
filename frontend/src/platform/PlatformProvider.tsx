import type { ReactNode } from 'react'
import type { PlatformAdapter } from './types'
import { defaultAdapter, PlatformContext } from './platform-context'

export function PlatformProvider({
  children,
  adapter,
}: {
  children: ReactNode
  adapter?: PlatformAdapter
}) {
  return <PlatformContext.Provider value={adapter ?? defaultAdapter}>{children}</PlatformContext.Provider>
}
