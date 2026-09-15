import { create } from 'zustand'
import type { Attachment, SearchResult } from '@/api/client'
import type { PlatformAdapter } from '@/platform'
import { isWideViewport } from '@/lib/viewport'

export type ConnectionState = 'connecting' | 'live' | 'degraded' | 'offline'
export type NarrowScreen = 'channels' | 'timeline' | 'thread'

export type NarrowHistoryState = {
  postallNarrow?: NarrowScreen
}

export type FailedEdit = {
  body: string
  attachments: Attachment[]
  error: string
  /** 保存を試みた時点のポストの updatedAt。復元してよいかの判定に使う */
  postUpdatedAt: string
  /**
   * 保持入力より後にポストが更新されていたため復元をやめた印。
   * エントリを消さずに残すのは、破棄した事実を編集フォームの再マウント後も伝えるため。
   */
  discarded?: boolean
}

/**
 * サーバーがまだ確定していない投稿・返信。id はサーバーが採番するため確定まで存在せず、
 * 保留の同定には key（crypto.randomUUID）を使う。
 * 取得結果に混ぜず別レイヤーに置くのは、確定前に走る再取得で消えないようにするため。
 */
export type PendingPost = {
  key: string
  channelId: string
  /** 返信なら親スレッドの id。チャネル直下のポストなら null */
  threadRootId: string | null
  body: string
  attachments: Attachment[]
  createdAt: string
  status: 'sending' | 'failed'
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
  editingPostId: string | null
  autoOpenedEditPostId: string | null
  failedEdits: Record<string, FailedEdit>
  pendingPosts: PendingPost[]
  /** 楽観的に表示から取り除いているポストの id */
  deletingPostIds: string[]
  /** 削除に失敗したポストの id → その行に出す文言 */
  failedDeletes: Record<string, string>
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
  editingPostId: null,
  autoOpenedEditPostId: null,
  failedEdits: {},
  pendingPosts: [],
  deletingPostIds: [],
  failedDeletes: {},
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
  setEditingPost: (id: string | null) => void
  openEditorForFailure: (postId: string) => void
  setFailedEdit: (postId: string, failedEdit: FailedEdit) => void
  clearFailedEdit: (postId: string) => void
  addPendingPost: (pending: PendingPost) => void
  failPendingPost: (key: string) => void
  retryPendingPost: (key: string) => void
  removePendingPost: (key: string) => void
  startDeletingPost: (postId: string) => void
  failDeletingPost: (postId: string, message: string) => void
  clearDeletingPost: (postId: string) => void
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

function setPendingStatus(
  pendingPosts: PendingPost[],
  key: string,
  status: PendingPost['status'],
): { pendingPosts: PendingPost[] } | Record<string, never> {
  let changed = false
  const next = pendingPosts.map((pending) => {
    if (pending.key !== key || pending.status === status) return pending
    changed = true
    return { ...pending, status }
  })
  return changed ? { pendingPosts: next } : {}
}

function withoutKey<T>(source: Record<string, T>, key: string): Record<string, T> {
  if (!(key in source)) return source
  const next = { ...source }
  delete next[key]
  return next
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
      editingPostId: null,
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
        editingPostId: null,
        narrowScreen: get().narrowScreen === 'thread' ? 'timeline' : get().narrowScreen,
      })
      return
    }
    const from = get().narrowScreen
    set({ threadPostId, targetThreadReplyId: null, editingPostId: null, narrowScreen: 'thread' })
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
  // 編集フォームは同時に 1 件だけ開く。別のポストを指定すると先の編集は破棄される。
  // ただし保存に失敗した入力は failedEdits に残り、当該ポストの編集を確定または取り消すまで破棄されない。
  // 例外として、保持入力より後にポストが更新されていた場合は編集フォームを開いた時点で
  // 復元をやめ、discarded を立てる（PostEditor.tsx）。
  setEditingPost: (editingPostId) => set({ editingPostId, autoOpenedEditPostId: null }),
  openEditorForFailure: (postId) => set({ editingPostId: postId, autoOpenedEditPostId: postId }),
  setFailedEdit: (postId, failedEdit) => set((state) => ({
    failedEdits: { ...state.failedEdits, [postId]: failedEdit },
  })),
  clearFailedEdit: (postId) => set((state) => {
    if (!(postId in state.failedEdits)) return state
    const failedEdits = { ...state.failedEdits }
    delete failedEdits[postId]
    return { failedEdits }
  }),
  addPendingPost: (pending) => set((state) => ({ pendingPosts: [...state.pendingPosts, pending] })),
  failPendingPost: (key) => set((state) => setPendingStatus(state.pendingPosts, key, 'failed')),
  // 再送は行を動かさずに送信中へ戻す。破棄されていれば（key が無ければ）何もしない。
  retryPendingPost: (key) => set((state) => setPendingStatus(state.pendingPosts, key, 'sending')),
  // 確定による解除とユーザーの破棄はどちらも「保留レイヤーから消す」だけで、後始末は変わらない。
  removePendingPost: (key) => set((state) => {
    const pendingPosts = state.pendingPosts.filter((pending) => pending.key !== key)
    return pendingPosts.length === state.pendingPosts.length ? state : { pendingPosts }
  }),
  // 削除の開始と再試行は同じ遷移。再試行では前回の失敗の文言も落とす。
  startDeletingPost: (postId) => set((state) => {
    const deletingPostIds = state.deletingPostIds.includes(postId)
      ? state.deletingPostIds
      : [...state.deletingPostIds, postId]
    return { deletingPostIds, failedDeletes: withoutKey(state.failedDeletes, postId) }
  }),
  failDeletingPost: (postId, message) => set((state) => ({
    deletingPostIds: state.deletingPostIds.filter((id) => id !== postId),
    failedDeletes: { ...state.failedDeletes, [postId]: message },
  })),
  clearDeletingPost: (postId) => set((state) => {
    const deletingPostIds = state.deletingPostIds.filter((id) => id !== postId)
    return deletingPostIds.length === state.deletingPostIds.length ? state : { deletingPostIds }
  }),
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
