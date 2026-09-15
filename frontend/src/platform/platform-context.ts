import { createContext, useContext } from 'react'
import { createPlatformAdapter } from './create'
import type { PlatformAdapter } from './types'

export const defaultAdapter = createPlatformAdapter()
export const PlatformContext = createContext<PlatformAdapter>(defaultAdapter)

export function usePlatform(): PlatformAdapter {
  return useContext(PlatformContext)
}

export function getPlatform(): PlatformAdapter {
  return defaultAdapter
}
