import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DragRelease } from './useDragValue'
import { useDragValue } from './useDragValue'

afterEach(cleanup)

function DragHarness({ onRelease = () => {} }: { onRelease?: (release: DragRelease) => void }) {
  const [current, setCurrent] = useState(100)
  const drag = useDragValue({
    initialValue: 100,
    min: 80,
    max: 140,
    dimension: 60,
    snapPoints: [80, 140],
    onChange: setCurrent,
    onRelease,
  })

  return (
    <div data-testid="handle" {...drag.dragProps}>
      <output data-testid="value">{current}</output>
      <output data-testid="direction">{drag.direction ?? 'none'}</output>
    </div>
  )
}

function prepareDrag(onRelease = vi.fn<(release: DragRelease) => void>()) {
  render(<DragHarness onRelease={onRelease} />)
  const handle = screen.getByTestId('handle')
  handle.setPointerCapture = vi.fn()
  handle.releasePointerCapture = vi.fn()
  return { handle, onRelease }
}

function pointer(
  element: HTMLElement,
  type: 'pointerdown' | 'pointermove' | 'pointerup',
  { x, time, pointerId = 1 }: { x: number; time: number; pointerId?: number },
) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    button: { value: 0 },
    clientX: { value: x },
    clientY: { value: 0 },
    timeStamp: { value: time },
  })
  fireEvent(element, event)
}

describe('useDragValue', () => {
  it('preserves the grab offset and keeps tracking beyond the element bounds', () => {
    const { handle } = prepareDrag()

    pointer(handle, 'pointerdown', { x: 110, time: 0 })
    pointer(handle, 'pointermove', { x: 130, time: 50 })
    expect(screen.getByTestId('value')).toHaveTextContent('120')
    expect(handle.setPointerCapture).toHaveBeenCalledWith(1)

    pointer(handle, 'pointermove', { x: 200, time: 100 })
    const resisted = Number(screen.getByTestId('value').textContent)
    expect(resisted).toBeGreaterThan(140)
    expect(resisted).toBeLessThan(190)
  })

  it('leaves direction undecided until the movement threshold is crossed', () => {
    const { handle } = prepareDrag()

    pointer(handle, 'pointerdown', { x: 110, time: 0 })
    pointer(handle, 'pointermove', { x: 115, time: 20 })
    expect(screen.getByTestId('direction')).toHaveTextContent('none')

    pointer(handle, 'pointermove', { x: 125, time: 40 })
    expect(screen.getByTestId('direction')).toHaveTextContent('positive')
  })

  it('hands release velocity to the momentum spring and projected snap target', () => {
    const { handle, onRelease } = prepareDrag()

    pointer(handle, 'pointerdown', { x: 110, time: 0 })
    pointer(handle, 'pointermove', { x: 120, time: 50 })
    pointer(handle, 'pointerup', { x: 130, time: 100 })

    expect(onRelease).toHaveBeenCalledWith(expect.objectContaining({
      velocity: 200,
      target: 140,
      transition: expect.objectContaining({ velocity: 200 }),
    }))
    expect(handle.releasePointerCapture).toHaveBeenCalledWith(1)
  })
})
