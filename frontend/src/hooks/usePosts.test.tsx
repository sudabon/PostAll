import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, Post } from '@/api/client'
import { useUi } from '@/state/ui'
import { usePostMutations, useTimeline } from './usePosts'

const mocks = vi.hoisted(() => ({
  listPosts: vi.fn(),
  editPost: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    api: { listPosts: mocks.listPosts, editPost: mocks.editPost },
    signedIn: true,
  }),
}))

beforeEach(() => {
  mocks.listPosts.mockReset()
  mocks.editPost.mockReset()
  useUi.setState({
    canMutate: true,
    editingPostId: null,
    autoOpenedEditPostId: null,
    failedEdits: {},
  })
})

const channelId = '11111111-1111-1111-1111-111111111111'
const postId = '22222222-2222-2222-2222-222222222222'

const attachment: Attachment = {
  id: '55555555-5555-5555-5555-555555555555',
  postId,
  fileName: 'edited.txt',
  contentType: 'text/plain',
  sizeBytes: 6,
  checksum: '',
  createdAt: '',
}

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: postId,
    channelId,
    authorId: '44444444-4444-4444-4444-444444444444',
    body: 'before',
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

function wrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function mutationClient() {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

function seedPostQueries(client: QueryClient) {
  const timeline = { pages: [{ posts: [post()], nextBefore: null }], pageParams: [undefined] }
  const thread = { root: post({ id: 'root-post' }), replies: [post()] }
  client.setQueryData(['posts', channelId], timeline)
  client.setQueryData(['thread', 'root-post'], thread)
  return { timeline, thread }
}

describe('useTimeline around navigation', () => {
  it('uses around only for the initial page and continues with the returned cursor', async () => {
    mocks.listPosts
      .mockResolvedValueOnce({ posts: [], nextBefore: 'older-cursor' })
      .mockResolvedValueOnce({ posts: [], nextBefore: null })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const { result } = renderHook(
      () => useTimeline('11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222'),
      { wrapper: wrapper(client) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(mocks.listPosts).toHaveBeenNthCalledWith(
      1,
      '11111111-1111-1111-1111-111111111111',
      { limit: 10, before: undefined, around: '22222222-2222-2222-2222-222222222222' },
    )

    await result.current.fetchNextPage()
    expect(mocks.listPosts).toHaveBeenNthCalledWith(
      2,
      '11111111-1111-1111-1111-111111111111',
      { limit: 10, before: 'older-cursor', around: undefined },
    )
  })
})

describe('usePostMutations edit', () => {
  it('updates timeline and thread caches before the server responds', async () => {
    const request = deferred<Post>()
    mocks.editPost.mockReturnValue(request.promise)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.edit.mutate({
        id: postId,
        body: 'optimistic body',
        attachments: [attachment],
        postUpdatedAt: post().updatedAt,
      })
    })

    await waitFor(() => {
      const timeline = client.getQueryData<{ pages: { posts: Post[] }[] }>(['posts', channelId])
      const thread = client.getQueryData<{ root: Post; replies: Post[] }>(['thread', 'root-post'])
      expect(timeline?.pages[0]?.posts[0]).toMatchObject({
        body: 'optimistic body',
        attachments: [attachment],
        editedAt: expect.any(String),
      })
      expect(thread?.replies[0]).toMatchObject({
        body: 'optimistic body',
        attachments: [attachment],
        editedAt: expect.any(String),
      })
    })
    expect(mocks.editPost).toHaveBeenCalledWith(postId, 'optimistic body', [attachment.id])

    await act(async () => request.resolve(post({ body: 'optimistic body', attachments: [attachment] })))
  })

  it('reconciles optimistic caches with the server post', async () => {
    const request = deferred<Post>()
    mocks.editPost.mockReturnValue(request.promise)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })
    const serverPost = post({
      body: 'server body',
      editedAt: '2026-09-04T12:35:00Z',
      attachments: [{ ...attachment, checksum: 'server-checksum', createdAt: '2026-09-04T12:35:00Z' }],
    })

    act(() => {
      result.current.edit.mutate({
        id: postId,
        body: 'optimistic body',
        attachments: [attachment],
        postUpdatedAt: post().updatedAt,
      })
    })
    await waitFor(() =>
      expect(client.getQueryData<{ pages: { posts: Post[] }[] }>(['posts', channelId])?.pages[0]?.posts[0]?.body)
        .toBe('optimistic body'),
    )

    await act(async () => request.resolve(serverPost))

    await waitFor(() => {
      expect(client.getQueryData<{ pages: { posts: Post[] }[] }>(['posts', channelId])?.pages[0]?.posts[0])
        .toEqual(serverPost)
      expect(client.getQueryData<{ root: Post; replies: Post[] }>(['thread', 'root-post'])?.replies[0])
        .toEqual(serverPost)
    })
  })

  it('restores cache snapshots and reopens the editor while retaining rejected input', async () => {
    const request = deferred<Post>()
    mocks.editPost.mockReturnValue(request.promise)
    const client = mutationClient()
    const snapshots = seedPostQueries(client)
    const invalidateQueries = vi.spyOn(client, 'invalidateQueries').mockResolvedValue(undefined)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.edit.mutate({
        id: postId,
        body: 'rejected body',
        attachments: [attachment],
        postUpdatedAt: post().updatedAt,
      })
    })
    await waitFor(() =>
      expect(client.getQueryData<{ pages: { posts: Post[] }[] }>(['posts', channelId])?.pages[0]?.posts[0]?.body)
        .toBe('rejected body'),
    )

    await act(async () => request.reject(new Error('save failed')))

    expect(client.getQueryData(['posts', channelId])).toEqual(snapshots.timeline)
    expect(client.getQueryData(['thread', 'root-post'])).toEqual(snapshots.thread)
    expect(invalidateQueries).toHaveBeenCalled()
    await waitFor(() => {
      expect(useUi.getState().editingPostId).toBe(postId)
      expect(useUi.getState().autoOpenedEditPostId).toBe(postId)
      expect(useUi.getState().failedEdits[postId]).toEqual({
        body: 'rejected body',
        attachments: [attachment],
        error: '保存に失敗しました。入力は保持されています。',
        postUpdatedAt: post().updatedAt,
      })
    })
  })

  it('does not replace another open editor when an edit fails', async () => {
    mocks.editPost.mockRejectedValue(new Error('save failed'))
    const client = mutationClient()
    seedPostQueries(client)
    useUi.getState().setEditingPost('other-post')
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.edit.mutate({
        id: postId,
        body: 'rejected body',
        attachments: [attachment],
        postUpdatedAt: post().updatedAt,
      })
    })

    await waitFor(() => expect(useUi.getState().failedEdits[postId]).toBeDefined())
    expect(useUi.getState().editingPostId).toBe('other-post')
    expect(useUi.getState().autoOpenedEditPostId).toBeNull()
  })

  it('runs the edit mutation through onError while the browser is offline', async () => {
    mocks.editPost.mockRejectedValue(new Error('save failed'))
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    onlineManager.setOnline(false)
    try {
      act(() => {
        result.current.edit.mutate({
          id: postId,
          body: 'offline rejected body',
          attachments: [attachment],
          postUpdatedAt: post().updatedAt,
        })
      })

      await waitFor(() => expect(useUi.getState().failedEdits[postId]).toBeDefined())
      expect(result.current.edit.isError).toBe(true)
    } finally {
      onlineManager.setOnline(true)
    }
  })

  it('キャッシュに無いポストの失敗では編集フォームを開かない', async () => {
    mocks.editPost.mockRejectedValue(new Error('save failed'))
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })
    const missingId = '99999999-9999-9999-9999-999999999999'

    act(() => {
      result.current.edit.mutate({
        id: missingId,
        body: 'rejected body',
        attachments: [],
        postUpdatedAt: post().updatedAt,
      })
    })

    await waitFor(() => expect(useUi.getState().failedEdits[missingId]).toBeDefined())
    // 描画されていないポストに editingPostId を立てると、以後の失敗がすべて無通知になる
    expect(useUi.getState().editingPostId).toBeNull()
    expect(useUi.getState().autoOpenedEditPostId).toBeNull()
  })

  it('clears a retained failed edit after a successful retry', async () => {
    const serverPost = post({ body: 'saved body', editedAt: '2026-09-04T12:35:00Z' })
    mocks.editPost.mockResolvedValue(serverPost)
    const client = mutationClient()
    seedPostQueries(client)
    useUi.getState().setFailedEdit(postId, {
      body: 'saved body',
      attachments: [],
      error: 'previous failure',
      postUpdatedAt: post().updatedAt,
    })
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.edit.mutate({
        id: postId,
        body: 'saved body',
        attachments: [],
        postUpdatedAt: post().updatedAt,
      })
    })

    await waitFor(() => expect(result.current.edit.isSuccess).toBe(true))
    expect(useUi.getState().failedEdits[postId]).toBeUndefined()
  })
})
