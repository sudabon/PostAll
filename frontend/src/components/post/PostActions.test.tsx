import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/api/client'
import { useUi } from '@/state/ui'
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
  attachments: [],
}

function renderActions(overrides: { onDelete?: () => void; mutationDisabled?: boolean } = {}) {
  const onDelete = overrides.onDelete ?? vi.fn()
  return {
    onDelete,
    ...render(
      <article className="group" data-testid="post-row">
        <PostActions
          post={post}
          kind="返信"
          mutationDisabled={overrides.mutationDisabled ?? false}
          onDelete={onDelete}
        />
      </article>,
      { wrapper: MotionTestProvider },
    ),
  }
}

describe('PostActions', () => {
  beforeEach(() => {
    useUi.getState().setEditingPost(null)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('starts editing the post instead of opening a dialog', () => {
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: /返信を編集/ }))

    expect(useUi.getState().editingPostId).toBe('post-1')
    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('does not advertise a dialog on the edit trigger', () => {
    renderActions()
    const trigger = screen.getByRole('button', { name: /返信を編集/ })

    expect(trigger).not.toHaveAttribute('aria-haspopup')
    expect(trigger).not.toHaveAttribute('aria-expanded')
  })

  it('returns focus to the edit trigger once the edit ends', async () => {
    renderActions()
    const trigger = screen.getByRole('button', { name: /返信を編集/ })
    trigger.focus()
    fireEvent.click(trigger)

    act(() => useUi.getState().setEditingPost(null))

    await waitFor(() => expect(trigger).toHaveFocus())
  })

  it('deletes only after the confirmation is accepted', () => {
    const { onDelete } = renderActions()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)

    fireEvent.click(screen.getByRole('button', { name: /返信を削除/ }))
    expect(confirm).toHaveBeenCalledWith('この返信を削除しますか？')
    expect(onDelete).not.toHaveBeenCalled()

    confirm.mockReturnValue(true)
    fireEvent.click(screen.getByRole('button', { name: /返信を削除/ }))
    expect(onDelete).toHaveBeenCalledTimes(1)
  })

  it('does not render a menu trigger when the pointer can hover', () => {
    renderActions()

    expect(screen.queryByRole('button', { name: /返信の操作/ })).toBeNull()
  })

  it('reveals and reverses the action surface from its row hover state', async () => {
    renderActions()
    const row = screen.getByTestId('post-row')

    expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false')
    fireEvent.pointerEnter(row)
    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'true'))
    fireEvent.pointerLeave(row)
    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false'))
  })
})

describe('PostActions on an installed PWA', () => {
  beforeEach(() => {
    useUi.getState().setEditingPost(null)
    vi.spyOn(window, 'matchMedia').mockImplementation(
      (query: string) =>
        ({
          matches: query === '(display-mode: standalone)',
          media: query,
          onchange: null,
          addEventListener: () => {},
          removeEventListener: () => {},
          dispatchEvent: () => false,
        }) as unknown as MediaQueryList,
    )
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('shows a persistent menu trigger while the actions stay hidden', () => {
    renderActions()

    expect(screen.getByRole('button', { name: /返信の操作/ })).toBeInTheDocument()
    expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false')
  })

  it('ignores row hover so an incidental pointer event cannot reveal the actions', () => {
    renderActions()

    fireEvent.pointerEnter(screen.getByTestId('post-row'))

    expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false')
  })

  it('swaps the menu trigger for the actions when the trigger is tapped', async () => {
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: /返信の操作/ }))

    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'true'))
    expect(screen.queryByRole('button', { name: /返信の操作/ })).toBeNull()
  })

  it('moves focus onto the edit action once the menu opens', async () => {
    renderActions()

    fireEvent.click(screen.getByRole('button', { name: /返信の操作/ }))

    await waitFor(() => expect(screen.getByRole('button', { name: /返信を編集/ })).toHaveFocus())
  })

  it('closes the actions when a pointer lands outside the row', async () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /返信の操作/ }))
    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'true'))

    fireEvent.pointerDown(document.body)

    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false'))
  })

  it('closes the actions when Escape is pressed', async () => {
    renderActions()
    fireEvent.click(screen.getByRole('button', { name: /返信の操作/ }))
    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'true'))

    fireEvent.keyDown(document, { key: 'Escape' })

    await waitFor(() => expect(screen.getByTestId('post-actions')).toHaveAttribute('data-visible', 'false'))
  })
})
