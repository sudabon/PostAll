import { useEffect, useRef, useState } from 'react'
import { m, useReducedMotion } from 'motion/react'
import { Pencil, Trash2 } from 'lucide-react'
import type { Post } from '@/api/client'
import { springPresets } from '@/lib/motion/springs'
import { useUi } from '@/state/ui'
import { cn } from '@/lib/utils'

export function PostActions({
  post,
  kind,
  mutationDisabled,
  onDelete,
}: {
  post: Post
  kind: 'ポスト' | '返信'
  mutationDisabled: boolean
  onDelete: () => void
}) {
  const editing = useUi((s) => s.editingPostId === post.id)
  const [revealed, setRevealed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const wasEditing = useRef(false)
  const attachments = post.attachments ?? []
  const summary = post.body.trim().slice(0, 30) || attachments[0]?.fileName || post.id
  const shouldReduceMotion = useReducedMotion()

  // 編集フォームはこのポストの本文位置に開く。閉じたら開始点の鉛筆ボタンへ戻す。
  useEffect(() => {
    if (editing) {
      wasEditing.current = true
      return
    }
    if (!wasEditing.current) return
    wasEditing.current = false
    const frame = requestAnimationFrame(() => triggerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editing])

  useEffect(() => {
    const row = triggerRef.current?.closest<HTMLElement>('.group')
    if (!row) return
    const reveal = () => setRevealed(true)
    const conceal = () => {
      if (!row.matches(':focus-within')) setRevealed(false)
    }
    const onFocusOut = (event: FocusEvent) => {
      if (!row.contains(event.relatedTarget as Node | null)) setRevealed(false)
    }
    row.addEventListener('pointerenter', reveal)
    row.addEventListener('pointerleave', conceal)
    row.addEventListener('focusin', reveal)
    row.addEventListener('focusout', onFocusOut)
    return () => {
      row.removeEventListener('pointerenter', reveal)
      row.removeEventListener('pointerleave', conceal)
      row.removeEventListener('focusin', reveal)
      row.removeEventListener('focusout', onFocusOut)
    }
  }, [])

  return (
    <m.div
      initial={false}
      animate={shouldReduceMotion
        ? { opacity: revealed ? 1 : 0 }
        : { opacity: revealed ? 1 : 0, y: revealed ? 0 : -4, scale: revealed ? 1 : 0.96 }}
      transition={shouldReduceMotion ? { duration: 0.14, ease: 'easeOut' } : springPresets.snap}
      className={cn(
        'material-thin absolute right-2 top-2 flex gap-1 rounded-lg p-1 shadow-sm',
        !revealed && 'pointer-events-none',
      )}
      data-testid="post-actions"
      data-visible={revealed}
    >
      <button
        ref={triggerRef}
        type="button"
        className="rounded-lg p-1.5 hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`${kind}を編集: ${summary}`}
        title="編集"
        disabled={mutationDisabled}
        onClick={() => useUi.getState().setEditingPost(post.id)}
      >
        <Pencil className="size-4" />
      </button>
      <button
        type="button"
        className="rounded-lg p-1.5 text-destructive hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label={`${kind}を削除: ${summary}`}
        title="削除"
        disabled={mutationDisabled}
        onClick={() => {
          if (window.confirm(`この${kind}を削除しますか？`)) onDelete()
        }}
      >
        <Trash2 className="size-4" />
      </button>
    </m.div>
  )
}
