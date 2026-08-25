import { useCallback, useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Search, SmilePlus, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import type { Emoji } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import { EmojiImage } from './EmojiImage'

export function EmojiPicker({ onSelect, disabled = false }: { onSelect: (emoji: Emoji) => void; disabled?: boolean }) {
  const { api, signedIn } = useAuth()
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dialogRef = useRef<HTMLDivElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const titleId = useId()
  const catalog = useQuery({
    queryKey: ['emojis'],
    enabled: open && signedIn,
    queryFn: () => api.listEmojis(),
    staleTime: 5 * 60 * 1000,
  })

  useEffect(() => {
    if (!disabled) return
    const frame = requestAnimationFrame(() => setOpen(false))
    return () => cancelAnimationFrame(frame)
  }, [disabled])

  const close = useCallback(() => {
    setOpen(false)
    requestAnimationFrame(() => triggerRef.current?.focus())
  }, [])

  useEffect(() => {
    if (!open) return
    requestAnimationFrame(() => searchRef.current?.focus())
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
        return
      }
      if (event.key !== 'Tab') return
      const controls = dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled])',
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
  }, [close, open])

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
        className="inline-flex h-7 w-7 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        aria-label="リアクションを追加"
        aria-haspopup="dialog"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => {
          setFilter('')
          setOpen(true)
        }}
      >
        <SmilePlus aria-hidden="true" size={16} />
      </button>
      {open
        ? createPortal(
            <div
              className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 p-4"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) close()
              }}
            >
              <div
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                className="w-full max-w-sm rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-xl"
              >
                <div className="mb-3 flex items-center justify-between">
                  <h3 id={titleId} className="text-sm font-semibold">
                    リアクションを追加
                  </h3>
                  <button
                    type="button"
                    aria-label="絵文字ピッカーを閉じる"
                    className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
                    type="search"
                    value={filter}
                    onChange={(event) => setFilter(event.target.value)}
                    className="w-full rounded-md border border-input bg-background py-2 pl-8 pr-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    placeholder="ショートコードを検索"
                  />
                </label>
                <div className="mt-3 max-h-64 overflow-y-auto" aria-live="polite">
                  {catalog.isLoading ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">読み込み中…</p>
                  ) : null}
                  {catalog.isError ? (
                    <p className="py-6 text-center text-sm text-destructive">絵文字を読み込めませんでした</p>
                  ) : null}
                  {!catalog.isLoading && !catalog.isError && emojis.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                      絵文字はまだ登録されていません
                    </p>
                  ) : null}
                  {!catalog.isLoading && !catalog.isError && emojis.length > 0 && filtered.length === 0 ? (
                    <p className="py-6 text-center text-sm text-muted-foreground">
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
                          className="flex min-w-0 flex-col items-center gap-1 rounded-md p-2 text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
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
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  )
}
