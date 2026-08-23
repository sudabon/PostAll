import { afterEach, describe, expect, it } from 'vitest'
import { createBrowserAdapter } from './browser'

describe('browser adapter', () => {
  afterEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    const adapter = createBrowserAdapter()
    await adapter.deleteSecret('auth.tokens')
  })

  it('persists settings in localStorage but not tokens', async () => {
    const adapter = createBrowserAdapter()
    await adapter.setItem('settings', '{"theme":"dark"}')
    await adapter.setSecret('auth.tokens', '{"accessToken":"secret"}')
    expect(localStorage.getItem('postall:settings')).toBe('{"theme":"dark"}')
    expect(Object.keys(localStorage).some((k) => localStorage.getItem(k)?.includes('secret'))).toBe(false)
    expect(await adapter.getSecret('auth.tokens')).toBe('{"accessToken":"secret"}')
    expect(sessionStorage.getItem('postall:secret:auth.tokens')).toBe('{"accessToken":"secret"}')
  })

  it('reports browser capabilities', () => {
    const adapter = createBrowserAdapter()
    expect(adapter.has('appMenu')).toBe(false)
    expect(adapter.has('globalShortcuts')).toBe(false)
    expect(adapter.has('nativeFileOpen')).toBe(false)
    expect(adapter.has('osNotifications')).toBe(true)
  })
})
