import { useEffect, useRef, useState } from 'react'
import { usePlatform, type PickedFile } from '@/platform'
import { useUi } from '@/state/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { insertCodeFence, isInsideUnclosedFence } from '@/lib/fence'
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
  const [drafts, setDrafts] = useState<DraftFile[]>([])
  const [dragging, setDragging] = useState(false)
  const area = useRef<HTMLTextAreaElement>(null)
  const [loaded, setLoaded] = useState(false)

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
      setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'error', error: '接続回復後に再試行してください' } : d)))
      return
    }
    if (!uploadFile) {
      setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'error', error: 'アップロードできません' } : d)))
      return
    }
    setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'uploading', error: undefined, progress: 0 } : d)))
    void uploadFile(file, (ratio) => {
      setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, progress: ratio } : d)))
    })
      .then((id) => {
        setDrafts((ds) => ds.map((d) => (d.key === key ? { ...d, status: 'ready', id, progress: 1 } : d)))
      })
      .catch(() => {
        setDrafts((ds) =>
          ds.map((d) => (d.key === key ? { ...d, status: 'error', error: 'アップロードに失敗しました' } : d)),
        )
      })
  }

  const addPicked = (picked: PickedFile[]) => {
    if (mutationDisabled) {
      setError('接続されていないため添付をアップロードできません')
      return
    }
    setError(null)
    setDrafts((curr) => {
      const next = [...curr]
      for (const file of picked) {
        const type = inferMime(file.name, file.type)
        const typed = { ...file, type }
        const check = checkAttachment({ type, size: typed.data.byteLength }, next.length)
        if (!check.ok) {
          setError(check.message)
          continue
        }
        const key = crypto.randomUUID()
        const preview =
          isImageType(type) && typeof URL.createObjectURL === 'function'
            ? URL.createObjectURL(new Blob([typed.data], { type }))
            : undefined
        next.push({ key, file: typed, progress: 0, status: 'uploading', preview })
        runUpload(key, typed)
      }
      return next
    })
  }

  const removeDraft = (key: string) => {
    setDrafts((ds) => {
      const target = ds.find((d) => d.key === key)
      if (target?.preview) URL.revokeObjectURL(target.preview)
      return ds.filter((d) => d.key !== key)
    })
  }

  const submit = async () => {
    if (!canSend) return
    setSending(true)
    setError(null)
    const snapshot = value
    try {
      await onSubmit(value, readyIds)
      setValue('')
      drafts.forEach((d) => {
        if (d.preview) URL.revokeObjectURL(d.preview)
      })
      setDrafts([])
      await platform.removeItem(storageKey)
    } catch {
      setValue(snapshot)
      setError('送信に失敗しました。入力は保持されています。')
    } finally {
      setSending(false)
    }
  }

  const insertCode = () => {
    const el = area.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    const next = insertCodeFence(value, start, end)
    setValue(next.value)
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(next.cursor, next.cursor)
    })
  }

  return (
    <form
      className={cn('border-t border-border bg-background p-3', dragging && 'bg-accent/40')}
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
      <textarea
        ref={area}
        data-testid="composer-input"
        disabled={disabled || sending}
        className={cn(
          'max-h-[200px] min-h-[44px] w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm',
          disabled && 'opacity-50',
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
          if (e.key === 'Enter' && !e.shiftKey) {
            const pos = e.currentTarget.selectionStart ?? value.length
            if (isInsideUnclosedFence(value, pos)) return
            e.preventDefault()
            void submit()
          }
        }}
      />
      {drafts.length > 0 ? (
        <ul className="mt-2 space-y-1">
          {drafts.map((d) => (
            <li key={d.key} className="flex items-center gap-2 rounded-md border border-border px-2 py-1 text-xs">
              {d.preview ? <img src={d.preview} alt="" className="h-8 w-8 rounded object-cover" /> : null}
              <span className="min-w-0 flex-1 truncate">{d.file.name}</span>
              <span className="text-muted-foreground">{formatBytes(d.file.data.byteLength)}</span>
              {d.status === 'uploading' ? <span>{Math.round(d.progress * 100)}%</span> : null}
              {d.status === 'error' ? <span className="text-destructive">{d.error}</span> : null}
              {d.status === 'error' ? (
                <button type="button" disabled={mutationDisabled} onClick={() => runUpload(d.key, d.file)}>
                  再試行
                </button>
              ) : null}
              <button type="button" onClick={() => removeDraft(d.key)}>
                除去
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <div className="mt-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <button
            type="button"
            data-testid="composer-code"
            className="text-xs text-muted-foreground"
            disabled={disabled || sending}
            onClick={insertCode}
          >
            コード
          </button>
          <button
            type="button"
            data-testid="composer-attach"
            className="text-xs text-muted-foreground"
            disabled={disabled || mutationDisabled || sending}
            onClick={() => {
              void platform.pickFiles({ multiple: true, accept: ACCEPT_ATTR }).then(addPicked)
            }}
          >
            添付
          </button>
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <Button type="submit" size="sm" disabled={!canSend}>
          送信
        </Button>
      </div>
    </form>
  )
}
