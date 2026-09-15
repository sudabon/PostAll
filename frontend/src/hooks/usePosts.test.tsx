import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Attachment, Post } from '@/api/client'
import { useUi } from '@/state/ui'
import { deleteFailureMessage, usePostMutations, useTimeline } from './usePosts'

const mocks = vi.hoisted(() => ({
  listPosts: vi.fn(),
  editPost: vi.fn(),
  createPost: vi.fn(),
  createReply: vi.fn(),
  deletePost: vi.fn(),
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({
    api: {
      listPosts: mocks.listPosts,
      editPost: mocks.editPost,
      createPost: mocks.createPost,
      createReply: mocks.createReply,
      deletePost: mocks.deletePost,
    },
    signedIn: true,
  }),
}))

beforeEach(() => {
  mocks.listPosts.mockReset()
  mocks.editPost.mockReset()
  mocks.createPost.mockReset()
  mocks.createReply.mockReset()
  mocks.deletePost.mockReset()
  useUi.setState({
    canMutate: true,
    editingPostId: null,
    autoOpenedEditPostId: null,
    failedEdits: {},
    pendingPosts: [],
    deletingPostIds: [],
    failedDeletes: {},
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

const newPostId = '66666666-6666-6666-6666-666666666666'

function timelineOf(client: QueryClient) {
  return client.getQueryData<{ pages: { posts: Post[] }[] }>(['posts', channelId])
}

function threadOf(client: QueryClient) {
  return client.getQueryData<{ root: Post; replies: Post[] }>(['thread', 'root-post'])
}

describe('usePostMutations create', () => {
  it('shows the post as pending before the server responds', async () => {
    const request = deferred<Post>()
    mocks.createPost.mockReturnValue(request.promise)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.create.mutate({ body: '新しいポスト', attachmentIds: [], attachments: [] })
    })

    expect(useUi.getState().pendingPosts).toMatchObject([
      { channelId, threadRootId: null, body: '新しいポスト', status: 'sending' },
    ])
    await waitFor(() => expect(mocks.createPost).toHaveBeenCalledWith(channelId, '新しいポスト', []))

    await act(async () => request.resolve(post({ id: newPostId, body: '新しいポスト' })))
  })

  it('keeps the pending post through an invalidation of the timeline', async () => {
    const request = deferred<Post>()
    mocks.createPost.mockReturnValue(request.promise)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.create.mutate({ body: '新しいポスト' })
    })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['posts'] })
    })

    expect(useUi.getState().pendingPosts).toHaveLength(1)

    await act(async () => request.resolve(post({ id: newPostId, body: '新しいポスト' })))
  })

  it('inserts the confirmed post into the timeline cache and clears the pending row', async () => {
    const serverPost = post({ id: newPostId, body: '新しいポスト', createdAt: '2026-08-23T01:00:00Z' })
    mocks.createPost.mockResolvedValue(serverPost)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.create.mutateAsync({ body: '新しいポスト' })
    })

    expect(timelineOf(client)?.pages[0]?.posts.at(-1)).toEqual(serverPost)
    expect(useUi.getState().pendingPosts).toEqual([])
  })

  it('marks the pending post failed and reuses its key on retry', async () => {
    mocks.createPost.mockRejectedValueOnce(new Error('create failed'))
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.create.mutateAsync({ body: '新しいポスト' }).catch(() => undefined)
    })

    const failed = useUi.getState().pendingPosts[0]
    expect(failed).toMatchObject({ body: '新しいポスト', status: 'failed' })

    const serverPost = post({ id: newPostId, body: '新しいポスト' })
    mocks.createPost.mockResolvedValueOnce(serverPost)
    await act(async () => {
      await result.current.create.mutateAsync({ body: '新しいポスト', pendingKey: failed!.key })
    })

    expect(useUi.getState().pendingPosts).toEqual([])
    expect(timelineOf(client)?.pages[0]?.posts.at(-1)).toEqual(serverPost)
  })

  it('creates no pending post while the connection is unavailable', async () => {
    mocks.createPost.mockResolvedValue(post({ id: newPostId }))
    const client = mutationClient()
    seedPostQueries(client)
    useUi.setState({ canMutate: false })
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.create.mutateAsync({ body: '新しいポスト' }).catch(() => undefined)
    })

    expect(useUi.getState().pendingPosts).toEqual([])
    expect(mocks.createPost).not.toHaveBeenCalled()
  })
})

