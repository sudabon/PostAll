import { describe, expect, it, vi } from 'vitest'
import type { Attachment, Post } from '@/api/client'
import {
  applyPostEdit,
  insertPostInQueryData,
  removePostFromQueryData,
  replacePostInQueryData,
  updatePostInQueryData,
} from './post-cache'

const postId = '22222222-2222-2222-2222-222222222222'

function post(overrides: Partial<Post> = {}): Post {
  return {
    id: postId,
    channelId: '33333333-3333-3333-3333-333333333333',
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

const attachment: Attachment = {
  id: '55555555-5555-5555-5555-555555555555',
  postId,
  fileName: 'edited.txt',
  contentType: 'text/plain',
  sizeBytes: 6,
  checksum: 'checksum',
  createdAt: '2026-08-23T00:00:00Z',
}

describe('post query cache updates', () => {
  it('updates a post in an infinite query without mutating the snapshot', () => {
    const originalPost = post()
    const data = { pages: [{ posts: [originalPost], nextBefore: null }], pageParams: [undefined] }

    const next = updatePostInQueryData(data, postId, (current) => ({
      ...current,
      body: 'after',
    }))

    expect(next).not.toBe(data)
    expect(next.pages[0]?.posts[0]?.body).toBe('after')
    expect(data.pages[0]?.posts[0]).toBe(originalPost)
  })

  it('updates both root and reply posts in thread query data', () => {
    const root = post({ id: 'root-post' })
    const reply = post()
    const data = { root, replies: [reply] }

    const nextRoot = updatePostInQueryData(data, root.id, (current) => ({
      ...current,
      body: 'edited root',
    }))
    const nextReply = updatePostInQueryData(data, reply.id, (current) => ({
      ...current,
      body: 'edited reply',
    }))

    expect(nextRoot.root.body).toBe('edited root')
    expect(nextRoot.replies).toBe(data.replies)
    expect(nextReply.root).toBe(data.root)
    expect(nextReply.replies[0]?.body).toBe('edited reply')
    expect(data.root).toBe(root)
    expect(data.replies[0]).toBe(reply)
  })

  it('preserves the query data reference when the target post is absent', () => {
    const timeline = { pages: [{ posts: [post()] }], pageParams: [undefined] }
    const thread = { root: post(), replies: [] as Post[] }
    const update = vi.fn((current: Post) => ({ ...current, body: 'after' }))

    expect(updatePostInQueryData(timeline, 'missing-post', update)).toBe(timeline)
    expect(updatePostInQueryData(thread, 'missing-post', update)).toBe(thread)
    expect(update).not.toHaveBeenCalled()
  })

  it('applies an optimistic body, attachment, and edited marker', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-04T12:34:56Z'))

    const original = post()
    const next = applyPostEdit(original, { body: 'after', attachments: [attachment] })

    expect(next).toEqual({
      ...original,
      body: 'after',
      attachments: [attachment],
      editedAt: '2026-09-04T12:34:56.000Z',
    })
    expect(original).toEqual(post())

    vi.useRealTimers()
  })

  it('replaces a cached post with the server response', () => {
    const cached = post()
    const serverPost = post({
      body: 'server body',
      editedAt: '2026-09-04T12:35:00Z',
      attachments: [attachment],
    })
    const data = { pages: [{ posts: [cached] }], pageParams: [undefined] }

    const next = replacePostInQueryData(data, serverPost)

    expect(next.pages[0]?.posts[0]).toBe(serverPost)
    expect(data.pages[0]?.posts[0]).toBe(cached)
  })
})

describe('post query cache inserts', () => {
  const inserted = post({ id: 'new-post', createdAt: '2026-08-23T01:00:00Z' })

  it('appends a confirmed post to the newest page of an infinite query', () => {
    const existing = post()
    const data = {
      pages: [{ posts: [existing], nextBefore: null }, { posts: [] as Post[], nextBefore: null }],
      pageParams: [undefined, 'older'],
    }

    const next = insertPostInQueryData(data, inserted)

    expect(next.pages[0]?.posts).toEqual([existing, inserted])
    expect(next.pages[1]).toBe(data.pages[1])
    expect(data.pages[0]?.posts).toEqual([existing])
  })

  it('appends a confirmed reply to thread query data', () => {
    const data = { root: post({ id: 'root-post' }), replies: [post()] }

    const next = insertPostInQueryData(data, inserted)

    expect(next.replies.at(-1)).toBe(inserted)
    expect(next.root).toBe(data.root)
    expect(data.replies).toHaveLength(1)
  })

  it('preserves the query data reference when the post is already cached', () => {
    const timeline = { pages: [{ posts: [inserted] }], pageParams: [undefined] }
    const thread = { root: post({ id: 'root-post' }), replies: [inserted] }
    const asRoot = { root: inserted, replies: [] as Post[] }

    expect(insertPostInQueryData(timeline, inserted)).toBe(timeline)
    expect(insertPostInQueryData(thread, inserted)).toBe(thread)
    expect(insertPostInQueryData(asRoot, inserted)).toBe(asRoot)
  })
})

describe('post query cache removals', () => {
  it('removes a post from every page of an infinite query', () => {
    const kept = post({ id: 'kept-post' })
    const data = {
      pages: [{ posts: [kept], nextBefore: null }, { posts: [post()], nextBefore: null }],
      pageParams: [undefined, 'older'],
    }

    const next = removePostFromQueryData(data, postId)

    expect(next.pages[0]).toBe(data.pages[0])
    expect(next.pages[1]?.posts).toEqual([])
    expect(data.pages[1]?.posts).toHaveLength(1)
  })

  it('removes a reply from thread query data', () => {
    const kept = post({ id: 'kept-reply' })
    const data = { root: post({ id: 'root-post' }), replies: [kept, post()] }

    const next = removePostFromQueryData(data, postId)

    expect(next.replies).toEqual([kept])
    expect(next.root).toBe(data.root)
    expect(data.replies).toHaveLength(2)
  })

  it('preserves the query data reference when the post is absent', () => {
    const timeline = { pages: [{ posts: [post()] }], pageParams: [undefined] }
    const thread = { root: post({ id: 'root-post' }), replies: [post()] }

    expect(removePostFromQueryData(timeline, 'missing-post')).toBe(timeline)
    expect(removePostFromQueryData(thread, 'missing-post')).toBe(thread)
  })
})
