import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Post } from '@/api/client'
import { createFakeAdapter, PlatformProvider } from '@/platform'
import { useUi } from '@/state/ui'
import { MotionTestProvider } from '@/test/motion'
import { Timeline } from './Timeline'

const mocks = vi.hoisted(() => ({
  listPosts: vi.fn(),
  createPost: vi.fn(),
  deletePost: vi.fn(),
  listEmojis: vi.fn(),
  getEmojiImage: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ api: mocks, signedIn: true }),
}))

const channelId = '11111111-1111-1111-1111-111111111111'
const postId = '22222222-2222-2222-2222-222222222222'
const otherPostId = '33333333-3333-3333-3333-333333333333'

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: postId,
    channelId,
    authorId: '44444444-4444-4444-4444-444444444444',
    body: '既存のポスト',
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
    editedAt: null,
    deleted: false,
    replyCount: 0,
    attachments: [],
    reactions: [],
    ...overrides,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((nextResolve, nextReject) => {
    resolve = nextResolve
    reject = nextReject
  })
  return { promise, resolve, reject }
}

async function renderTimeline() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  render(
    <PlatformProvider adapter={createFakeAdapter()}>
      <QueryClientProvider client={client}>
        <Timeline channelId={channelId} />
      </QueryClientProvider>
    </PlatformProvider>,
    { wrapper: MotionTestProvider },
  )
  await screen.findByText('既存のポスト')
  return client
}

function submitComposer(body: string) {
  fireEvent.change(screen.getByTestId('composer-input'), { target: { value: body } })
  fireEvent.submit(screen.getByTestId('composer'))
}

beforeEach(() => {
  vi.clearAllMocks()
  mocks.listPosts.mockResolvedValue({
    posts: [post(), post({ id: otherPostId, body: '後のポスト', createdAt: '2026-08-23T00:01:00Z' })],
    nextBefore: null,
  })
  mocks.listEmojis.mockResolvedValue([])
  useUi.setState({
    canMutate: true,
    editingPostId: null,
    targetPostId: null,
    timelineAnchorId: null,
    pendingPosts: [],
    deletingPostIds: [],
    failedDeletes: {},
  })
})

describe('Timeline optimistic create', () => {
  it('shows the post and empties the composer before the server responds', async () => {
    const request = deferred<Post>()
    mocks.createPost.mockReturnValue(request.promise)
    await renderTimeline()

    submitComposer('送ったポスト')

    expect(await screen.findByText('送ったポスト')).toBeVisible()
    await waitFor(() => expect(screen.getByTestId('composer-input')).toHaveValue(''))
    expect(mocks.createPost).toHaveBeenCalledWith(channelId, '送ったポスト', [])

    await act(async () => request.resolve(post({ id: '55555555-5555-5555-5555-555555555555', body: '送ったポスト' })))
  })

  it('keeps the input in the composer when the connection is unavailable', async () => {
    await renderTimeline()
    act(() => {
      useUi.getState().setConnectionState('offline')
    })

    fireEvent.change(screen.getByTestId('composer-input'), { target: { value: '届かないポスト' } })
    fireEvent.submit(screen.getByTestId('composer'))

    await waitFor(() => expect(screen.getByTestId('composer-input')).toHaveValue('届かないポスト'))
    expect(within(screen.getByTestId('timeline')).queryByText('届かないポスト')).toBeNull()
    expect(mocks.createPost).not.toHaveBeenCalled()
  })

  it('keeps the failed post in place with retry and discard', async () => {
    mocks.createPost.mockRejectedValueOnce(new Error('create failed'))
    await renderTimeline()

    submitComposer('拒否されるポスト')

    expect(await screen.findByRole('button', { name: '破棄' })).toBeVisible()
    expect(screen.getByText('拒否されるポスト')).toBeVisible()
    expect(screen.getByTestId('composer-input')).toHaveValue('')

    fireEvent.click(screen.getByRole('button', { name: '破棄' }))

    await waitFor(() => expect(screen.queryByText('拒否されるポスト')).toBeNull())
  })
})

describe('Timeline optimistic delete', () => {
  async function confirmDelete() {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    const row = screen.getByTestId(`post-${postId}`)
    fireEvent.pointerEnter(row)
    fireEvent.click(await screen.findByRole('button', { name: /ポストを削除: 既存のポスト/ }))
  }

  it('removes the row as soon as the deletion is approved', async () => {
    const request = deferred<void>()
    mocks.deletePost.mockReturnValue(request.promise)
    await renderTimeline()

    await confirmDelete()

    await waitFor(() => expect(screen.queryByText('既存のポスト')).toBeNull())
    expect(screen.getByText('後のポスト')).toBeVisible()

    await act(async () => request.resolve())
  })

  it('restores the row in place and offers a retry when the delete is rejected', async () => {
    mocks.deletePost.mockRejectedValueOnce(new Error('delete failed'))
    await renderTimeline()

    await confirmDelete()

    const restored = await screen.findByTestId(`post-${postId}`)
    expect(restored).toHaveTextContent('既存のポスト')
    expect(restored).toHaveTextContent('削除できませんでした。')
    const rows = screen.getAllByTestId(/^post-[0-9a-f]{8}-/).map((row) => row.dataset.testid)
    expect(rows).toEqual([`post-${postId}`, `post-${otherPostId}`])

    mocks.deletePost.mockResolvedValueOnce(undefined)
    fireEvent.click(screen.getByRole('button', { name: '再試行' }))

    await waitFor(() => expect(screen.queryByTestId(`post-${postId}`)).toBeNull())
  })
})
