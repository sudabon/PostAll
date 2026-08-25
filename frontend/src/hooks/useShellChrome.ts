import { useEffect } from 'react'
import { useAuth } from '@/auth/AuthProvider'
import { buildForest, visibleSequence } from '@/lib/tree'
import { usePlatform, type MenuTemplate } from '@/platform'
import { useUi } from '@/state/ui'
import { useChannels } from '@/hooks/useChannels'

export function useShellChrome() {
  const platform = usePlatform()
  const { signOut, signedIn } = useAuth()
  const { data = [] } = useChannels()

  useEffect(() => {
    const template: MenuTemplate = [
      {
        label: 'PostAll',
        submenu: [
          { id: 'settings', label: '設定...', accelerator: 'CmdOrCtrl+,' },
          { type: 'separator' },
          { id: 'signOut', label: 'サインアウト' },
        ],
      },
      {
        label: '編集',
        submenu: [
          { type: 'role', role: 'undo' },
          { type: 'role', role: 'redo' },
          { type: 'separator' },
          { type: 'role', role: 'cut' },
          { type: 'role', role: 'copy' },
          { type: 'role', role: 'paste' },
          { type: 'role', role: 'selectAll' },
        ],
      },
      {
        label: '表示',
        submenu: [
          { id: 'toggleSidebar', label: 'サイドバーを切り替え' },
          { type: 'separator' },
          { type: 'role', role: 'togglefullscreen' },
        ],
      },
      {
        label: '移動',
        submenu: [
          { id: 'focusComposer', label: '入力フォームへ', accelerator: 'CmdOrCtrl+L' },
          { id: 'newChannel', label: '新規チャネル', accelerator: 'CmdOrCtrl+N' },
          { id: 'search', label: '検索', accelerator: 'CmdOrCtrl+K' },
          { id: 'nextChannel', label: '次のチャネル', accelerator: 'Alt+Down' },
          { id: 'prevChannel', label: '前のチャネル', accelerator: 'Alt+Up' },
        ],
      },
      {
        label: 'ウィンドウ',
        submenu: [{ type: 'role', role: 'minimize' }, { type: 'role', role: 'close' }],
      },
    ]
    if (signedIn && platform.has('appMenu')) void platform.setMenu(template)
  }, [platform, signedIn])

  useEffect(() => {
    const run = (id: string) => {
      const ui = useUi.getState()
      if (id === 'settings') ui.setSettingsOpen(true)
      if (id === 'signOut') void signOut()
      if (id === 'toggleSidebar') ui.setSidebarCollapsed(!ui.sidebarCollapsed)
      if (id === 'focusComposer') ui.focusComposer()
      if (id === 'newChannel') ui.startCreate(null)
      if (id === 'search') ui.setSearchOpen(true)
      if (id === 'nextChannel' || id === 'prevChannel') {
        const forest = buildForest(data)
        const seq = visibleSequence(forest, new Set(ui.expandedIds))
        if (seq.length === 0) return
        const idx = seq.findIndex((c) => c.id === ui.selectedChannelId)
        const next = id === 'nextChannel' ? seq[(idx + 1 + seq.length) % seq.length] : seq[(idx - 1 + seq.length) % seq.length]
        ui.selectChannel(next.id)
      }
    }
    const offMenu = platform.onMenuAction(run)
    const offShortcut = platform.onShortcut(run)
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const typing = target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      const searchShortcut = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k'
      if (typing && (e.key === 'c' || e.key === 'v' || e.key === 'x' || e.key === 'z' || e.key === 'a') && (e.metaKey || e.ctrlKey)) {
        return
      }
      if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault()
        run('nextChannel')
        return
      }
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault()
        run('prevChannel')
        return
      }
      if (typing && !searchShortcut && e.key !== 'Escape') return
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'l') {
        e.preventDefault()
        run('focusComposer')
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        run('newChannel')
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        run('search')
      }
      if ((e.metaKey || e.ctrlKey) && e.key === ',') {
        e.preventDefault()
        run('settings')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => {
      offMenu()
      offShortcut()
      window.removeEventListener('keydown', onKey)
    }
  }, [data, platform, signOut])
}
