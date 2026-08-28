import { beforeEach, describe, expect, it } from 'vitest'
import type { SearchResult } from '@/api/client'
import { createFakeAdapter } from '@/platform'
import { loadUi, useUi } from './ui'

const rootResult: SearchResult = {
  postId: '22222222-2222-2222-2222-222222222222',
  timelinePostId: '22222222-2222-2222-2222-222222222222',
  channelId: '11111111-1111-1111-1111-111111111111',
  channelName: 'メモ',
  threadRootId: null,
  body: '検索対象',
  createdAt: '2026-08-23T01:00:00Z',
}

beforeEach(() => {
  useUi.getState().hydrate({
    selectedChannelId: null,
    threadPostId: null,
    searchOpen: true,
    timelineAnchorId: null,
    targetPostId: null,
    targetThreadReplyId: null,
  })
})

describe('search result navigation', () => {
  it('opens a root post around its timeline position', () => {
    useUi.getState().navigateToSearchResult(rootResult)

    expect(useUi.getState()).toMatchObject({
      selectedChannelId: rootResult.channelId,
      threadPostId: null,
      searchOpen: false,
      timelineAnchorId: rootResult.timelinePostId,
      targetPostId: rootResult.postId,
      targetThreadReplyId: null,
    })
  })

  it('opens a matching reply in its root thread', () => {
    const replyResult: SearchResult = {
      ...rootResult,
      postId: '33333333-3333-3333-3333-333333333333',
      threadRootId: rootResult.postId,
      timelinePostId: rootResult.postId,
    }

    useUi.getState().navigateToSearchResult(replyResult)

    expect(useUi.getState()).toMatchObject({
      selectedChannelId: replyResult.channelId,
      threadPostId: replyResult.threadRootId,
      timelineAnchorId: replyResult.timelinePostId,
      targetPostId: replyResult.timelinePostId,
      targetThreadReplyId: replyResult.postId,
    })
  })

  it('clears a search anchor when navigating normally', () => {
    useUi.getState().navigateToSearchResult(rootResult)
    useUi.getState().selectChannel('44444444-4444-4444-4444-444444444444')

    expect(useUi.getState()).toMatchObject({
      timelineAnchorId: null,
      targetPostId: null,
      targetThreadReplyId: null,
    })
  })
})

describe('thread width', () => {
  it('clamps the width to the allowed range', () => {
    useUi.getState().setThreadWidth(100)
    expect(useUi.getState().threadWidth).toBe(320)

    useUi.getState().setThreadWidth(9999)
    expect(useUi.getState().threadWidth).toBe(640)

    useUi.getState().setThreadWidth(500)
    expect(useUi.getState().threadWidth).toBe(500)
  })

  it('keeps the default when stored ui data predates the key', async () => {
    useUi.getState().hydrate({ sidebarWidth: 260, threadWidth: 384 })
    const adapter = createFakeAdapter()
    await adapter.setItem(
      'ui',
      JSON.stringify({ sidebarWidth: 300, sidebarCollapsed: false, selectedChannelId: null, expandedIds: [] }),
    )

    await loadUi(adapter)

    expect(useUi.getState().sidebarWidth).toBe(300)
    expect(useUi.getState().threadWidth).toBe(384)
  })
})
