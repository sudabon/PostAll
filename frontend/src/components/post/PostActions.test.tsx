import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/api/client'
import { MotionTestProvider } from '@/test/motion'
import { PostActions } from './PostActions'

const post: Post = {
  id: 'post-1',
  channelId: 'channel-1',
  threadRootId: 'root-1',
  authorId: 'author-1',
  body: 'original reply',
  createdAt: '2026-08-26T00:00:00Z',
  updatedAt: '2026-08-26T00:00:00Z',
  editedAt: null,
  deleted: false,
  replyCount: 0,
  lastReplyAt: null,
  reactions: [],
  attachments: [
    {
      id: 'attachment-1',
      postId: 'post-1',
      fileName: 'keep.txt',
      contentType: 'text/plain',
      sizeBytes: 4,
      checksum: 'keep',
      createdAt: '2026-08-26T00:00:00Z',
    },
    {
      id: 'attachment-2',
      postId: 'post-1',
      fileName: 'remove.txt',
      contentType: 'text/plain',
      sizeBytes: 6,
      checksum: 'remove',
      createdAt: '2026-08-26T00:00:00Z',
    },
  ],
}

describe('PostActions', () => {
  afterEach(cleanup)

  it('edits a reply while removing one existing attachment', () => {
    const onEdit = vi.fn()
    render(
      <PostActions
        post={post}
        kind="返信"
        mutationDisabled={false}
        onEdit={onEdit}
        onDelete={vi.fn()}
      />,
      { wrapper: MotionTestProvider },
    )

    fireEvent.click(screen.getByRole('button', { name: /返信を編集/ }))
    const dialog = screen.getByRole('dialog', { name: '返信を編集' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /remove.txt/ }))
    fireEvent.change(within(dialog).getByLabelText('本文'), { target: { value: 'edited reply' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(onEdit).toHaveBeenCalledWith('edited reply', ['attachment-1'])
  })

  it('uses a native modal and restores focus after Escape', async () => {
    render(
      <PostActions
        post={post}
        kind="返信"
        mutationDisabled={false}
        onEdit={vi.fn()}
        onDelete={vi.fn()}
      />,
      { wrapper: MotionTestProvider },
    )
    const trigger = screen.getByRole('button', { name: /返信を編集/ })
    trigger.focus()
    fireEvent.click(trigger)

    const dialog = screen.getByRole('dialog', { name: '返信を編集' })
    expect(dialog.tagName).toBe('DIALOG')
    fireEvent(dialog, new Event('cancel', { cancelable: true }))

    await waitFor(() => expect(screen.queryByRole('dialog', { name: '返信を編集' })).toBeNull())
    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('reveals and reverses the action surface from its row hover state', async () => {
    render(
      <article className="group" data-testid="post-row">
        <PostActions
          post={post}
          kind="返信"
          mutationDisabled={false}
          onEdit={vi.fn()}
          onDelete={vi.fn()}
        />
      </article>,
      { wrapper: MotionTestProvider },
    )
    const row = screen.getByTestId('post-row')

    expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false')
    fireEvent.pointerEnter(row)
    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'true'))
    fireEvent.pointerLeave(row)
    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false'))
  })
})
