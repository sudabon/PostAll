import { act, cleanup, render, screen } from '@testing-library/react'
import { useRef } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useScrollEdge } from './useScrollEdge'

afterEach(cleanup)

let notifyIntersection: (isIntersecting: boolean) => void
const observe = vi.fn()
const disconnect = vi.fn()

beforeEach(() => {
  observe.mockClear()
  disconnect.mockClear()
  class IntersectionObserverMock {
    constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
      expect(options?.root).toBe(screen.getByTestId('scroller'))
      notifyIntersection = (isIntersecting) => callback([
        { isIntersecting } as IntersectionObserverEntry,
      ], this as unknown as IntersectionObserver)
    }

    observe = observe
    disconnect = disconnect
  }
  vi.stubGlobal('IntersectionObserver', IntersectionObserverMock)
})

function ScrollHarness() {
  const rootRef = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isContentUnderChrome = useScrollEdge(rootRef, sentinelRef)
  return (
    <div ref={rootRef} data-testid="scroller">
      <div ref={sentinelRef} data-testid="sentinel" />
      <output>{isContentUnderChrome ? 'under' : 'clear'}</output>
    </div>
  )
}

describe('useScrollEdge', () => {
  it('marks content as under the chrome only after the leading sentinel leaves view', () => {
    render(<ScrollHarness />)
    expect(observe).toHaveBeenCalledWith(screen.getByTestId('sentinel'))

    act(() => notifyIntersection(true))
    expect(screen.getByText('clear')).toBeInTheDocument()

    act(() => notifyIntersection(false))
    expect(screen.getByText('under')).toBeInTheDocument()
  })
})
