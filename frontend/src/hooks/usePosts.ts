import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type QueryKey,
} from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import type { Attachment, Post } from '@/api/client'
import {
  applyPostEdit,
  insertPostInQueryData,
  queryDataHasPost,
  removePostFromQueryData,
  replacePostInQueryData,
  updatePostInQueryData,
} from '@/lib/post-cache'
import { submitFailureMessage } from '@/lib/submit-failure'
import { requireMutationConnection, useUi } from '@/state/ui'

type EditPostInput = {
  id: string
  body: string
  attachments: Attachment[]
  postUpdatedAt: string
}

type EditMutationContext = {
  snapshots: [QueryKey, unknown][]
}

type CreatePostInput = {
  body: string
  attachmentIds?: string[]
  /** 確定前の行に描く添付。API へは attachmentIds を送る */
  attachments?: Attachment[]
  /** 再送のときだけ渡す。同じ保留行を使い回して位置を変えない */
  pendingKey?: string
}

type ReplyInput = CreatePostInput & { postId: string }

/** onMutate で積んだ保留行を onError / onSuccess から同定するための受け渡し */
type PendingMutationContext = {
  key: string
}

const editFailureMessage = submitFailureMessage('保存')
export const deleteFailureMessage = '削除できませんでした。'

export function useTimeline(channelId: string | null, around: string | null = null) {
  const { api, signedIn } = useAuth()
  return useInfiniteQuery({
    queryKey: ['posts', channelId, around],
    enabled: Boolean(channelId) && signedIn,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      api.listPosts(channelId!, {
        limit: 10,
        before: pageParam,
        around: pageParam === undefined ? around ?? undefined : undefined,
      }),
    getNextPageParam: (last) => last.nextBefore ?? undefined,
  })
}

export function useThread(postId: string | null) {
  const { api, signedIn } = useAuth()
  return useQuery({
    queryKey: ['thread', postId],
    enabled: Boolean(postId) && signedIn,
    queryFn: () => api.getThread(postId!),
  })
}

