import { useMemo, useRef, useState, type FormEvent } from 'react'
import { AnimatePresence, m } from 'motion/react'
import type { Channel, SearchInput, SearchResult, SearchResultPage } from '@/api/client'
import { Button } from '@/components/ui/button'
import { useSearch } from '@/hooks/useSearch'
import { useOverlayPresence } from '@/lib/motion/useOverlayPresence'
import { buildExcerpt } from '@/lib/search'

export function SearchDialog({
  open,
  channels,
  search,
  onClose,
  onSelect,
}: {
  open: boolean
  channels: Channel[]
  search: (input: SearchInput) => Promise<SearchResultPage>
  onClose: () => void
  onSelect: (result: SearchResult) => void
}) {
  const [query, setQuery] = useState('')
  const [channelId, setChannelId] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<Omit<SearchInput, 'cursor'> | null>(null)
  const pendingSelection = useRef<SearchResult | null>(null)
  const result = useSearch(submitted, search)
  const {
    dialogRef,
    shouldRender,
    isPresent,
    onCancel,
    onExitComplete,
    motionProps,
  } = useOverlayPresence({ open, onClose })

  const results = useMemo(() => {
    const seen = new Set<string>()
    const items: SearchResult[] = []
    for (const page of result.data?.pages ?? []) {
      for (const item of page.results) {
        if (seen.has(item.postId)) continue
        seen.add(item.postId)
        items.push(item)
      }
    }
    return items
  }, [result.data?.pages])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const normalized = query.trim()
    if (Array.from(normalized).length < 2) {
      setValidation('検索語は2文字以上で入力してください')
      setSubmitted(null)
      return
    }
    setValidation(null)
    setSubmitted({
      query: normalized,
      channelId: channelId || undefined,
      createdFrom: startOfDay(createdFrom),
      createdTo: endOfDay(createdTo),
      limit: 20,
    })
  }

  const completed = submitted !== null && !result.isPending && !result.isFetching
  const summary = completed
    ? results.length === 0
      ? '一致するポストはありません'
      : `${results.length}件の検索結果`
    : ''

  if (!shouldRender) return null

  const completeExit = () => {
    if (!onExitComplete()) return
    const selection = pendingSelection.current
    pendingSelection.current = null
    if (selection) requestAnimationFrame(() => onSelect(selection))
  }

  const selectResult = (selection: SearchResult) => {
    pendingSelection.current = selection
    onClose()
  }

  return (
    <dialog
      ref={dialogRef}
      className="m-auto h-dvh max-h-none w-dvw max-w-none overflow-visible border-0 bg-transparent p-0 text-foreground backdrop:bg-transparent"
      aria-labelledby="search-title"
      onCancel={onCancel}
    >
      <AnimatePresence onExitComplete={completeExit}>
        {isPresent ? (
          <m.div
            key="search-overlay"
            {...motionProps.backdrop}
            className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/30 p-4"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) onClose()
            }}
          >
            <m.div
              {...motionProps.surface}
              className="material-thick flex max-h-[80vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border border-border text-foreground shadow-lg"
            >
              <header className="flex items-center justify-between px-5 py-4">
                <h2 id="search-title" className="text-heading font-semibold">ポストを検索</h2>
                <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                  閉じる
                </Button>
              </header>
              <form
                role="search"
                action="/v1/search"
                method="get"
                className="grid gap-3 border-y border-border px-5 py-4 sm:grid-cols-2"
                onSubmit={submit}
              >
            <label className="sm:col-span-2">
              <span className="mb-1 block text-body font-medium">検索語</span>
              <input
                autoFocus
                type="search"
                name="q"
                data-testid="search-input"
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                value={query}
                aria-describedby={validation ? 'search-validation' : undefined}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (validation) setValidation(null)
                }}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-body font-medium">チャネル</span>
              <select
                name="channelId"
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
              >
                <option value="">すべてのチャネル</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-body font-medium">開始日</span>
              <input
                type="date"
                name="createdFrom"
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-body font-medium">終了日</span>
              <input
                type="date"
                name="createdTo"
                className="min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-body focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.target.value)}
              />
            </label>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <p id="search-validation" className="text-body text-destructive" aria-live="polite">{validation}</p>
              <Button type="submit" className="min-h-11">
                検索
              </Button>
            </div>
              </form>
              <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
                <p className="mb-3 text-body text-muted-foreground" aria-live="polite">{summary}</p>
                {result.isPending && submitted ? <p className="text-body text-muted-foreground">検索中…</p> : null}
                {result.isError ? <p role="alert" className="text-body text-destructive">検索に失敗しました</p> : null}
                <ol className="space-y-2">
                  {results.map((item) => (
                    <li key={item.postId}>
                      <SearchResultButton result={item} query={submitted?.query ?? ''} onSelect={selectResult} />
                    </li>
                  ))}
                </ol>
                {result.hasNextPage ? (
                  <Button
                    type="button"
                    variant="outline"
                    className="mt-4 min-h-11 w-full"
                    disabled={result.isFetchingNextPage}
                    onClick={() => void result.fetchNextPage()}
                  >
                    {result.isFetchingNextPage ? '読み込み中…' : 'さらに読み込む'}
                  </Button>
                ) : null}
              </div>
            </m.div>
          </m.div>
        ) : null}
      </AnimatePresence>
    </dialog>
  )
}

function SearchResultButton({
  result,
  query,
  onSelect,
}: {
  result: SearchResult
  query: string
  onSelect: (result: SearchResult) => void
}) {
  const excerpt = buildExcerpt(result.body, query)
  return (
    <button
      type="button"
      className="w-full rounded-lg border border-border px-3 py-3 text-left shadow-sm hover:bg-accent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      onClick={() => onSelect(result)}
    >
      <span className="mb-1 flex flex-wrap items-center gap-x-2 text-caption text-muted-foreground">
        <span># {result.channelName}</span>
        <time dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString('ja-JP')}</time>
        {result.threadRootId ? <span>スレッド返信</span> : null}
      </span>
      <span className="block text-body">
        {excerpt.clippedStart ? '…' : ''}
        {excerpt.parts.map((part, index) =>
          part.match ? <mark key={index} className="rounded-sm bg-warning text-warning-foreground">{part.text}</mark> : part.text,
        )}
        {excerpt.clippedEnd ? '…' : ''}
      </span>
    </button>
  )
}

function startOfDay(value: string): string | undefined {
  if (!value) return undefined
  return new Date(`${value}T00:00:00`).toISOString()
}

function endOfDay(value: string): string | undefined {
  if (!value) return undefined
  return new Date(`${value}T23:59:59.999`).toISOString()
}
