import { createContext, useContext, type ReactNode } from 'react'
import { createPlatformAdapter } from './create'
import type { PlatformAdapter } from './types'

const defaultAdapter = createPlatformAdapter()
const PlatformContext = createContext<PlatformAdapter>(defaultAdapter)

export function PlatformProvider({
  children,
  adapter,
}: {
  children: ReactNode
  adapter?: PlatformAdapter
}) {
  return <PlatformContext.Provider value={adapter ?? defaultAdapter}>{children}</PlatformContext.Provider>
}

export function usePlatform(): PlatformAdapter {
  return useContext(PlatformContext)
}

export function getPlatform(): PlatformAdapter {
  return defaultAdapter
}
