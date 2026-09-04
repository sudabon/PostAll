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
  queryDataHasPost,
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

const editFailureMessage = submitFailureMessage('保存')

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
  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: ['posts', channelId] })
    void qc.invalidateQueries({ queryKey: ['thread'] })
  }
  return {
    create: useMutation({
      mutationFn: (input: { body: string; attachmentIds?: string[] }) => {
        requireMutationConnection()
        return api.createPost(channelId!, input.body, input.attachmentIds)
      },
      onSuccess: invalidate,
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
    remove: useMutation({
      mutationFn: (id: string) => {
        requireMutationConnection()
        return api.deletePost(id)
      },
      onSuccess: invalidate,
    }),
    reply: useMutation({
      mutationFn: (input: { postId: string; body: string; attachmentIds?: string[] }) => {
        requireMutationConnection()
        return api.createReply(input.postId, input.body, input.attachmentIds)
      },
      onSuccess: invalidate,
    }),
  }
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
