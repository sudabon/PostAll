import {
  DndContext,
  MouseSensor,
  PointerSensor,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragOverEvent,
} from '@dnd-kit/core'
import { CSS } from '@dnd-kit/utilities'
import { useMemo, useState } from 'react'
import type { Channel } from '@/api/client'
import { buildForest, descendantIds, flattenVisible } from '@/lib/tree'
import { useChannelMutations, useChannels, errorMessage } from '@/hooks/useChannels'
import { useUi } from '@/state/ui'
import { cn } from '@/lib/utils'

type Intent = 'before' | 'after' | 'child' | null

export function ChannelTree() {
  const { data = [], isError, refetch } = useChannels()
  const mutations = useChannelMutations()
  const selected = useUi((s) => s.selectedChannelId)
  const expandedIds = useUi((s) => s.expandedIds)
  const creating = useUi((s) => s.creating)
  const renamingId = useUi((s) => s.renamingId)
  const canMutate = useUi((s) => s.canMutate)
  const [notice, setNotice] = useState<string | null>(null)
  const [overId, setOverId] = useState<string | null>(null)
  const [intent, setIntent] = useState<Intent>(null)
  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
  )

  const forest = useMemo(() => buildForest(data), [data])
  const expanded = useMemo(() => new Set(expandedIds), [expandedIds])
  const rows = flattenVisible(forest, expanded)

  const intentFromRects = (event: DragOverEvent | DragEndEvent): Intent => {
    const over = event.over
    if (!over) return null
    const translated = event.active.rect.current.translated
    const y = translated ? translated.top + translated.height / 2 : over.rect.top + over.rect.height / 2
    const ratio = (y - over.rect.top) / Math.max(over.rect.height, 1)
    if (ratio < 0.25) return 'before'
    if (ratio > 0.75) return 'after'
    return 'child'
  }

  const onDragOver = (event: DragOverEvent) => {
    if (!canMutate) return
    const over = event.over?.id ? String(event.over.id) : null
    setOverId(over)
    setIntent(over ? intentFromRects(event) : null)
  }

  const onDragEnd = (event: DragEndEvent) => {
    if (!canMutate) return
    const activeId = String(event.active.id)
    const overIdNow = event.over ? String(event.over.id) : null
    const dropIntent = intentFromRects(event)
    setOverId(null)
    setIntent(null)
    if (!overIdNow || !dropIntent || activeId === overIdNow) return
    const blocked = descendantIds(forest, activeId)
    if (blocked.has(overIdNow)) {
      setNotice('自身または子孫へは移動できません')
      return
    }
    const over = data.find((c) => c.id === overIdNow)
    if (!over) return
    const parentId = dropIntent === 'child' ? over.id : (over.parentId ?? null)
    const beforeId = dropIntent === 'before' ? over.id : null
    const afterId = dropIntent === 'after' ? over.id : null
    const optimistic = applyOptimistic(data, activeId, parentId, beforeId, afterId)
    mutations.move.mutate(
      { id: activeId, parentId, beforeId, afterId, optimistic },
      {
        onError: (err) => setNotice(errorMessage(err)),
        onSuccess: () => {
          if (dropIntent === 'child') {
            const ids = useUi.getState().expandedIds
            if (!ids.includes(over.id)) useUi.getState().setExpanded([...ids, over.id])
          }
        },
      },
    )
  }

  return (
    <div className="flex h-full min-w-0 flex-col" data-testid="channel-tree">
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">チャネル</span>
        <button
          type="button"
          className="text-sm text-primary"
          data-testid="new-channel-button"
          disabled={!canMutate}
          onClick={() => useUi.getState().startCreate(null)}
        >
          新規
        </button>
      </div>
      {notice ? <p className="px-3 text-xs text-destructive">{notice}</p> : null}
      {isError ? (
        <button type="button" className="px-3 text-left text-sm text-destructive" onClick={() => void refetch()}>
          チャネルの取得に失敗しました。再試行
        </button>
      ) : null}
      {creating ? (
        <NameForm
          disabled={!canMutate}
          placeholder={creating.parentId ? '子チャネル名' : 'チャネル名'}
          onSubmit={(name) => {
            mutations.create.mutate(
              { name, parentId: creating.parentId },
              {
                onError: (err) => setNotice(errorMessage(err)),
                onSuccess: (ch) => {
                  useUi.setState({ creating: null })
                  useUi.getState().selectChannel(ch.id)
                  if (creating.parentId) {
                    const ids = useUi.getState().expandedIds
                    if (!ids.includes(creating.parentId)) useUi.getState().setExpanded([...ids, creating.parentId])
                  }
                },
              },
            )
          }}
          onCancel={() => useUi.setState({ creating: null })}
        />
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">
        <DndContext sensors={sensors} onDragOver={onDragOver} onDragEnd={onDragEnd}>
          {rows.map(({ node, depth }) => (
            <TreeRow
              key={node.id}
              channel={node}
              depth={depth}
              selected={selected === node.id}
              expanded={expanded.has(node.id)}
              dropIntent={overId === node.id ? intent : null}
              renaming={renamingId === node.id}
              mutationDisabled={!canMutate}
              onRename={(name) => {
                mutations.rename.mutate(
                  { id: node.id, name },
                  {
                    onError: (err) => setNotice(errorMessage(err)),
                    onSuccess: () => useUi.getState().setRenaming(null),
                  },
                )
              }}
              onDelete={() => {
                mutations.remove.mutate(node.id, {
                  onError: (err) => setNotice(errorMessage(err)),
                  onSuccess: () => {
                    if (useUi.getState().selectedChannelId === node.id) useUi.getState().selectChannel(null)
                  },
                })
              }}
            />
          ))}
        </DndContext>
      </div>
    </div>
  )
}

function TreeRow({
  channel,
  depth,
  selected,
  expanded,
  dropIntent,
  renaming,
  mutationDisabled,
  onRename,
  onDelete,
}: {
  channel: Channel & { children: { id: string }[] }
  depth: number
  selected: boolean
  expanded: boolean
  dropIntent: Intent
  renaming: boolean
  mutationDisabled: boolean
  onRename: (name: string) => void
  onDelete: () => void
}) {
  const { attributes, listeners, setNodeRef: setDrag, transform, isDragging } = useDraggable({
    id: channel.id,
    disabled: mutationDisabled,
  })
  const { setNodeRef: setDrop, isOver } = useDroppable({ id: channel.id, disabled: mutationDisabled })
  return (
    <div
      ref={(el) => {
        setDrag(el)
        setDrop(el)
      }}
      style={{
        transform: isDragging ? CSS.Translate.toString(transform) : undefined,
        paddingLeft: 8 + Math.min(depth, 8) * 12,
        opacity: isDragging ? 0.5 : 1,
      }}
      data-testid={`channel-row-${channel.name}`}
      data-depth={depth}
      className={cn(
        'group flex min-w-max items-center gap-1 px-2 py-1 text-sm',
        selected && 'bg-accent',
        isOver && dropIntent === 'child' && 'bg-primary/10',
        isOver && dropIntent === 'before' && 'border-t-2 border-primary',
        isOver && dropIntent === 'after' && 'border-b-2 border-primary',
      )}
    >
      {channel.children.length > 0 ? (
        <button
          type="button"
          className="w-4 text-muted-foreground"
          onClick={() => useUi.getState().toggleExpanded(channel.id)}
        >
          {expanded ? '▾' : '▸'}
        </button>
      ) : (
        <span className="w-4" />
      )}
      {renaming ? (
        <NameForm
          initial={channel.name}
          disabled={mutationDisabled}
          onSubmit={onRename}
          onCancel={() => useUi.getState().setRenaming(null)}
        />
      ) : (
        <>
          <button
            type="button"
            className="cursor-grab px-0.5 text-muted-foreground"
            data-testid={`channel-drag-${channel.name}`}
            aria-label={`${channel.name} を移動`}
            disabled={mutationDisabled}
            {...listeners}
            {...attributes}
          >
            ⋮⋮
          </button>
          <button
            type="button"
            className="flex-1 truncate text-left"
            data-testid={`channel-${channel.name}`}
            onClick={() => useUi.getState().selectChannel(channel.id)}
          >
            # {channel.name}
          </button>
        </>
      )}
      <span className="hidden gap-1 group-hover:flex">
        <button
          type="button"
          className="text-xs text-muted-foreground"
          disabled={mutationDisabled}
          onClick={() => useUi.getState().startCreate(channel.id)}
        >
          子
        </button>
        <button
          type="button"
          className="text-xs text-muted-foreground"
          disabled={mutationDisabled}
          onClick={() => useUi.getState().setRenaming(channel.id)}
        >
          改名
        </button>
        <button type="button" className="text-xs text-destructive" disabled={mutationDisabled} onClick={onDelete}>
          削除
        </button>
      </span>
    </div>
  )
}

function NameForm({
  initial = '',
  placeholder,
  disabled = false,
  onSubmit,
  onCancel,
}: {
  initial?: string
  placeholder?: string
  disabled?: boolean
  onSubmit: (name: string) => void
  onCancel: () => void
}) {
  const [value, setValue] = useState(initial)
  return (
    <form
      className="px-2 py-1"
      onSubmit={(e) => {
        e.preventDefault()
        if (disabled) return
        if (value.trim()) onSubmit(value.trim())
      }}
    >
      <input
        autoFocus
        data-testid="channel-name-input"
        className="w-full rounded border border-input bg-background px-2 py-1 text-sm"
        placeholder={placeholder}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel()
        }}
      />
    </form>
  )
}

function applyOptimistic(
  channels: Channel[],
  id: string,
  parentId: string | null,
  beforeId: string | null,
  afterId: string | null,
): Channel[] {
  const moving = channels.find((c) => c.id === id)
  if (!moving) return channels
  const rest = channels.filter((c) => c.id !== id)
  const siblings = rest.filter((c) => (c.parentId ?? null) === parentId)
  let sortKey = 'n'
  if (beforeId) {
    const before = siblings.find((c) => c.id === beforeId)
    sortKey = before ? before.sortKey.slice(0, 1) : 'n'
  } else if (afterId) {
    const after = siblings.find((c) => c.id === afterId)
    sortKey = after ? `${after.sortKey}z` : 'n'
  } else if (siblings.length > 0) {
    sortKey = `${siblings[siblings.length - 1].sortKey}z`
  }
  return [...rest, { ...moving, parentId, sortKey }]
}