describe('usePostMutations reply', () => {
  it('shows the reply as pending against its thread before the server responds', async () => {
    const request = deferred<Post>()
    mocks.createReply.mockReturnValue(request.promise)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.reply.mutate({ postId: 'root-post', body: '新しい返信' })
    })

    expect(useUi.getState().pendingPosts).toMatchObject([
      { channelId, threadRootId: 'root-post', body: '新しい返信', status: 'sending' },
    ])

    await act(async () => request.resolve(post({ id: newPostId, body: '新しい返信' })))
  })

  it('inserts the confirmed reply into the thread cache only', async () => {
    const serverReply = post({ id: newPostId, body: '新しい返信', threadRootId: 'root-post' })
    mocks.createReply.mockResolvedValue(serverReply)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.reply.mutateAsync({ postId: 'root-post', body: '新しい返信' })
    })

    expect(threadOf(client)?.replies.at(-1)).toEqual(serverReply)
    expect(timelineOf(client)?.pages[0]?.posts.map((entry) => entry.id)).toEqual([postId])
    expect(useUi.getState().pendingPosts).toEqual([])
  })

  it('marks the pending reply failed when the server rejects it', async () => {
    mocks.createReply.mockRejectedValue(new Error('reply failed'))
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.reply.mutateAsync({ postId: 'root-post', body: '新しい返信' }).catch(() => undefined)
    })

    expect(useUi.getState().pendingPosts).toMatchObject([
      { threadRootId: 'root-post', body: '新しい返信', status: 'failed' },
    ])
  })
})

describe('usePostMutations remove', () => {
  it('hides the post before the server responds and keeps it hidden across an invalidation', async () => {
    const request = deferred<void>()
    mocks.deletePost.mockReturnValue(request.promise)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    act(() => {
      result.current.remove.mutate(postId)
    })
    await act(async () => {
      await client.invalidateQueries({ queryKey: ['posts'] })
    })

    expect(useUi.getState().deletingPostIds).toEqual([postId])

    await act(async () => request.resolve())
  })

  it('drops the post from both caches once the delete is confirmed', async () => {
    mocks.deletePost.mockResolvedValue(undefined)
    const client = mutationClient()
    seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.remove.mutateAsync(postId)
    })

    expect(timelineOf(client)?.pages[0]?.posts).toEqual([])
    expect(threadOf(client)?.replies).toEqual([])
    expect(useUi.getState().deletingPostIds).toEqual([])
    expect(useUi.getState().failedDeletes).toEqual({})
  })

  it('restores the post and records the failure when the delete is rejected', async () => {
    mocks.deletePost.mockRejectedValueOnce(new Error('delete failed'))
    const client = mutationClient()
    const snapshots = seedPostQueries(client)
    const { result } = renderHook(() => usePostMutations(channelId), { wrapper: wrapper(client) })

    await act(async () => {
      await result.current.remove.mutateAsync(postId).catch(() => undefined)
    })

    expect(useUi.getState().deletingPostIds).toEqual([])
    expect(useUi.getState().failedDeletes[postId]).toBe(deleteFailureMessage)
    expect(client.getQueryData(['posts', channelId])).toEqual(snapshots.timeline)

    mocks.deletePost.mockResolvedValueOnce(undefined)
    await act(async () => {
      await result.current.remove.mutateAsync(postId)
    })

    expect(useUi.getState().failedDeletes).toEqual({})
    expect(timelineOf(client)?.pages[0]?.posts).toEqual([])
  })
})
