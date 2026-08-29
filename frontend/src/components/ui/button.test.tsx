import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './button'

afterEach(cleanup)

describe('Button', () => {
  it('shows immediate press feedback while preserving the native click contract', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })
    button.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 40,
      width: 100,
      height: 40,
      toJSON: () => ({}),
    })
    button.setPointerCapture = vi.fn()
    button.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(button, { pointerId: 1, button: 0, clientX: 50, clientY: 20 })
    expect(button).toHaveAttribute('data-pressed')

    fireEvent.pointerUp(button, { pointerId: 1, clientX: 50, clientY: 20 })
    expect(button).not.toHaveAttribute('data-pressed')
    expect(onClick).not.toHaveBeenCalled()

    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('fires once on a touch tap even when the element moves out from under the finger', () => {
    // iOS では押下後にレイアウトが動くと合成 click が飛んでこない。
    // タッチは「指が動いていないか」で判定して pointerup で発火させる。
    const onClick = vi.fn()
    render(<Button onClick={onClick}>返信</Button>)
    const button = screen.getByRole('button', { name: '返信' })
    const rectAt = (top: number) => () => ({
      x: 0, y: top, left: 0, top, right: 100, bottom: top + 40, width: 100, height: 40,
      toJSON: () => ({}),
    })
    button.getBoundingClientRect = rectAt(0)
    button.setPointerCapture = vi.fn()
    button.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 50, clientY: 20 })
    // 押している間にタイムラインがスクロールし、ボタンが指の下から抜ける
    button.getBoundingClientRect = rectAt(-300)
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 20 })

    expect(onClick).toHaveBeenCalledTimes(1)

    // 後から合成 click が届いても二重に実行しない
    fireEvent.click(button)
    expect(onClick).toHaveBeenCalledTimes(1)
  })

  it('ignores a touch that slides away before release', () => {
    const onClick = vi.fn()
    render(<Button onClick={onClick}>返信</Button>)
    const button = screen.getByRole('button', { name: '返信' })
    button.getBoundingClientRect = () => ({
      x: 0, y: 0, left: 0, top: 0, right: 100, bottom: 40, width: 100, height: 40, toJSON: () => ({}),
    })
    button.setPointerCapture = vi.fn()
    button.releasePointerCapture = vi.fn()

    fireEvent.pointerDown(button, { pointerId: 1, button: 0, pointerType: 'touch', clientX: 50, clientY: 20 })
    fireEvent.pointerMove(button, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 200 })
    fireEvent.pointerUp(button, { pointerId: 1, pointerType: 'touch', clientX: 50, clientY: 200 })

    expect(onClick).not.toHaveBeenCalled()
  })

  it('does not enter a pressed state when disabled', () => {
    render(<Button disabled>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })

    fireEvent.pointerDown(button, { pointerId: 1, button: 0 })

    expect(button).not.toHaveAttribute('data-pressed')
    expect(button).toBeDisabled()
  })
})
