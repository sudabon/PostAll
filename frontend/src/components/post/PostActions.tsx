import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { Post } from '@/api/client'

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
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLTextAreaElement>(null)
  const titleId = useId()
  const bodyId = useId()
  const attachments = post.attachments ?? []
  const summary = post.body.trim().slice(0, 30) || attachments[0]?.fileName || post.id

  const close = useCallback(() => {
    setEditing(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!editing) return
    requestAnimationFrame(() => bodyRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), textarea:not([disabled]), input:not([disabled])',
      )
      if (!controls?.length) return
      const first = controls[0]!
      const last = controls[controls.length - 1]!
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [close, editing])

  const openEditor = () => {
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
      <div className="absolute right-2 top-2 flex gap-2 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
        <button
          ref={triggerRef}
          type="button"
          className="text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${kind}を編集: ${summary}`}
          aria-haspopup="dialog"
          aria-expanded={editing}
          disabled={mutationDisabled}
          onClick={openEditor}
        >
          編集
        </button>
        <button
          type="button"
          className="text-xs text-destructive focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          aria-label={`${kind}を削除: ${summary}`}
          disabled={mutationDisabled}
          onClick={() => {
            if (window.confirm(`この${kind}を削除しますか？`)) onDelete()
          }}
        >
          削除
        </button>
      </div>
      {editing
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close()
              }}
            >
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-lg rounded-lg border border-border bg-popover p-4 text-popover-foreground shadow-xl"
              >
                <h3 id={titleId} className="text-base font-semibold">
                  {kind}を編集
                </h3>
                <label htmlFor={bodyId} className="mt-3 block text-sm font-medium">
                  本文
                </label>
                <textarea
                  ref={bodyRef}
                  id={bodyId}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  className="mt-1 min-h-32 w-full resize-y rounded-md border border-input bg-background px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                />
                {attachments.length > 0 ? (
                  <fieldset className="mt-3 rounded-md border border-border p-3">
                    <legend className="px-1 text-sm font-medium">残す添付</legend>
                    <div className="space-y-2">
                      {attachments.map((attachment) => (
                        <label key={attachment.id} className="flex items-center gap-2 text-sm">
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
                {error ? <p role="alert" className="mt-2 text-sm text-destructive">{error}</p> : null}
                <div className="mt-4 flex justify-end gap-2">
                  <button type="button" className="rounded-md border border-border px-3 py-2 text-sm" onClick={close}>
                    キャンセル
                  </button>
                  <button type="button" className="rounded-md bg-primary px-3 py-2 text-sm text-primary-foreground" onClick={save}>
                    保存
                  </button>
                </div>
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
