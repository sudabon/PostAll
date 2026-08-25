import { describe, expect, it } from 'vitest'
import { isAppShellPath, shouldCacheUrl } from './rules'

describe('pwa cache rules', () => {
  it('treats html js css icons as app shell', () => {
    expect(isAppShellPath('/index.html')).toBe(true)
    expect(isAppShellPath('/assets/index-abc.js')).toBe(true)
    expect(isAppShellPath('/icons/icon-192.png')).toBe(true)
  })

  it('does not cache channels posts or attachments', () => {
    expect(isAppShellPath('/v1/channels')).toBe(false)
    expect(isAppShellPath('/v1/channels/1/posts')).toBe(false)
    expect(isAppShellPath('/health')).toBe(false)
    expect(isAppShellPath('/v1/posts/x/attachments/y')).toBe(false)
    expect(shouldCacheUrl(new URL('https://memo.sudabon.com/v1/channels'))).toBe(false)
  })
})
