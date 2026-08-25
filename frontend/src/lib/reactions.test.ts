import { describe, expect, it } from 'vitest'
import type { Emoji, Post, Reaction } from '@/api/client'
import { optimisticallySetReaction, updateReactionInQueryData } from './reactions'

const emoji: Emoji = {
  id: '11111111-1111-1111-1111-111111111111',
  shortcode: 'shipit',
  imagePath: '/v1/emojis/shipit/image',
  checksum: 'sum-1',
}

function post(reactions: Reaction[] = []): Post {
  return {
    id: '22222222-2222-2222-2222-222222222222',
    channelId: '33333333-3333-3333-3333-333333333333',
    authorId: '44444444-4444-4444-4444-444444444444',
    body: 'memo',
    createdAt: '2026-08-23T00:00:00Z',
    updatedAt: '2026-08-23T00:00:00Z',
    deleted: false,
    replyCount: 0,
    reactions,
  }
}

describe('reaction optimistic state', () => {
  it('adds a reaction once and removes it when its count reaches zero', () => {
    const original = post()
    const added = optimisticallySetReaction(original, emoji, true)
    expect(added.reactions).toEqual([
      { emoji, count: 1, reactedByMe: true, reactorIds: [] },
    ])
    expect(original.reactions).toEqual([])

    const duplicate = optimisticallySetReaction(added, emoji, true)
    expect(duplicate.reactions?.[0]?.count).toBe(1)

    const removed = optimisticallySetReaction(duplicate, emoji, false)
    expect(removed.reactions).toEqual([])
  })

  it('updates timeline and thread query shapes without mutating the snapshots', () => {
    const timeline = { pages: [{ posts: [post()], nextBefore: null }], pageParams: [undefined] }
    const thread = { root: post(), replies: [post()] }

    const nextTimeline = updateReactionInQueryData(timeline, post().id, emoji, true)
    const nextThread = updateReactionInQueryData(thread, post().id, emoji, true)

    expect(nextTimeline).not.toBe(timeline)
    expect(nextTimeline.pages[0]?.posts[0]?.reactions?.[0]?.count).toBe(1)
    expect(nextThread.root.reactions?.[0]?.reactedByMe).toBe(true)
    expect(nextThread.replies[0]?.reactions?.[0]?.count).toBe(1)
    expect(timeline.pages[0]?.posts[0]?.reactions).toEqual([])
    expect(thread.root.reactions).toEqual([])
  })
})
