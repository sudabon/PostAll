import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchResult } from '@/api/client'
import { createFakeAdapter } from '@/platform'
import { loadUi, seedNarrowHistory, useUi, watchNarrowHistory, watchUi } from './ui'
import { WIDE_VIEWPORT_QUERY } from '@/lib/viewport'

const channelA = '44444444-4444-4444-4444-444444444444'
const channelB = '55555555-5555-5555-5555-555555555555'
const postId = '22222222-2222-2222-2222-222222222222'

const rootResult: SearchResult = {
  postId,
  timelinePostId: postId,
  channelId: '11111111-1111-1111-1111-111111111111',
  channelName: 'メモ',
  threadRootId: null,
  body: '検索対象',
  createdAt: '2026-08-23T01:00:00Z',
}

function mockViewport(wide: boolean) {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string) => ({
    matches: query === WIDE_VIEWPORT_QUERY ? wide : false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }))
}

beforeEach(() => {
  window.history.replaceState({}, '', '/')
  mockViewport(false)
  useUi.getState().hydrate({
    selectedChannelId: null,
    threadPostId: null,
    searchOpen: true,
    timelineAnchorId: null,
    targetPostId: null,
    targetThreadReplyId: null,
    editingPostId: null,
    narrowScreen: 'channels',
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  window.history.replaceState({}, '', '/')
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
      narrowScreen: 'timeline',
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
      narrowScreen: 'thread',
    })
  })

  it('clears a search anchor when navigating normally', () => {
    useUi.getState().navigateToSearchResult(rootResult)
    useUi.getState().selectChannel(channelA)

    expect(useUi.getState()).toMatchObject({
      timelineAnchorId: null,
      targetPostId: null,
      targetThreadReplyId: null,
    })
  })
})

describe('editing post', () => {
  it('keeps only one post in edit at a time', () => {
    useUi.getState().setEditingPost(postId)
    expect(useUi.getState().editingPostId).toBe(postId)

    const other = '66666666-6666-6666-6666-666666666666'
    useUi.getState().setEditingPost(other)
    expect(useUi.getState().editingPostId).toBe(other)

    useUi.getState().setEditingPost(null)
    expect(useUi.getState().editingPostId).toBeNull()
  })

  it('does not persist editingPostId', async () => {
    const adapter = createFakeAdapter()
    const stop = watchUi(adapter)
    useUi.getState().setEditingPost(postId)
    await Promise.resolve()
    const stored = JSON.parse((await adapter.getItem('ui')) ?? '{}') as Record<string, unknown>
    expect(stored).not.toHaveProperty('editingPostId')
    stop()
  })

  it('drops the edit when switching channels', () => {
    useUi.getState().setEditingPost(postId)
    useUi.getState().selectChannel(channelA)
    expect(useUi.getState().editingPostId).toBeNull()
  })

  it('drops the edit when opening or closing a thread', () => {
    useUi.getState().setEditingPost(postId)
    useUi.getState().openThread(postId)
    expect(useUi.getState().editingPostId).toBeNull()

    useUi.getState().setEditingPost(postId)
    useUi.getState().openThread(null)
    expect(useUi.getState().editingPostId).toBeNull()
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

describe('narrow screen', () => {
  it('does not persist narrowScreen', async () => {
    const adapter = createFakeAdapter()
    const stop = watchUi(adapter)
    useUi.getState().selectChannel(channelA)
    expect(useUi.getState().narrowScreen).toBe('timeline')
    await Promise.resolve()
    const stored = JSON.parse((await adapter.getItem('ui')) ?? '{}') as Record<string, unknown>
    expect(stored).not.toHaveProperty('narrowScreen')
    stop()
  })

  it('starts on the channel list with no channel selected', async () => {
    useUi.getState().hydrate({ selectedChannelId: null, narrowScreen: 'channels' })
    const adapter = createFakeAdapter()
    await adapter.setItem(
      'ui',
      JSON.stringify({
        sidebarWidth: 260,
        sidebarCollapsed: false,
        selectedChannelId: channelA,
        expandedIds: [],
        threadWidth: 384,
      }),
    )

    await loadUi(adapter)

    // 選択チャネルは保存も復元もしないので、広幅でも一覧から始まる
    expect(useUi.getState().selectedChannelId).toBeNull()
    expect(useUi.getState().narrowScreen).toBe('channels')
  })

  it('does not persist selectedChannelId', async () => {
    const adapter = createFakeAdapter()
    const stop = watchUi(adapter)
    useUi.getState().selectChannel(channelA)
    await Promise.resolve()
    const stored = JSON.parse((await adapter.getItem('ui')) ?? '{}') as Record<string, unknown>
    expect(stored).not.toHaveProperty('selectedChannelId')
    stop()
  })

  it('keeps the selected channel when going back to the channel list', () => {
    const stop = watchNarrowHistory()
    seedNarrowHistory()
    useUi.getState().selectChannel(channelA)
    expect(useUi.getState().narrowScreen).toBe('timeline')
    useUi.getState().backNarrow()
    expect(useUi.getState().narrowScreen).toBe('channels')
    expect(useUi.getState().selectedChannelId).toBe(channelA)
    stop()
  })

  it('opens a thread and returns to the timeline', () => {
    const stop = watchNarrowHistory()
    seedNarrowHistory()
    useUi.getState().selectChannel(channelA)
    useUi.getState().openThread(postId)
    expect(useUi.getState().narrowScreen).toBe('thread')
    expect(useUi.getState().threadPostId).toBe(postId)
    useUi.getState().backNarrow()
    expect(useUi.getState().narrowScreen).toBe('timeline')
    expect(useUi.getState().threadPostId).toBeNull()
    expect(useUi.getState().selectedChannelId).toBe(channelA)
    stop()
  })

  it('does not push history on a wide viewport', () => {
    mockViewport(true)
    const length = window.history.length
    useUi.getState().selectChannel(channelA)
    useUi.getState().openThread(postId)
    expect(window.history.length).toBe(length)
    expect(useUi.getState().narrowScreen).toBe('thread')
    expect(useUi.getState().selectedChannelId).toBe(channelA)
  })

  it('keeps the selected channel when the viewport crosses the breakpoint', () => {
    useUi.getState().selectChannel(channelA)
    useUi.getState().openThread(postId)
    mockViewport(true)
    expect(useUi.getState().selectedChannelId).toBe(channelA)
    expect(useUi.getState().threadPostId).toBe(postId)
    mockViewport(false)
    expect(useUi.getState().selectedChannelId).toBe(channelA)
    expect(useUi.getState().threadPostId).toBe(postId)
  })

  it('restores the previous screen on popstate', () => {
    const stop = watchNarrowHistory()
    useUi.getState().selectChannel(channelA)
    useUi.getState().openThread(postId)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { postallNarrow: 'timeline' } }))
    expect(useUi.getState().narrowScreen).toBe('timeline')
    expect(useUi.getState().selectedChannelId).toBe(channelA)
    window.dispatchEvent(new PopStateEvent('popstate', { state: { postallNarrow: 'channels' } }))
    expect(useUi.getState().narrowScreen).toBe('channels')
    expect(useUi.getState().selectedChannelId).toBe(channelA)
    stop()
  })

  it('does not drop the selected channel when switching to another channel from the list', () => {
    useUi.getState().selectChannel(channelA)
    useUi.setState({ narrowScreen: 'channels' })
    useUi.getState().selectChannel(channelB)
    expect(useUi.getState().selectedChannelId).toBe(channelB)
    expect(useUi.getState().narrowScreen).toBe('timeline')
  })
})
