import { create } from 'zustand'
import type { SearchResult } from '@/api/client'
import type { PlatformAdapter } from '@/platform'
import { isWideViewport } from '@/lib/viewport'

export type ConnectionState = 'connecting' | 'live' | 'degraded' | 'offline'
export type NarrowScreen = 'channels' | 'timeline' | 'thread'

export type NarrowHistoryState = {
  postallNarrow?: NarrowScreen
}

export type UiState = {
  sidebarWidth: number
  sidebarCollapsed: boolean
  threadWidth: number
  selectedChannelId: string | null
  expandedIds: string[]
  threadPostId: string | null
  timelineAnchorId: string | null
  targetPostId: string | null
  targetThreadReplyId: string | null
  settingsOpen: boolean
  searchOpen: boolean
  creating: { parentId: string | null } | null
  renamingId: string | null
  composerEpoch: number
  connectionState: ConnectionState
  canMutate: boolean
  connectionError: string | null
  updateAvailable: boolean
  narrowScreen: NarrowScreen
}

export const THREAD_MIN_WIDTH = 320
export const THREAD_MAX_WIDTH = 640

const initial: UiState = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
  threadWidth: 384,
  selectedChannelId: null,
  expandedIds: [],
  threadPostId: null,
  timelineAnchorId: null,
  targetPostId: null,
  targetThreadReplyId: null,
  settingsOpen: false,
  searchOpen: false,
  creating: null,
  renamingId: null,
  composerEpoch: 0,
  connectionState: 'connecting',
  canMutate: true,
  connectionError: null,
  updateAvailable: false,
  narrowScreen: 'channels',
}

type UiStore = UiState & {
  hydrate: (partial: Partial<UiState>) => void
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  setThreadWidth: (width: number) => void
  selectChannel: (id: string | null) => void
  toggleExpanded: (id: string) => void
  setExpanded: (ids: string[]) => void
  openThread: (id: string | null) => void
  backNarrow: () => void
  navigateToSearchResult: (result: SearchResult) => void
  returnToLatest: () => void
  setSettingsOpen: (open: boolean) => void
  setSearchOpen: (open: boolean) => void
  startCreate: (parentId: string | null) => void
  setRenaming: (id: string | null) => void
  focusComposer: () => void
  setConnectionState: (state: ConnectionState) => void
  setConnectionError: (message: string | null) => void
  setUpdateAvailable: (available: boolean) => void
}

function historyScreen(): NarrowScreen | undefined {
  return (window.history.state as NarrowHistoryState | null)?.postallNarrow
}

function pushNarrow(screen: NarrowScreen) {
  if (isWideViewport()) return
  if (historyScreen() === screen) return
  window.history.pushState({ postallNarrow: screen } satisfies NarrowHistoryState, '')
}

function applyNarrowBack(from: NarrowScreen) {
  if (from === 'thread') {
    useUi.setState({
      narrowScreen: 'timeline',
      threadPostId: null,
      targetThreadReplyId: null,
    })
    return
  }
  if (from === 'timeline') {
    useUi.setState({ narrowScreen: 'channels' })
  }
}

