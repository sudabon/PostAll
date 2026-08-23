import { useMutation, useQueryClient, type QueryKey } from '@tanstack/react-query'
import type { Emoji, Reaction } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { replaceReactionInQueryData, updateReactionInQueryData } from '@/lib/reactions'
import { requireMutationConnection } from '@/state/ui'

type ReactionInput = {
  postId: string
  emoji: Emoji
  react: boolean
}

type MutationContext = {
  snapshots: [QueryKey, unknown][]
}

export function useReactionMutation() {
  const { api } = useAuth()
  const queryClient = useQueryClient()

  return useMutation<Reaction | undefined, Error, ReactionInput, MutationContext>({
    mutationFn: async ({ postId, emoji, react }) => {
      requireMutationConnection()
      if (react) return api.addReaction(postId, emoji.id)
      await api.removeReaction(postId, emoji.id)
      return undefined
    },
    onMutate: async (input) => {
      requireMutationConnection()
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['posts'] }),
        queryClient.cancelQueries({ queryKey: ['thread'] }),
      ])
      const snapshots = [
        ...queryClient.getQueriesData({ queryKey: ['posts'] }),
        ...queryClient.getQueriesData({ queryKey: ['thread'] }),
      ] as [QueryKey, unknown][]
      updateCaches(queryClient, (data) =>
        updateReactionInQueryData(data, input.postId, input.emoji, input.react),
      )
      return { snapshots }
    },
    onError: (_error, _input, context) => {
      for (const [key, snapshot] of context?.snapshots ?? []) {
        queryClient.setQueryData(key, snapshot)
      }
    },
    onSuccess: (reaction, input) => {
      if (!reaction) return
      updateCaches(queryClient, (data) =>
        replaceReactionInQueryData(data, input.postId, reaction),
      )
    },
    onSettled: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['posts'] }),
        queryClient.invalidateQueries({ queryKey: ['thread'] }),
      ])
    },
  })
}

function updateCaches(queryClient: ReturnType<typeof useQueryClient>, update: (data: unknown) => unknown) {
  queryClient.setQueriesData({ queryKey: ['posts'] }, update)
  queryClient.setQueriesData({ queryKey: ['thread'] }, update)
}
