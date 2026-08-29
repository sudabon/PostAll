import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, m, useReducedMotion } from 'motion/react'
import { Pencil, Trash2 } from 'lucide-react'
import type { Post } from '@/api/client'
import { Button } from '@/components/ui/button'
import { useOverlayPresence } from '@/lib/motion/useOverlayPresence'
import { springPresets } from '@/lib/motion/springs'
import { cn } from '@/lib/utils'

export function PostActions({
  post,
  kind,
  mutationDisabled,
  onEdit,
  onDelete,
}: {
  post: Post
  kind: 'ポスト' | '返信'
  mutationDisabled: boolean
  onEdit: (body: string, attachmentIds: string[]) => void
  onDelete: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [body, setBody] = useState(post.body)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const [revealed, setRevealed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const restoreFocus = useRef(false)
  const titleId = useId()
  const bodyId = useId()
  const attachments = post.attachments ?? []
  const summary = post.body.trim().slice(0, 30) || attachments[0]?.fileName || post.id
  const shouldReduceMotion = useReducedMotion()
  const close = useCallback(() => setEditing(false), [])
  const {
    dialogRef,
    shouldRender,
    isPresent,
    onCancel,
    onExitComplete,
    motionProps,
  } = useOverlayPresence({ open: editing, onClose: close })

  useEffect(() => {
    if (!editing) return
    const frame = requestAnimationFrame(() => bodyRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [editing])

  useEffect(() => {
    if (shouldRender || !restoreFocus.current) return
    restoreFocus.current = false
    const frame = requestAnimationFrame(() => triggerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [shouldRender])

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

  const openEditor = () => {
    restoreFocus.current = true
    setBody(post.body)
    setSelectedIds(new Set(attachments.map((attachment) => attachment.id)))
    setError(null)
    setEditing(true)
  }

  const save = () => {
    const attachmentIds = attachments
      .filter((attachment) => selectedIds.has(attachment.id))
      .map((attachment) => attachment.id)
    if (!body.trim() && attachmentIds.length === 0) {
      setError('本文または添付のいずれかが必要です')
      return
    }
    onEdit(body, attachmentIds)
    close()
  }

  return (
    <>
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
          aria-haspopup="dialog"
          aria-expanded={editing}
          disabled={mutationDisabled}
          onClick={openEditor}
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
      {shouldRender ? (
        <dialog
          ref={dialogRef}
          className="m-auto h-dvh max-h-none w-dvw max-w-none overflow-visible border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent"
          aria-labelledby={titleId}
          onCancel={onCancel}
        >
          <AnimatePresence onExitComplete={onExitComplete}>
            {isPresent ? (
              <m.div
                key="post-editor-overlay"
                {...motionProps.backdrop}
                className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) close()
                }}
              >
                <m.div
                  {...motionProps.surface}
                  className="material-regular w-full max-w-lg rounded-xl border border-border p-4 text-foreground shadow-lg"
                >
                  <h3 id={titleId} className="text-title font-semibold">
                    {kind}を編集
                  </h3>
                  <label htmlFor={bodyId} className="mt-3 block text-body font-medium">
                    本文
                  </label>
                  <textarea
                    ref={bodyRef}
                    autoFocus
                    id={bodyId}
                    value={body}
                    onChange={(event) => setBody(event.target.value)}
                    className="mt-1 min-h-32 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                  />
                  {attachments.length > 0 ? (
                    <fieldset className="mt-3 rounded-lg border border-border p-3">
                      <legend className="px-1 text-body font-medium">残す添付</legend>
                      <div className="space-y-2">
                        {attachments.map((attachment) => (
                          <label key={attachment.id} className="flex items-center gap-2 text-body">
                            <input
                              type="checkbox"
                              checked={selectedIds.has(attachment.id)}
                              onChange={(event) => {
                                const next = new Set(selectedIds)
                                if (event.target.checked) next.add(attachment.id)
                                else next.delete(attachment.id)
                                setSelectedIds(next)
                              }}
                            />
                            <span className="min-w-0 truncate">{attachment.fileName}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                  {error ? <p role="alert" className="mt-2 text-body text-destructive">{error}</p> : null}
                  <div className="mt-4 flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={close}>
                      キャンセル
                    </Button>
                    <Button type="button" onClick={save}>
                      保存
                    </Button>
                  </div>
                </m.div>
              </m.div>
            ) : null}
          </AnimatePresence>
        </dialog>
      ) : null}
    </>
  )
}
