import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import { Search, SmilePlus, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Emoji } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { useOverlayPresence } from '@/lib/motion/useOverlayPresence'
import { EmojiImage } from './EmojiImage'

export function EmojiPicker({ onSelect, disabled = false }: { onSelect: (emoji: Emoji) => void; disabled?: boolean }) {
  const { api, signedIn } = useAuth()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const restoreFocus = useRef(false)
  const titleId = useId()
  const close = useCallback(() => setOpen(false), [])
  const {
    dialogRef,
    shouldRender,
    isPresent,
    onCancel,
    onExitComplete,
    motionProps,
  } = useOverlayPresence({ open, onClose: close })
  const catalog = useQuery({
    queryKey: ['emojis'],
    enabled: open && signedIn,
    queryFn: () => api.listEmojis(),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!disabled) return
    const frame = requestAnimationFrame(close)
    return () => cancelAnimationFrame(frame)
  }, [close, disabled])

  useEffect(() => {
    if (!open) return
    const frame = requestAnimationFrame(() => searchRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [open])

  useEffect(() => {
    if (shouldRender || !restoreFocus.current) return
    restoreFocus.current = false
    const frame = requestAnimationFrame(() => triggerRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [shouldRender])

  const emojis = catalog.data ?? []
  const normalizedFilter = filter.trim().toLocaleLowerCase()
  const filtered = normalizedFilter
    ? emojis.filter((emoji) => emoji.shortcode.toLocaleLowerCase().includes(normalizedFilter))
    : emojis

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        aria-label="リアクションを追加"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          restoreFocus.current = true
          setFilter('')
          setOpen(true)
        }}
      >
        <SmilePlus aria-hidden="true" size={16} />
      </button>
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
                key="emoji-overlay"
                {...motionProps.backdrop}
                className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/25 p-4"
                onMouseDown={(event) => {
                  if (event.target === event.currentTarget) close()
                }}
              >
                <m.div
                  {...motionProps.surface}
                  className="material-regular w-full max-w-sm rounded-xl border border-border p-3 text-foreground shadow-lg"
                >
                  <div className="mb-3 flex items-center justify-between">
                    <h3 id={titleId} className="text-title font-semibold">
                      リアクションを追加
                    </h3>
                    <button
                      type="button"
                      aria-label="絵文字ピッカーを閉じる"
                      className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      onClick={close}
                    >
                      <X aria-hidden="true" size={16} />
                    </button>
                  </div>
                  <label className="relative block">
                    <span className="sr-only">ショートコードで絞り込み</span>
                    <Search
                      aria-hidden="true"
                      size={15}
                      className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                    />
                    <input
                      ref={searchRef}
                      autoFocus
                      type="search"
                      value={filter}
                      onChange={(event) => setFilter(event.target.value)}
                      className="w-full rounded-lg border border-input bg-background py-2 pl-8 pr-3 text-body outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                      placeholder="ショートコードを検索"
                    />
                  </label>
                  <div className="mt-3 max-h-64 overflow-y-auto" aria-live="polite">
                    {catalog.isLoading ? (
                      <p className="py-6 text-center text-body text-muted-foreground">読み込み中…</p>
                    ) : null}
                    {catalog.isError ? (
                      <p className="py-6 text-center text-body text-destructive">絵文字を読み込めませんでした</p>
                    ) : null}
                    {!catalog.isLoading && !catalog.isError && emojis.length === 0 ? (
                      <p className="py-6 text-center text-body text-muted-foreground">
                        絵文字はまだ登録されていません
                      </p>
                    ) : null}
                    {!catalog.isLoading && !catalog.isError && emojis.length > 0 && filtered.length === 0 ? (
                      <p className="py-6 text-center text-body text-muted-foreground">
                        一致する絵文字がありません
                      </p>
                    ) : null}
                    {filtered.length > 0 ? (
                      <div className="grid grid-cols-3 gap-1">
                        {filtered.map((emoji) => (
                          <button
                            key={emoji.id}
                            type="button"
                            disabled={disabled}
                            className="flex min-w-0 flex-col items-center gap-1 rounded-lg p-2 text-caption hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                            onClick={() => {
                              onSelect(emoji)
                              close()
                            }}
                          >
                            <EmojiImage
                              emoji={emoji}
                              decorative
                              className="h-7 w-7"
                              fallbackClassName="h-7 w-7"
                            />
                            <span className="max-w-full truncate">:{emoji.shortcode}:</span>
                          </button>
                        ))}
                      </div>
                    ) : null}
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
