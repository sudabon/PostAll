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

/** 与えられたクエリデータのどこかに当該ポストが載っているか。走査は updatePostInQueryData と共通。 */
export function queryDataHasPost(data: unknown, postId: string): boolean {
  let found = false
  updatePostInQueryData(data, postId, (post) => {
    found = true
    return post
  })
  return found
}

/**
 * 確定したポストをキャッシュへ差し込む。infinite query 形では最新側の先頭ページ、
 * thread 形では replies の末尾に置く。既に載っていれば同一参照を返す。
 * 対象のチャネル・スレッドの絞り込みは呼び出し側のクエリキーで行う。
 */
export function insertPostInQueryData<T>(data: T, post: Post): T {
  if (!isRecord(data)) return data
  if (queryDataHasPost(data, post.id)) return data

  if (Array.isArray(data.pages)) {
    const [first, ...rest] = data.pages
    if (!isRecord(first) || !Array.isArray(first.posts)) return data
    return { ...data, pages: [{ ...first, posts: [...(first.posts as Post[]), post] }, ...rest] } as T
  }

  if (isRecord(data.root) && Array.isArray(data.replies)) {
    return { ...data, replies: [...(data.replies as Post[]), post] } as T
  }

  return data
}

/** 削除されたポストをキャッシュから取り除く。該当が無ければ同一参照を返す。 */
export function removePostFromQueryData<T>(data: T, postId: string): T {
  if (!isRecord(data)) return data

  if (Array.isArray(data.pages)) {
    let changed = false
    const pages = data.pages.map((page) => {
      if (!isRecord(page) || !Array.isArray(page.posts)) return page
      const posts = (page.posts as Post[]).filter((current) => current.id !== postId)
      if (posts.length === page.posts.length) return page
      changed = true
      return { ...page, posts }
    })
    return (changed ? { ...data, pages } : data) as T
  }

  if (isRecord(data.root) && Array.isArray(data.replies)) {
    const replies = (data.replies as Post[]).filter((current) => current.id !== postId)
    if (replies.length === data.replies.length) return data
    return { ...data, replies } as T
  }

  return data
}
