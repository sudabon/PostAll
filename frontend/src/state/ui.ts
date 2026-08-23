import { create } from 'zustand'
import type { SearchResult } from '@/api/client'
import type { PlatformAdapter } from '@/platform'

export type ConnectionState = 'connecting' | 'live' | 'degraded' | 'offline'

export type UiState = {
  sidebarWidth: number
  sidebarCollapsed: boolean
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
}

const initial: UiState = {
  sidebarWidth: 260,
  sidebarCollapsed: false,
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
}

type UiStore = UiState & {
  hydrate: (partial: Partial<UiState>) => void
  setSidebarWidth: (width: number) => void
  setSidebarCollapsed: (collapsed: boolean) => void
  selectChannel: (id: string | null) => void
  toggleExpanded: (id: string) => void
  setExpanded: (ids: string[]) => void
  openThread: (id: string | null) => void
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

export const useUi = create<UiStore>((set, get) => ({
  ...initial,
  hydrate: (partial) => set(partial),
  setSidebarWidth: (sidebarWidth) => set({ sidebarWidth: Math.min(420, Math.max(180, sidebarWidth)) }),
  setSidebarCollapsed: (sidebarCollapsed) => set({ sidebarCollapsed }),
  selectChannel: (selectedChannelId) => set({
    selectedChannelId,
    threadPostId: null,
    timelineAnchorId: null,
    targetPostId: null,
    targetThreadReplyId: null,
  }),
  toggleExpanded: (id) => {
    const cur = get().expandedIds
    set({ expandedIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] })
  },
  setExpanded: (expandedIds) => set({ expandedIds }),
  openThread: (threadPostId) => set({ threadPostId, targetThreadReplyId: null }),
  navigateToSearchResult: (result) => set({
    selectedChannelId: result.channelId,
    threadPostId: result.threadRootId,
    searchOpen: false,
    timelineAnchorId: result.timelinePostId,
    targetPostId: result.timelinePostId,
    targetThreadReplyId: result.threadRootId ? result.postId : null,
  }),
  returnToLatest: () => set({
    threadPostId: null,
    timelineAnchorId: null,
    targetPostId: null,
    targetThreadReplyId: null,
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

export class ConnectionUnavailableError extends Error {
  constructor() {
    super('接続されていないため変更できません')
  }
}

export function requireMutationConnection() {
  if (!useUi.getState().canMutate) throw new ConnectionUnavailableError()
}

export async function loadUi(adapter: PlatformAdapter) {
  const raw = await adapter.getItem('ui')
  if (!raw) return
  const parsed = JSON.parse(raw) as Partial<UiState>
  useUi.getState().hydrate({
    sidebarWidth: parsed.sidebarWidth,
    sidebarCollapsed: parsed.sidebarCollapsed,
    selectedChannelId: parsed.selectedChannelId,
    expandedIds: parsed.expandedIds,
  })
}

export function watchUi(adapter: PlatformAdapter) {
  return useUi.subscribe((state) => {
    void adapter.setItem(
      'ui',
      JSON.stringify({
        sidebarWidth: state.sidebarWidth,
        sidebarCollapsed: state.sidebarCollapsed,
        selectedChannelId: state.selectedChannelId,
        expandedIds: state.expandedIds,
      }),
    )
  })
}
