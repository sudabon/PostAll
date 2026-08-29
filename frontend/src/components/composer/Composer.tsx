import { CirclePlus, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { usePlatform, type PickedFile } from '@/platform'
import { useUi } from '@/state/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { isInsideUnclosedFence } from '@/lib/fence'
import { isTouchDevice } from '@/lib/viewport'
import { applyFormat, type FormatAction } from '@/lib/markdown-format'
import { FormatToolbar } from './FormatToolbar'
import { ACCEPT_ATTR, checkAttachment, formatBytes, inferMime, isImageType } from '@/lib/attachments'

type DraftFile = {
  key: string
  file: PickedFile
  progress: number
  status: 'uploading' | 'ready' | 'error'
  id?: string
  preview?: string
  error?: string
}

export function Composer({
  storageKey,
  disabled,
  mutationDisabled = false,
  onSubmit,
  uploadFile,
  placeholder = 'メッセージを入力',
}: {
  storageKey: string
  disabled?: boolean
  mutationDisabled?: boolean
  onSubmit: (body: string, attachmentIds: string[]) => Promise<void>
  uploadFile?: (file: PickedFile, onProgress: (ratio: number) => void) => Promise<string>
  placeholder?: string
}) {
  const platform = usePlatform()
  const epoch = useUi((s) => s.composerEpoch)
  const [value, setValue] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [drafts, setDraftState] = useState<DraftFile[]>([])
  const draftsRef = useRef<DraftFile[]>([])
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const lastEpoch = useRef<number | null>(null)
  const [loaded, setLoaded] = useState(false)

  const replaceDrafts = (next: DraftFile[]) => {
    draftsRef.current = next
    setDraftState(next)
  }

  const updateDrafts = (update: (current: DraftFile[]) => DraftFile[]) => {
    replaceDrafts(update(draftsRef.current))
  }

  useEffect(() => {
    let cancelled = false
    void platform.getItem(storageKey).then((raw) => {
      if (cancelled) return
      if (raw) setValue(raw)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [platform, storageKey])

  useEffect(() => {
    if (!loaded) return
    void platform.setItem(storageKey, value)
  }, [loaded, platform, storageKey, value])

  useEffect(() => {
    const el = area.current
    if (!el) return
    // タッチ端末ではマウント時に自動フォーカスしない。ソフトキーボードが立ち上がって
    // タイムラインを覆い、最初のタップがキーボードを閉じるだけで消費されてしまう
    // （「スレッドで返信」を押しても何も起きないように見える）。
    // メニューや Cmd+L による明示的なフォーカス（epoch 更新）は従来どおり効かせる。
    // epoch が実際に変わったときだけ「明示的なフォーカス要求」とみなす。
    // 初回マウント時の実行（StrictMode の二重実行を含む）は epoch が動かないので
    // タッチ端末では何もしない。
    const requested = lastEpoch.current !== null && lastEpoch.current !== epoch
    lastEpoch.current = epoch
    if (!requested && isTouchDevice()) return
    el.focus()
    el.selectionStart = el.value.length
  }, [epoch])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const uploading = drafts.some((d) => d.status === 'uploading')
  const readyIds = drafts.filter((d) => d.status === 'ready' && d.id).map((d) => d.id!)
  const canSend = !disabled && !mutationDisabled && !sending && !uploading && (Boolean(value.trim()) || readyIds.length > 0)

  const runUpload = (key: string, file: PickedFile) => {
    if (mutationDisabled) {
      updateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'error', error: '接続回復後に再試行してください' } : d)))
      return
    }
    if (!uploadFile) {
      updateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'error', error: 'アップロードできません' } : d)))
      return
    }
    updateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'uploading', error: undefined, progress: 0 } : d)))
    void uploadFile(file, (ratio) => {
      updateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, progress: ratio } : d)))
    })
      .then((id) => {
        updateDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'ready', id, progress: 1 } : d)))
      })
      .catch(() => {
        updateDrafts((ds) =>
          ds.map((d) => (d.key === key ? { ...d, status: 'error', error: 'アップロードに失敗しました' } : d)),
        )
      })
  }

  const addPicked = (picked: PickedFile[]) => {
    if (mutationDisabled) {
      setError('接続されていないため添付をアップロードできません')
      return
    }
    const next = [...draftsRef.current]
    const uploads: { key: string; file: PickedFile }[] = []
    let nextError: string | null = null
    for (const file of picked) {
      const type = inferMime(file.name, file.type)
      const typed = { ...file, type }
      const check = checkAttachment({ type, size: typed.data.byteLength }, next.length)
      if (!check.ok) {
        nextError = check.message
        continue
      }
      const key = crypto.randomUUID()
      const preview =
        isImageType(type) && typeof URL.createObjectURL === 'function'
          ? URL.createObjectURL(new Blob([typed.data], { type }))
          : undefined
      next.push({ key, file: typed, progress: 0, status: 'uploading', preview })
      uploads.push({ key, file: typed })
    }
    setError(nextError)
    replaceDrafts(next)
    for (const upload of uploads) {
      runUpload(upload.key, upload.file)
    }
  }

  const removeDraft = (key: string) => {
    const target = draftsRef.current.find((d) => d.key === key)
    if (target?.preview) URL.revokeObjectURL(target.preview)
    replaceDrafts(draftsRef.current.filter((d) => d.key !== key))
  }

  const submit = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    const snapshot = value
    try {
      await onSubmit(value, readyIds)
      setValue('')
      draftsRef.current.forEach((d) => {
        if (d.preview) URL.revokeObjectURL(d.preview)
      })
      replaceDrafts([])
      await platform.removeItem(storageKey)
    } catch {
      setValue(snapshot)
      setError('送信に失敗しました。入力は保持されています。')
    } finally {
      setSending(false)
    }
  }

  const runFormat = (action: FormatAction) => {
    const el = area.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    const next = applyFormat(action, value, start, end)
    setValue(next.value)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(next.selectionStart, next.selectionEnd)
    })
  }

  return (
    <form
      // 左右のパディングは shell-composer が safe-area 込みで持つ
      className={cn('material-regular relative z-10 rounded-t-xl py-3 shadow-sm transition-[background-color,box-shadow] shell-composer', dragging && 'bg-accent/60 shadow-md')}
      data-testid={storageKey.startsWith('draft:thread') ? 'thread-composer' : 'composer'}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        if (disabled || mutationDisabled || sending) return
        void platform.ingestFiles([...e.dataTransfer.files]).then(addPicked)
      }}
    >
      <div
        className={cn(
          'rounded-xl border border-input bg-background shadow-sm focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring',
          disabled && 'shadow-none',
        )}
      >
        <FormatToolbar disabled={disabled || sending} onAction={runFormat} />
        <textarea
          ref={area}
          data-testid="composer-input"
          disabled={disabled || sending}
          className={cn(
            'max-h-[200px] min-h-11 w-full resize-none bg-transparent px-3 py-2 text-body outline-none',
            disabled && 'text-disabled-foreground',
          )}
          placeholder={disabled ? 'チャネルを選択してください' : placeholder}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onPaste={(e) => {
            const files = [...e.clipboardData.files]
            if (files.length === 0) return
            e.preventDefault()
            if (mutationDisabled) {
              setError('接続されていないため添付をアップロードできません')
              return
            }
            void platform.ingestFiles(files).then(addPicked)
          }}
          onKeyDown={(e) => {
            // Enter は改行、送信は Shift+Enter
            if (e.key !== 'Enter' || !e.shiftKey) return
            // IME 変換中（変換候補の確定 Enter）は送信しない
            if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
            const pos = e.currentTarget.selectionStart ?? value.length
            if (isInsideUnclosedFence(value, pos)) return
            e.preventDefault()
            void submit()
          }}
        />
        {drafts.length > 0 ? (
          <ul className="space-y-1 px-2 pb-1">
            {drafts.map((d) => (
              <li key={d.key} className="flex items-center gap-2 rounded-lg border border-border bg-card px-2 py-1 text-caption shadow-sm">
                {d.preview ? <img src={d.preview} alt="" className="h-8 w-8 rounded-lg object-cover" /> : null}
                <span className="min-w-0 flex-1 truncate">{d.file.name}</span>
                <span className="text-muted-foreground">{formatBytes(d.file.data.byteLength)}</span>
                {d.status === 'uploading' ? <span>{Math.round(d.progress * 100)}%</span> : null}
                {d.status === 'error' ? <span className="text-destructive">{d.error}</span> : null}
                {d.status === 'error' ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-caption" disabled={mutationDisabled} onClick={() => runUpload(d.key, d.file)}>
                    再試行
                  </Button>
                ) : null}
                <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-caption" onClick={() => removeDraft(d.key)}>
                  除去
                </Button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-center justify-between gap-2 px-2 pb-2">
          <div className="flex min-w-0 items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              data-testid="composer-attach"
              className="size-9 text-muted-foreground"
              aria-label="添付"
              title="添付"
              disabled={disabled || mutationDisabled || sending}
              onClick={() => {
                void platform.pickFiles({ multiple: true, accept: ACCEPT_ATTR }).then(addPicked)
              }}
            >
              <CirclePlus className="size-5" />
            </Button>
            {error ? <p className="min-w-0 text-caption text-destructive">{error}</p> : null}
          </div>
          <Button type="submit" size="icon" className="size-9" aria-label="送信" title="送信 (Shift+Enter)" disabled={!canSend}>
            <Send className="size-4" />
          </Button>
        </div>
      </div>
    </form>
  )
}
