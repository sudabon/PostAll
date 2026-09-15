import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/api/client'
import { createFakeAdapter, PlatformProvider } from '@/platform'
import { useUi } from '@/state/ui'
import { MotionTestProvider } from '@/test/motion'
import { ThreadPanel } from './ThreadPanel'

const mocks = vi.hoisted(() => ({
  getThread: vi.fn(),
  createReply: vi.fn(),
  deletePost: vi.fn(),
  listEmojis: vi.fn(),
  getEmojiImage: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ api: mocks, signedIn: true }),
}))

const channelId = '11111111-1111-1111-1111-111111111111'
const rootId = '22222222-2222-2222-2222-222222222222'
const replyId = '33333333-3333-3333-3333-333333333333'

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: rootId,
    channelId,
    authorId: '44444444-4444-4444-4444-444444444444',
    body: '親ポスト',
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
    editedAt: null,
    deleted: false,
    replyCount: 1,
    attachments: [],
    reactions: [],
    ...overrides,
  }
}

const reply = post({ id: replyId, body: '既存の返信', threadRootId: rootId, replyCount: 0 })

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function renderThread() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <PlatformProvider adapter={createFakeAdapter()}>
      <QueryClientProvider client={client}>
        <ThreadPanel channelId={channelId} />
      </QueryClientProvider>
    </PlatformProvider>,
    { wrapper: MotionTestProvider },
  )
  await screen.findByText('既存の返信')
  return client
}

function submitReply(body: string) {
  fireEvent.change(screen.getByTestId('composer-input'), { target: { value: body } })
  fireEvent.submit(screen.getByTestId('thread-composer'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.getThread.mockResolvedValue({ root: post(), replies: [reply] })
  mocks.listEmojis.mockResolvedValue([])
  useUi.setState({
    canMutate: true,
    editingPostId: null,
    threadPostId: rootId,
    targetThreadReplyId: null,
    pendingPosts: [],
    deletingPostIds: [],
    failedDeletes: {},
  })
})

describe('ThreadPanel optimistic reply', () => {
  it('shows the reply before the server responds without changing the reply count', async () => {
    const request = deferred<Post>()
    mocks.createReply.mockReturnValue(request.promise)
    const client = await renderThread()

    submitReply('送った返信')

    expect(await screen.findByText('送った返信')).toBeVisible()
    await waitFor(() => expect(screen.getByTestId('composer-input')).toHaveValue(''))
    // 確定前の返信は件数に数えない。タイムラインが読むのは root.replyCount だけ。
    expect(client.getQueryData<{ root: Post }>(['thread', rootId])?.root.replyCount).toBe(1)

    await act(async () =>
      request.resolve(post({ id: '55555555-5555-5555-5555-555555555555', body: '送った返信', threadRootId: rootId })),
    )
  })

  it('keeps the input in the composer when the connection is unavailable', async () => {
    await renderThread()
    act(() => {
      useUi.getState().setConnectionState('offline')
    })

    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: '届かない返信' } })
    fireEvent.submit(screen.getByTestId('thread-composer'))

    await waitFor(() => expect(screen.getByTestId('composer-input')).toHaveValue('届かない返信'))
    expect(document.querySelector('[data-testid^="pending-post-"]')).toBeNull()
    expect(mocks.createReply).not.toHaveBeenCalled()
  })

  it('keeps the failed reply in place and resends it on retry', async () => {
    mocks.createReply.mockRejectedValueOnce(new Error('reply failed'))
    await renderThread()

    submitReply('拒否される返信')

    expect(await screen.findByRole('button', { name: '再送' })).toBeVisible()
    expect(screen.getByText('拒否される返信')).toBeVisible()

    const resent = post({ id: '66666666-6666-6666-6666-666666666666', body: '拒否される返信', threadRootId: rootId })
    mocks.createReply.mockResolvedValueOnce(resent)
    fireEvent.click(screen.getByRole('button', { name: '再送' }))

    await waitFor(() => expect(screen.queryByRole('button', { name: '再送' })).toBeNull())
    expect(mocks.createReply).toHaveBeenLastCalledWith(rootId, '拒否される返信', [])
  })
})

describe('ThreadPanel optimistic delete', () => {
  async function confirmDelete() {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    fireEvent.pointerEnter(screen.getByText('既存の返信'))
    fireEvent.click(await screen.findByRole('button', { name: /返信を削除: 既存の返信/ }))
  }

  it('removes the reply as soon as the deletion is approved', async () => {
    const request = deferred<void>()
    mocks.deletePost.mockReturnValue(request.promise)
    await renderThread()

    await confirmDelete()

    await waitFor(() => expect(screen.queryByText('既存の返信')).toBeNull())

    await act(async () => request.resolve())
  })

  it('restores the reply and offers a retry when the delete is rejected', async () => {
    mocks.deletePost.mockRejectedValueOnce(new Error('delete failed'))
    await renderThread()

    await confirmDelete()

    const restored = await screen.findByText('既存の返信')
    expect(restored).toBeVisible()
    expect(screen.getByRole('alert')).toHaveTextContent('削除できませんでした。')

    mocks.deletePost.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))

    await waitFor(() => expect(screen.queryByText('既存の返信')).toBeNull())
  })
})
