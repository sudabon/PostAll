import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { usePressable } from './usePressable'

afterEach(cleanup)

function PressableHarness({ onPress }: { onPress: () => void }) {
  const { isPressed, pressProps } = usePressable<HTMLButtonElement>({ onPress })
  return (
    <button
      type="button"
      {...pressProps}
      data-testid="pressable"
      data-pressed={isPressed}
    >
      Press
    </button>
  )
}

function preparePressable(onPress = vi.fn()) {
  render(<PressableHarness onPress={onPress} />)
  const element = screen.getByTestId('pressable')
  element.getBoundingClientRect = () => ({
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
  element.setPointerCapture = vi.fn()
  element.releasePointerCapture = vi.fn()
  return { element, onPress }
}

describe('usePressable', () => {
  it('responds immediately, cancels outside the padded bounds, and commits after re-entry', () => {
    const { element, onPress } = preparePressable()

    fireEvent.pointerDown(element, { pointerId: 1, button: 0, clientX: 50, clientY: 20 })
    expect(element).toHaveAttribute('data-pressed', 'true')

    fireEvent.pointerMove(element, { pointerId: 1, clientX: 111, clientY: 20 })
    expect(element).toHaveAttribute('data-pressed', 'false')

    fireEvent.pointerMove(element, { pointerId: 1, clientX: 105, clientY: 20 })
    expect(element).toHaveAttribute('data-pressed', 'true')

    fireEvent.pointerUp(element, { pointerId: 1, clientX: 105, clientY: 20 })
    expect(onPress).toHaveBeenCalledTimes(1)
    expect(element).toHaveAttribute('data-pressed', 'false')
  })

  it('does not commit when the pointer is released outside the padded bounds', () => {
    const { element, onPress } = preparePressable()

    fireEvent.pointerDown(element, { pointerId: 2, button: 0, clientX: 50, clientY: 20 })
    fireEvent.pointerUp(element, { pointerId: 2, clientX: 120, clientY: 20 })

    expect(onPress).not.toHaveBeenCalled()
    expect(element).toHaveAttribute('data-pressed', 'false')
  })
})
