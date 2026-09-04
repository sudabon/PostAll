import type { Emoji, Post, Reaction } from '@/api/client'
import { updatePostInQueryData } from '@/lib/post-cache'

export function optimisticallySetReaction(post: Post, emoji: Emoji, react: boolean): Post {
  const reactions = post.reactions ?? []
  const index = reactions.findIndex((reaction) => reaction.emoji.id === emoji.id)

  if (react) {
    if (index < 0) {
      return {
        ...post,
        reactions: [...reactions, { emoji, count: 1, reactedByMe: true, reactorIds: [] }],
      }
    }
    const current = reactions[index]!
    if (current.reactedByMe) return post
    const next = [...reactions]
    next[index] = { ...current, count: current.count + 1, reactedByMe: true }
    return { ...post, reactions: next }
  }

  if (index < 0 || !reactions[index]!.reactedByMe) return post
  const current = reactions[index]!
  if (current.count <= 1) {
    return { ...post, reactions: reactions.filter((_, reactionIndex) => reactionIndex !== index) }
  }
  const next = [...reactions]
  next[index] = { ...current, count: current.count - 1, reactedByMe: false }
  return { ...post, reactions: next }
}

export function updateReactionInQueryData<T>(
  data: T,
  postId: string,
  emoji: Emoji,
  react: boolean,
): T {
  return updatePostInQueryData(data, postId, (post) => optimisticallySetReaction(post, emoji, react))
}

export function replaceReactionInQueryData<T>(data: T, postId: string, reaction: Reaction): T {
  return updatePostInQueryData(data, postId, (post) => {
    const reactions = post.reactions ?? []
    const index = reactions.findIndex((item) => item.emoji.id === reaction.emoji.id)
    if (index < 0) return { ...post, reactions: [...reactions, reaction] }
    const next = [...reactions]
    next[index] = reaction
    return { ...post, reactions: next }
  })
}
