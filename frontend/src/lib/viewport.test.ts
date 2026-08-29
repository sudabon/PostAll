import { describe, expect, it } from 'vitest'
import { keyboardBottomInset } from './viewport'

describe('keyboardBottomInset', () => {
  it('is zero when the visual viewport fills the window', () => {
    expect(keyboardBottomInset({ height: 844, offsetTop: 0 }, 844)).toBe(0)
  })

  it('matches the obscured height when the keyboard is open', () => {
    expect(keyboardBottomInset({ height: 500, offsetTop: 0 }, 844)).toBe(344)
  })

  it('accounts for visual viewport offset', () => {
    expect(keyboardBottomInset({ height: 500, offsetTop: 44 }, 844)).toBe(300)
  })
})
