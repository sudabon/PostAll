import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import type { Post } from '@/api/client'
import { requireMutationConnection } from '@/state/ui'

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
    edit: useMutation({
      mutationFn: (input: { id: string; body: string; attachmentIds?: string[] }) => {
        requireMutationConnection()
        return api.editPost(input.id, input.body, input.attachmentIds)
      },
      onSuccess: invalidate,
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
