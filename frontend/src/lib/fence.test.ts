import { describe, expect, it } from 'vitest'
import { insertCodeFence, isInsideUnclosedFence } from './fence'

describe('fence', () => {
  it('detects an unclosed fence before the cursor', () => {
    expect(isInsideUnclosedFence('```js\nconst x = 1', 16)).toBe(true)
    expect(isInsideUnclosedFence('```js\nconst x = 1\n```\n', 22)).toBe(false)
    expect(isInsideUnclosedFence('hello', 5)).toBe(false)
  })

  it('inserts a fence and places the cursor after the opening ticks', () => {
    const next = insertCodeFence('ab', 1, 1)
    expect(next.value).toBe('a```\n```b')
    expect(next.cursor).toBe(4)
  })
})
