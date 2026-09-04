import type { Attachment, Post } from '@/api/client'

export function updatePostInQueryData<T>(
  data: T,
  postId: string,
  update: (post: Post) => Post,
): T {
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

export function updatePosts(
  posts: Post[],
  postId: string,
  update: (post: Post) => Post,
): Post[] {
  let changed = false
  const next = posts.map((post) => {
    if (post.id !== postId) return post
    const updated = update(post)
    if (updated !== post) changed = true
    return updated
  })
  return changed ? next : posts
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

export function applyPostEdit(
  post: Post,
  edit: { body: string; attachments: Attachment[] },
): Post {
  return {
    ...post,
    body: edit.body,
    attachments: edit.attachments,
    editedAt: new Date().toISOString(),
  }
}

export function replacePostInQueryData<T>(data: T, post: Post): T {
  return updatePostInQueryData(data, post.id, () => post)
}
