import { useLayoutEffect, useRef, useState } from 'react'
import { AnimatePresence, animate, m } from 'motion/react'
import { ChevronsLeft, ChevronsRight } from 'lucide-react'
import { ChannelTree } from '@/components/channels/ChannelTree'
import { Timeline } from '@/components/timeline/Timeline'
import { ThreadPanel } from '@/components/thread/ThreadPanel'
import { BrowserChrome } from '@/components/layout/BrowserChrome'
import { useChannels } from '@/hooks/useChannels'
import { useUi } from '@/state/ui'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { useDragValue } from '@/lib/motion/useDragValue'
import { springPresets } from '@/lib/motion/springs'

export function AppShell() {
  const collapsed = useUi((s) => s.sidebarCollapsed)
  const width = useUi((s) => s.sidebarWidth)
  const selected = useUi((s) => s.selectedChannelId)
  const threadId = useUi((s) => s.threadPostId)
  const [isContentUnderChrome, setContentUnderChrome] = useState(false)
  const collapseAnimation = useRef<{ stop: () => void } | null>(null)
  const firstCollapseRender = useRef(true)
  const sidebar = useDragValue({
    initialValue: width,
    min: 180,
    max: 420,
    dimension: 240,
    onCommit: (nextWidth) => useUi.getState().setSidebarWidth(nextWidth),
  })
  const { onPointerDown, ...dragProps } = sidebar.dragProps

  useLayoutEffect(() => {
    if (firstCollapseRender.current) {
      firstCollapseRender.current = false
      if (collapsed) sidebar.value.set(0)
      return
    }

    collapseAnimation.current?.stop()
    collapseAnimation.current = animate(
      sidebar.value,
      collapsed ? 0 : useUi.getState().sidebarWidth,
      sidebar.shouldReduceMotion ? { duration: 0 } : springPresets.snap,
    )
    return () => collapseAnimation.current?.stop()
  }, [collapsed, sidebar.shouldReduceMotion, sidebar.value])

  const setSidebarWidth = (nextWidth: number) => {
    useUi.getState().setSidebarWidth(nextWidth)
    sidebar.value.set(useUi.getState().sidebarWidth)
  }

  return (
    <div className="flex h-dvh min-w-[800px] bg-background text-foreground">
      <m.aside
        className="material-thick relative z-20 flex shrink-0 flex-col overflow-hidden shadow-md"
        style={{ width: sidebar.value }}
        aria-hidden={collapsed}
        inert={collapsed}
        data-testid="sidebar"
      >
        <div className="h-full min-w-48">
          <ChannelTree />
        </div>
      </m.aside>
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={180}
        aria-valuemax={420}
        aria-valuenow={Math.round(width)}
        aria-label="サイドバーの幅"
        tabIndex={collapsed ? -1 : 0}
        className={cn(
          'relative z-30 w-1.5 cursor-col-resize touch-pan-y bg-transparent outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-ring',
          collapsed && 'pointer-events-none w-0 opacity-0',
        )}
        {...dragProps}
        onPointerDown={(event) => {
          collapseAnimation.current?.stop()
          onPointerDown(event)
        }}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10
          if (event.key === 'ArrowLeft') setSidebarWidth(width - step)
          else if (event.key === 'ArrowRight') setSidebarWidth(width + step)
          else if (event.key === 'Home') setSidebarWidth(180)
          else if (event.key === 'End') setSidebarWidth(420)
          else return
          event.preventDefault()
        }}
      />
      <div className="relative flex min-w-0 flex-1 flex-col">
        <header
          className={cn(
            'material-thin absolute inset-x-0 top-0 z-30 flex h-12 items-center gap-2 px-3 shadow-sm transition-[background-color,box-shadow,backdrop-filter]',
            isContentUnderChrome && 'material-regular shadow-md',
          )}
        >
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            aria-label={collapsed ? 'チャネルを表示' : '折りたたむ'}
            title={collapsed ? 'チャネルを表示' : '折りたたむ'}
            aria-expanded={!collapsed}
            data-testid="sidebar-toggle"
            onClick={() => useUi.getState().setSidebarCollapsed(!collapsed)}
          >
            {collapsed ? <ChevronsRight className="size-4" /> : <ChevronsLeft className="size-4" />}
          </Button>
          <ChannelTitle />
          <span
            className="pointer-events-none absolute left-1/2 -translate-x-1/2 select-none font-script text-brand font-semibold tracking-normal"
            data-testid="app-brand"
          >
            PostAll
          </span>
          <BrowserChrome />
          <span
            aria-hidden="true"
            className={cn(
              'scroll-edge-mask pointer-events-none absolute inset-x-0 top-full h-4 opacity-0 transition-opacity',
              isContentUnderChrome && 'opacity-100',
            )}
          />
        </header>
        <div className="flex min-h-0 flex-1">
          <Timeline channelId={selected} onScrollEdgeChange={setContentUnderChrome} />
          <AnimatePresence initial={false}>
            {threadId ? <ThreadPanel key={threadId} channelId={selected} /> : null}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
}

function ChannelTitle() {
  const id = useUi((s) => s.selectedChannelId)
  const { data = [] } = useChannels()
  const name = data.find((c) => c.id === id)?.name
  if (!name) return null
  return (
    <h1 className="max-w-[30%] truncate text-title font-semibold" data-testid="channel-title">
      {`# ${name}`}
    </h1>
  )
}
