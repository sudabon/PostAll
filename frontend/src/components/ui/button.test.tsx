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

  it('does not enter a pressed state when disabled', () => {
    render(<Button disabled>Save</Button>)
    const button = screen.getByRole('button', { name: 'Save' })

    fireEvent.pointerDown(button, { pointerId: 1, button: 0 })

    expect(button).not.toHaveAttribute('data-pressed')
    expect(button).toBeDisabled()
  })
})
