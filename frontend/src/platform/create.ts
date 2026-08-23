import { createBrowserAdapter } from './browser'
import { createElectronAdapter } from './electron'
import { createFakeAdapter } from './fake'
import type { PlatformAdapter } from './types'

export function createPlatformAdapter(): PlatformAdapter {
  if (import.meta.env.VITE_E2E === 'true') {
    return createFakeAdapter({
      durable: window.localStorage,
      seedSecrets: {
        'auth.tokens': JSON.stringify({
          accessToken: 'e2e-access',
          idToken: 'e2e-id',
          refreshToken: 'e2e-refresh',
          expiresAt: Date.now() + 24 * 60 * 60 * 1000,
        }),
      },
    })
  }
  if (typeof window !== 'undefined' && window.postallPlatform?.kind === 'electron') {
    return createElectronAdapter()
  }
  return createBrowserAdapter()
}