export function usePostMutations(channelId: string | null) {
  const { api } = useAuth()
  const qc = useQueryClient()
  const invalidate = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['posts', channelId] }),
      qc.invalidateQueries({ queryKey: ['thread'] }),
    ])
  }
  return {
    create: useMutation<Post, Error, CreatePostInput, PendingMutationContext>({
      networkMode: 'always',
      mutationFn: (input) => {
        requireMutationConnection()
        return api.createPost(channelId!, input.body, input.attachmentIds)
      },
      // 接続を先に確かめる。接続断では保留行を作らず、呼び出し側が入力をフォームに残す。
      onMutate: (input) => {
        requireMutationConnection()
        return beginPending(input, { channelId: channelId!, threadRootId: null })
      },
      onError: (_error, _input, context) => {
        if (context) useUi.getState().failPendingPost(context.key)
      },
      // 先にキャッシュへ入れてから保留を解く。逆順だと再取得が終わるまで行が消える。
      onSuccess: (post, _input, context) => {
        qc.setQueriesData({ queryKey: ['posts', channelId] }, (data) => insertPostInQueryData(data, post))
        if (context) useUi.getState().removePendingPost(context.key)
      },
      onSettled: invalidate,
    }),
    edit: useMutation<Post, Error, EditPostInput, EditMutationContext>({
      networkMode: 'always',
      mutationFn: (input) => {
        requireMutationConnection()
        return api.editPost(input.id, input.body, input.attachments.map((attachment) => attachment.id))
      },
      onMutate: async (input) => {
        requireMutationConnection()
        await Promise.all([
          qc.cancelQueries({ queryKey: ['posts'] }),
          qc.cancelQueries({ queryKey: ['thread'] }),
        ])
        const snapshots = [
          ...qc.getQueriesData({ queryKey: ['posts'] }),
          ...qc.getQueriesData({ queryKey: ['thread'] }),
        ] as [QueryKey, unknown][]
        updatePostCaches(qc, (data) =>
          updatePostInQueryData(data, input.id, (post) =>
            applyPostEdit(post, { body: input.body, attachments: input.attachments }),
          ),
        )
        return { snapshots }
      },
      onError: (_error, input, context) => {
        for (const [key, snapshot] of context?.snapshots ?? []) {
          qc.setQueryData(key, snapshot)
        }
        const ui = useUi.getState()
        ui.setFailedEdit(input.id, {
          body: input.body,
          attachments: input.attachments,
          error: editFailureMessage,
          postUpdatedAt: input.postUpdatedAt,
        })
        // キャッシュから落ちたポストに editingPostId を立てると、以後 editingPostId が
        // null に戻らず後続の失敗がすべて無通知になる。表示できるときだけ開く。
        const cached = [
          ...qc.getQueriesData({ queryKey: ['posts'] }),
          ...qc.getQueriesData({ queryKey: ['thread'] }),
        ].some(([, data]) => queryDataHasPost(data, input.id))
        if (ui.editingPostId === null && cached) ui.openEditorForFailure(input.id)
      },
      onSuccess: (post, input) => {
        updatePostCaches(qc, (data) => replacePostInQueryData(data, post))
        useUi.getState().clearFailedEdit(input.id)
      },
      onSettled: async () => {
        await Promise.all([
          qc.invalidateQueries({ queryKey: ['posts'] }),
          qc.invalidateQueries({ queryKey: ['thread'] }),
        ])
      },
    }),
    remove: useMutation<void, Error, string>({
      networkMode: 'always',
      mutationFn: (id) => {
        requireMutationConnection()
        return api.deletePost(id)
      },
      // 承認の直後に表示から取り除く。再試行もこの遷移を通り、前回の失敗の文言が落ちる。
      onMutate: (id) => {
        useUi.getState().startDeletingPost(id)
      },
      onError: (_error, id) => {
        useUi.getState().failDeletingPost(id, deleteFailureMessage)
      },
      onSuccess: (_data, id) => {
        updatePostCaches(qc, (data) => removePostFromQueryData(data, id))
        useUi.getState().clearDeletingPost(id)
      },
      onSettled: invalidate,
    }),
    reply: useMutation<Post, Error, ReplyInput, PendingMutationContext>({
      networkMode: 'always',
      mutationFn: (input) => {
        requireMutationConnection()
        return api.createReply(input.postId, input.body, input.attachmentIds)
      },
      onMutate: (input) => {
        requireMutationConnection()
        return beginPending(input, { channelId: channelId!, threadRootId: input.postId })
      },
      onError: (_error, _input, context) => {
        if (context) useUi.getState().failPendingPost(context.key)
      },
      onSuccess: (post, input, context) => {
        qc.setQueriesData({ queryKey: ['thread', input.postId] }, (data) => insertPostInQueryData(data, post))
        if (context) useUi.getState().removePendingPost(context.key)
      },
      onSettled: invalidate,
    }),
  }
}

function beginPending(
  input: CreatePostInput,
  location: { channelId: string; threadRootId: string | null },
): PendingMutationContext {
  const ui = useUi.getState()
  if (input.pendingKey) {
    ui.retryPendingPost(input.pendingKey)
    return { key: input.pendingKey }
  }
  // ポスト id はサーバーが採番するので、保留の同定には key を使う。
  const key = crypto.randomUUID()
  ui.addPendingPost({
    key,
    channelId: location.channelId,
    threadRootId: location.threadRootId,
    body: input.body,
    attachments: input.attachments ?? [],
    createdAt: new Date().toISOString(),
    status: 'sending',
  })
  return { key }
}

function updatePostCaches(
  queryClient: ReturnType<typeof useQueryClient>,
  update: (data: unknown) => unknown,
) {
  queryClient.setQueriesData({ queryKey: ['posts'] }, update)
  queryClient.setQueriesData({ queryKey: ['thread'] }, update)
}

export function flattenPages(pages: { posts: Post[] }[] | undefined): Post[] {
  if (!pages) return []
  const seen = new Set<string>()
  const out: Post[] = []
  for (const page of pages) {
    for (const post of page.posts) {
      if (seen.has(post.id)) continue
      seen.add(post.id)
      out.push(post)
    }
  }
  return out.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
}
