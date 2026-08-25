import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/api/client'
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
    )

    fireEvent.click(screen.getByRole('button', { name: /返信を編集/ }))
    const dialog = screen.getByRole('dialog', { name: '返信を編集' })
    fireEvent.click(within(dialog).getByRole('checkbox', { name: /remove.txt/ }))
    fireEvent.change(within(dialog).getByLabelText('本文'), { target: { value: 'edited reply' } })
    fireEvent.click(within(dialog).getByRole('button', { name: '保存' }))

    expect(onEdit).toHaveBeenCalledWith('edited reply', ['attachment-1'])
  })
})