export const useUi = create<UiStore>((set, get) => ({
  ...initial,
  hydrate: (partial) => set(partial),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.min(420, Math.max(180, sidebarWidth)) }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  setThreadWidth: (threadWidth) => set({
    threadWidth: Math.min(THREAD_MAX_WIDTH, Math.max(THREAD_MIN_WIDTH, threadWidth)),
  }),
  selectChannel: (selectedChannelId) => {
    const from = get().narrowScreen
    const narrowScreen: NarrowScreen = selectedChannelId ? 'timeline' : 'channels'
    set({
      selectedChannelId,
      threadPostId: null,
      timelineAnchorId: null,
      targetPostId: null,
      targetThreadReplyId: null,
      narrowScreen,
    })
    if (selectedChannelId && from !== 'timeline') pushNarrow('timeline')
  },
  toggleExpanded: (id) => {
    const cur = get().expandedIds
    set({ expandedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  },
  setExpanded: (expandedIds) => set({ expandedIds }),
  openThread: (threadPostId) => {
    if (!threadPostId) {
      set({
        threadPostId: null,
        targetThreadReplyId: null,
        narrowScreen: get().narrowScreen === 'thread' ? 'timeline' : get().narrowScreen,
      })
      return
    }
    const from = get().narrowScreen
    set({ threadPostId, targetThreadReplyId: null, narrowScreen: 'thread' })
    if (from !== 'thread') pushNarrow('thread')
  },
  backNarrow: () => {
    if (isWideViewport()) return
    const from = get().narrowScreen
    applyNarrowBack(from)
    if (historyScreen()) window.history.back()
  },
  navigateToSearchResult: (result) => {
    const from = get().narrowScreen
    const narrowScreen: NarrowScreen = result.threadRootId ? 'thread' : 'timeline'
    set({
      selectedChannelId: result.channelId,
      threadPostId: result.threadRootId,
      searchOpen: false,
      timelineAnchorId: result.timelinePostId,
      targetPostId: result.timelinePostId,
      targetThreadReplyId: result.threadRootId ? result.postId : null,
      narrowScreen,
    })
    if (from !== narrowScreen) pushNarrow(narrowScreen)
  },
  returnToLatest: () => set({
    threadPostId: null,
    timelineAnchorId: null,
    targetPostId: null,
    targetThreadReplyId: null,
    narrowScreen: get().narrowScreen === 'thread' ? 'timeline' : get().narrowScreen,
  }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  startCreate: (parentId) => set({ creating: { parentId } }),
  setRenaming: (renamingId) => set({ renamingId }),
  focusComposer: () => set({ composerEpoch: get().composerEpoch + 1 }),
  setConnectionState: (connectionState) => set({
    connectionState,
    canMutate: connectionState !== 'offline',
  }),
  setConnectionError: (connectionError) => set({ connectionError }),
  setUpdateAvailable: (updateAvailable) => set({ updateAvailable }),
}))

export function watchNarrowHistory() {
  const onPop = (event: PopStateEvent) => {
    const screen = (event.state as NarrowHistoryState | null)?.postallNarrow
    if (screen !== 'channels' && screen !== 'timeline' && screen !== 'thread') return
    const patch: Partial<UiState> = { narrowScreen: screen }
    if (screen !== 'thread') {
      patch.threadPostId = null
      patch.targetThreadReplyId = null
    }
    useUi.setState(patch)
  }
  window.addEventListener('popstate', onPop)
  return () => window.removeEventListener('popstate', onPop)
}

export function seedNarrowHistory() {
  if (isWideViewport()) return
  // 履歴 state はリロードをまたいで残る。起動時は必ず現在の画面で上書きしないと、
  // 一覧を表示しているのに state が 'timeline' のままになり、
  // pushNarrow が重複とみなして push を省略し、戻るでアプリの外へ出てしまう。
  window.history.replaceState(
    { postallNarrow: useUi.getState().narrowScreen } satisfies NarrowHistoryState,
    '',
  )
}

export class ConnectionUnavailableError extends Error {
  constructor() {
    super('接続されていないため変更できません')
  }
}

export function requireMutationConnection() {
  if (!useUi.getState().canMutate) throw new ConnectionUnavailableError()
}

// selectedChannelId は永続化しない。起動時は全デバイスでチャネル一覧から始める。
const persistedKeys = [
  'sidebarWidth',
  'sidebarCollapsed',
  'expandedIds',
  'threadWidth',
] as const

type PersistedUi = Pick<UiState, (typeof persistedKeys)[number]>

/**
 * 永続化対象のキーだけを取り出す。zustand の set は Object.assign 相当なので、
 * 保存データに無いキーをそのまま渡すと undefined で初期値を上書きしてしまう。
 * 古い保存データを読んでも初期値が保たれるよう、undefined のキーは落とす。
 */
function pickPersisted(source: Partial<PersistedUi>): Partial<PersistedUi> {
  const next: Partial<PersistedUi> = {}
  for (const key of persistedKeys) {
    if (source[key] === undefined) continue
    Object.assign(next, { [key]: source[key] })
  }
  return next
}

export async function loadUi(adapter: PlatformAdapter) {
  const raw = await adapter.getItem('ui')
  if (!raw) return
  const parsed = JSON.parse(raw) as Partial<UiState>
  useUi.getState().hydrate(pickPersisted(parsed))
}

export function watchUi(adapter: PlatformAdapter) {
  return useUi.subscribe((state) => {
    void adapter.setItem('ui', JSON.stringify(pickPersisted(state)))
  })
}
