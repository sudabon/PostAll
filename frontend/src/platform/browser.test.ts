import { afterEach, describe, expect, it } from 'vitest'
import { createBrowserAdapter } from './browser'

describe('browser adapter', () => {
  afterEach(async () => {
    localStorage.clear()
    sessionStorage.clear()
    const adapter = createBrowserAdapter()
    await adapter.deleteSecret('auth.tokens')
  })

  it('persists settings and tokens in localStorage, not sessionStorage', async () => {
    const adapter = createBrowserAdapter()
    await adapter.setItem('settings', '{"theme":"dark"}')
    await adapter.setSecret('auth.tokens', '{"accessToken":"secret"}')
    expect(localStorage.getItem('postall:settings')).toBe('{"theme":"dark"}')
    expect(localStorage.getItem('postall:secret:auth.tokens')).toBe('{"accessToken":"secret"}')
    expect(sessionStorage.getItem('postall:secret:auth.tokens')).toBeNull()
    expect(await adapter.getSecret('auth.tokens')).toBe('{"accessToken":"secret"}')
  })

  it('restores tokens from localStorage after a new adapter is created', async () => {
    const first = createBrowserAdapter()
    await first.setSecret('auth.tokens', '{"refreshToken":"keep"}')
    const second = createBrowserAdapter()
    expect(await second.getSecret('auth.tokens')).toBe('{"refreshToken":"keep"}')
  })

  it('reports browser capabilities', () => {
    const adapter = createBrowserAdapter()
    expect(adapter.has('appMenu')).toBe(false)
    expect(adapter.has('globalShortcuts')).toBe(false)
    expect(adapter.has('nativeFileOpen')).toBe(false)
    expect(adapter.has('osNotifications')).toBe(true)
  })
})
