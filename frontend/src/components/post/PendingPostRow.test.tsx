import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { PendingPost } from '@/state/ui'
import { MotionTestProvider } from '@/test/motion'
import { PendingPostRow, pendingFailureMessage } from './PendingPostRow'

vi.mock('@/components/attachments/AttachmentGallery', () => ({
  AttachmentGallery: ({ items }: { items: unknown[] }) =>
    items.length > 0 ? <div data-testid="attachment-gallery" /> : null,
}))

function pending(overrides: Partial<PendingPost> = {}): PendingPost {
  return {
    key: 'pending-key',
    channelId: 'channel-1',
    threadRootId: null,
    body: '送信する本文',
    attachments: [],
    createdAt: '2026-09-04T12:00:00Z',
    status: 'sending',
    ...overrides,
  }
}

function renderRow(overrides: Partial<PendingPost> = {}, mutationDisabled = false) {
  const onRetry = vi.fn()
  const onDiscard = vi.fn()
  render(
    <PendingPostRow
      pending={pending(overrides)}
      mutationDisabled={mutationDisabled}
      onRetry={onRetry}
      onDiscard={onDiscard}
    />,
    { wrapper: MotionTestProvider },
  )
  return { onRetry, onDiscard }
}

describe('PendingPostRow', () => {
  it('shows the body without any post affordance while sending', () => {
    renderRow()

    expect(screen.getByText('送信する本文')).toBeInTheDocument()
    expect(screen.getByText('送信中')).toBeInTheDocument()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByTestId('post-actions')).toBeNull()
    expect(screen.queryByText(/スレッドで返信/)).toBeNull()
    expect(screen.queryByText(/件の返信/)).toBeNull()
    expect(document.querySelector('[data-testid^="reactions-"]')).toBeNull()
  })

  it('offers retry and discard once the send has failed', () => {
    const { onRetry, onDiscard } = renderRow({ status: 'failed' })

    expect(screen.getByRole('alert')).toHaveTextContent(pendingFailureMessage)

    fireEvent.click(screen.getByRole('button', { name: '再送' }))
    fireEvent.click(screen.getByRole('button', { name: '破棄' }))

    expect(onRetry).toHaveBeenCalledOnce()
    expect(onDiscard).toHaveBeenCalledOnce()
  })

  it('keeps discard available but blocks retry while disconnected', () => {
    renderRow({ status: 'failed' }, true)

    expect(screen.getByRole('button', { name: '再送' })).toBeDisabled()
    expect(screen.getByRole('button', { name: '破棄' })).toBeEnabled()
  })
})
