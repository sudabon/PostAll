import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useOverlayPresence } from './useOverlayPresence'

afterEach(cleanup)

let showModal: ReturnType<typeof vi.fn>
let close: ReturnType<typeof vi.fn>

beforeEach(() => {
  showModal = vi.fn(function (this: HTMLDialogElement) {
    this.open = true
  })
  close = vi.fn(function (this: HTMLDialogElement) {
    this.open = false
  })
  HTMLDialogElement.prototype.showModal = showModal
  HTMLDialogElement.prototype.close = close
})

function OverlayHarness({ open, onClose = () => {} }: { open: boolean; onClose?: () => void }) {
  const {
    dialogRef,
    shouldRender,
    isPresent,
    onCancel,
    onExitComplete,
  } = useOverlayPresence({ open, onClose })
  if (!shouldRender) return null

  return (
    <dialog ref={dialogRef} data-testid="dialog" onCancel={onCancel}>
      {isPresent ? <div data-testid="surface" /> : null}
      <button type="button" data-testid="exit-complete" onClick={onExitComplete}>
        Complete exit
      </button>
    </dialog>
  )
}

describe('useOverlayPresence', () => {
  it('keeps the native dialog open until its exit animation completes', async () => {
    const { rerender } = render(<OverlayHarness open />)
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1))

    rerender(<OverlayHarness open={false} />)
    expect(screen.getByTestId('dialog')).toBeInTheDocument()
    expect(screen.queryByTestId('surface')).toBeNull()
    expect(close).not.toHaveBeenCalled()

    fireEvent.click(screen.getByTestId('exit-complete'))
    expect(close).toHaveBeenCalledTimes(1)
    expect(screen.queryByTestId('dialog')).toBeNull()
  })

  it('does not close when reopened before a stale exit completion arrives', async () => {
    const { rerender } = render(<OverlayHarness open />)
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1))

    rerender(<OverlayHarness open={false} />)
    rerender(<OverlayHarness open />)
    fireEvent.click(screen.getByTestId('exit-complete'))

    expect(close).not.toHaveBeenCalled()
    expect(screen.getByTestId('surface')).toBeInTheDocument()
  })

  it('routes native Escape cancellation through the controlled close request', async () => {
    const onClose = vi.fn()
    render(<OverlayHarness open onClose={onClose} />)
    await waitFor(() => expect(showModal).toHaveBeenCalledTimes(1))

    fireEvent(screen.getByTestId('dialog'), new Event('cancel', { cancelable: true }))

    expect(onClose).toHaveBeenCalledTimes(1)
  })
})
