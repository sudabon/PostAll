import type { Emoji, Post, Reaction } from '@/api/client'

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

function updatePostInQueryData<T>(data: T, postId: string, update: (post: Post) => Post): T {
  if (!isRecord(data)) return data

  if (Array.isArray(data.pages)) {
    let changed = false
    const pages = data.pages.map((page) => {
      if (!isRecord(page) || !Array.isArray(page.posts)) return page
      const posts = updatePosts(page.posts as Post[], postId, update)
      if (posts === page.posts) return page
      changed = true
      return { ...page, posts }
    })
    return (changed ? { ...data, pages } : data) as T
  }

  if (isRecord(data.root) && Array.isArray(data.replies)) {
    const root = data.root as unknown as Post
    const nextRoot = root.id === postId ? update(root) : root
    const replies = updatePosts(data.replies as Post[], postId, update)
    if (nextRoot === root && replies === data.replies) return data
    return { ...data, root: nextRoot, replies } as T
  }

  return data
}

function updatePosts(posts: Post[], postId: string, update: (post: Post) => Post): Post[] {
  let changed = false
  const next = posts.map((post) => {
    if (post.id !== postId) return post
    const updated = update(post)
    if (updated !== post) changed = true
    return updated
  })
  return changed ? next : posts
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
