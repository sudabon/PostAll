import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import type { Channel, SearchInput, SearchResult, SearchResultPage } from '@/api/client'
import { useSearch } from '@/hooks/useSearch'
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
  const dialog = useRef<HTMLDialogElement>(null)
  const [query, setQuery] = useState('')
  const [channelId, setChannelId] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [validation, setValidation] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState<Omit<SearchInput, 'cursor'> | null>(null)
  const result = useSearch(submitted, search)

  useEffect(() => {
    const el = dialog.current
    if (!el) return
    if (open && !el.open) el.showModal()
    if (!open && el.open) el.close()
  }, [open])

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

  return (
    <dialog
      ref={dialog}
      className="m-auto max-h-[80vh] w-[min(44rem,calc(100vw-2rem))] rounded-lg border border-border bg-background p-0 text-foreground shadow-xl backdrop:bg-black/40"
      aria-labelledby="search-title"
      onCancel={(event) => {
        event.preventDefault()
        onClose()
      }}
    >
      <div className="flex max-h-[80vh] flex-col">
        <header className="flex items-center justify-between border-b border-border px-5 py-4">
          <h2 id="search-title" className="text-lg font-semibold">ポストを検索</h2>
          <button type="button" className="rounded px-2 py-1 text-sm focus-visible:ring-2 focus-visible:ring-ring" onClick={onClose}>
            閉じる
          </button>
        </header>
        <form
          role="search"
          action="/v1/search"
          method="get"
          className="grid gap-3 border-b border-border px-5 py-4 sm:grid-cols-2"
          onSubmit={submit}
        >
            <label className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">検索語</span>
              <input
                autoFocus
                type="search"
                name="q"
                data-testid="search-input"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2"
                value={query}
                aria-describedby={validation ? 'search-validation' : undefined}
                onChange={(event) => {
                  setQuery(event.target.value)
                  if (validation) setValidation(null)
                }}
              />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1 block text-sm font-medium">チャネル</span>
              <select
                name="channelId"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2"
                value={channelId}
                onChange={(event) => setChannelId(event.target.value)}
              >
                <option value="">すべてのチャネル</option>
                {channels.map((channel) => <option key={channel.id} value={channel.id}>{channel.name}</option>)}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">開始日</span>
              <input
                type="date"
                name="createdFrom"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2"
                value={createdFrom}
                onChange={(event) => setCreatedFrom(event.target.value)}
              />
            </label>
            <label>
              <span className="mb-1 block text-sm font-medium">終了日</span>
              <input
                type="date"
                name="createdTo"
                className="min-h-11 w-full rounded-md border border-input bg-background px-3 py-2"
                value={createdTo}
                onChange={(event) => setCreatedTo(event.target.value)}
              />
            </label>
            <div className="flex items-center justify-between gap-3 sm:col-span-2">
              <p id="search-validation" className="text-sm text-destructive" aria-live="polite">{validation}</p>
              <button type="submit" className="min-h-11 rounded-md bg-primary px-4 py-2 text-primary-foreground">
                検索
              </button>
            </div>
        </form>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <p className="mb-3 text-sm text-muted-foreground" aria-live="polite">{summary}</p>
          {result.isPending && submitted ? <p className="text-sm text-muted-foreground">検索中…</p> : null}
          {result.isError ? <p role="alert" className="text-sm text-destructive">検索に失敗しました</p> : null}
          <ol className="space-y-2">
            {results.map((item) => (
              <li key={item.postId}>
                <SearchResultButton result={item} query={submitted?.query ?? ''} onSelect={onSelect} />
              </li>
            ))}
          </ol>
          {result.hasNextPage ? (
            <button
              type="button"
              className="mt-4 min-h-11 w-full rounded-md border border-border px-3 py-2"
              disabled={result.isFetchingNextPage}
              onClick={() => void result.fetchNextPage()}
            >
              {result.isFetchingNextPage ? '読み込み中…' : 'さらに読み込む'}
            </button>
          ) : null}
        </div>
      </div>
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
      className="w-full rounded-md border border-border px-3 py-3 text-left hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
      onClick={() => onSelect(result)}
    >
      <span className="mb-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
        <span># {result.channelName}</span>
        <time dateTime={result.createdAt}>{new Date(result.createdAt).toLocaleString('ja-JP')}</time>
        {result.threadRootId ? <span>スレッド返信</span> : null}
      </span>
      <span className="block text-sm leading-6">
        {excerpt.clippedStart ? '…' : ''}
        {excerpt.parts.map((part, index) =>
          part.match ? <mark key={index} className="rounded-sm bg-yellow-200 text-black">{part.text}</mark> : part.text,
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
