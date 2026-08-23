import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useAuth } from '@/auth/AuthProvider'
import type { Channel } from '@/api/client'
import { ApiError } from '@/api/client'
import { requireMutationConnection } from '@/state/ui'

export function useChannels() {
  const { api, signedIn } = useAuth()
  return useQuery({
    queryKey: ['channels'],
    queryFn: () => api.listChannels(),
    enabled: signedIn,
  })
}

export function useChannelMutations() {
  const { api } = useAuth()
  const qc = useQueryClient()
  const invalidate = () => qc.invalidateQueries({ queryKey: ['channels'] })

  const create = useMutation({
    mutationFn: (input: { name: string; parentId?: string | null }) => {
      requireMutationConnection()
      return api.createChannel(input)
    },
    onSuccess: invalidate,
  })
  const rename = useMutation({
    mutationFn: (input: { id: string; name: string }) => {
      requireMutationConnection()
      return api.renameChannel(input.id, input.name)
    },
    onSuccess: invalidate,
  })
  const remove = useMutation({
    mutationFn: (id: string) => {
      requireMutationConnection()
      return api.deleteChannel(id)
    },
    onSuccess: invalidate,
  })
  const move = useMutation({
    mutationFn: (input: {
      id: string
      parentId?: string | null
      beforeId?: string | null
      afterId?: string | null
      optimistic: Channel[]
    }) => {
      requireMutationConnection()
      qc.setQueryData(['channels'], input.optimistic)
      return api.moveChannel(input.id, {
        parentId: input.parentId,
        beforeId: input.beforeId,
        afterId: input.afterId,
      })
    },
    onError: invalidate,
    onSuccess: invalidate,
  })

  return { create, rename, remove, move, errorMessage }
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.code === 'name_conflict') return '同じ階層に同名のチャネルがあります'
    if (err.code === 'channel_has_posts') return `ポストが存在するため削除できません（${String(err.details?.count ?? '')}件）`
    if (err.code === 'cycle') return '自身または子孫へは移動できません'
    return err.message
  }
  return '操作に失敗しました'
}
