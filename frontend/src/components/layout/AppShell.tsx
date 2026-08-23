import { useRef } from 'react'
import { ChannelTree } from '@/components/channels/ChannelTree'
import { Timeline } from '@/components/timeline/Timeline'
import { ThreadPanel } from '@/components/thread/ThreadPanel'
import { BrowserChrome } from '@/components/layout/BrowserChrome'
import { useChannels } from '@/hooks/useChannels'
import { useUi } from '@/state/ui'
import { cn } from '@/lib/utils'

export function AppShell() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const width = useUi((s) => s.sidebarWidth)
  const selected = useUi((s) => s.selectedChannelId)
  const threadId = useUi((s) => s.threadPostId)
  const dragging = useRef(false)

  return (
    <div className="flex h-screen min-h-[600px] min-w-[800px] bg-background text-foreground">
      {!collapsed ? (
        <aside className="flex shrink-0 flex-col border-r border-border" style={{ width }} data-testid="sidebar">
          <ChannelTree />
        </aside>
      ) : null}
      <div
        role="separator"
        aria-orientation="vertical"
        className={cn('w-1 cursor-col-resize bg-border hover:bg-primary', collapsed && 'hidden')}
        onPointerDown={(e) => {
          dragging.current = true
          const startX = e.clientX
          const startW = width
          const move = (ev: PointerEvent) => {
            if (!dragging.current) return
            useUi.getState().setSidebarWidth(startW + ev.clientX - startX)
          }
          const up = () => {
            dragging.current = false
            window.removeEventListener('pointermove', move)
            window.removeEventListener('pointerup', up)
          }
          window.addEventListener('pointermove', move)
          window.addEventListener('pointerup', up)
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-11 items-center gap-2 border-b border-border px-3">
          <button type="button" onClick={() => useUi.getState().setSidebarCollapsed(!collapsed)}>
            {collapsed ? 'チャネルを表示' : '折りたたむ'}
          </button>
          <ChannelTitle />
          <BrowserChrome />
        </header>
        <div className="flex min-h-0 flex-1">
          <Timeline channelId={selected} />
          {threadId ? <ThreadPanel channelId={selected} /> : null}
        </div>
      </div>
    </div>
  )
}

function ChannelTitle() {
  const id = useUi((s) => s.selectedChannelId)
  const { data = [] } = useChannels()
  const name = data.find((c) => c.id === id)?.name
  return (
    <h1 className="truncate text-sm font-semibold" data-testid="channel-title">
      {name ? `# ${name}` : 'PostAll'}
    </h1>
  )
}
