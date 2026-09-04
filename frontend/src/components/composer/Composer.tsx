import { CirclePlus, Send } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import type { Attachment } from '@/api/client'
import { usePlatform, type PickedFile } from '@/platform'
import { useUi } from '@/state/ui'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { expandFenceTrigger, isInsideUnclosedFence } from '@/lib/fence'
import { isTouchDevice } from '@/lib/viewport'
import { applyFormat, indentLines, type FormatAction } from '@/lib/markdown-format'
import { submitFailureMessage } from '@/lib/submit-failure'
import { FormatToolbar } from './FormatToolbar'
import { ACCEPT_ATTR, checkAttachment, formatBytes, inferMime, isImageType } from '@/lib/attachments'

type DraftFile = {
  key: string
  name: string
  size: number
  contentType: string
  // 新規に選ばれた添付だけがバイト列を持つ。既存添付は名前・サイズ・id しか持たない。
  file?: PickedFile
  progress: number
  status: 'uploading' | 'ready' | 'error'
  id?: string
  // 新規添付の objectURL。既存添付のサムネイルは id から署名付き URL を取得する。
  preview?: string
  error?: string
}

function toDraftFile(attachment: Attachment): DraftFile {
  return {
    key: attachment.id,
    name: attachment.fileName,
    size: attachment.sizeBytes,
    contentType: attachment.contentType,
    progress: 1,
    status: 'ready',
    id: attachment.id,
  }
}

export function Composer({
  storageKey,
  disabled,
  mutationDisabled = false,
  onSubmit,
  uploadFile,
  placeholder = 'メッセージを入力',
  initialBody = '',
  initialAttachments,
  initialError,
  submitLabel = '送信',
  onCancel,
  persistDraft = true,
  autoFocus = false,
  suppressAutoFocus = false,
  resolveAttachmentUrl,
}: {
  storageKey: string
  disabled?: boolean
  mutationDisabled?: boolean
  onSubmit: (body: string, attachmentIds: string[], attachments: Attachment[]) => void | Promise<void>
  uploadFile?: (file: PickedFile, onProgress: (ratio: number) => void) => Promise<string>
  placeholder?: string
  /** 編集モードの初期本文 */
  initialBody?: string
  /** 編集モードへ引き継ぐ既存添付 */
  initialAttachments?: Attachment[]
  /** 編集フォームを開いた時点から表示するエラー */
  initialError?: string
  /** 確定操作のラベル。編集モードでは「保存」 */
  submitLabel?: string
  /** 指定したときだけ取り消しボタンを出す。編集モードの目印も兼ねる */
  onCancel?: () => void
  /** 偽なら下書きを読まない・書かない */
  persistDraft?: boolean
  /** タッチ端末でもマウント時に本文へフォーカスする */
  autoFocus?: boolean
  /** 真ならマウント時に本文へフォーカスしない。明示的なフォーカス要求（epoch 更新）は従来どおり効く */
  suppressAutoFocus?: boolean
  /** 既存添付のサムネイル用に署名付き URL を取得する */
  resolveAttachmentUrl?: (id: string) => Promise<string>
}) {
  const platform = usePlatform()
  const epoch = useUi((s) => s.composerEpoch)
  const editing = Boolean(onCancel)
  const [value, setValue] = useState(initialBody)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string | null>(initialError ?? null)
  // 編集フォームを開いたまま保存失敗が届くことがある。マウント済みでも表示できるよう、
  // initialError の変化を描画中に取り込む（本文は入力中のものを優先するので触らない）。
  const [lastInitialError, setLastInitialError] = useState(initialError)
  if (initialError !== lastInitialError) {
    setLastInitialError(initialError)
    if (initialError) setError(initialError)
  }
  const [drafts, setDraftState] = useState<DraftFile[]>(() => (initialAttachments ?? []).map(toDraftFile))
  // 初回描画の drafts をそのまま持たせる。以降 useRef は引数を無視するので同期はずれない。
  const draftsRef = useRef<DraftFile[]>(drafts)
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
    // 編集中の入力は下書きにしない。新規投稿の下書きを読むことも書くこともしない。
    if (!persistDraft) return
    let cancelled = false
    void platform.getItem(storageKey).then((raw) => {
      if (cancelled) return
      if (raw) setValue(raw)
      setLoaded(true)
    })
    return () => {
      cancelled = true
    }
  }, [persistDraft, platform, storageKey])

  useEffect(() => {
    if (!persistDraft || !loaded) return
    void platform.setItem(storageKey, value)
  }, [loaded, persistDraft, platform, storageKey, value])

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
    // 編集モードは利用者が明示的に開いた操作なので、この抑止の例外とする（autoFocus）。
    const requested = lastEpoch.current !== null && lastEpoch.current !== epoch
    lastEpoch.current = epoch
    if (!requested && suppressAutoFocus) return
    if (!requested && !autoFocus && isTouchDevice()) return
    el.focus()
    el.selectionStart = el.value.length
  }, [autoFocus, epoch, suppressAutoFocus])

  useEffect(() => {
    const el = area.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }, [value])

  const uploading = drafts.some((d) => d.status === 'uploading')
  const readyDrafts = drafts.filter((d) => d.status === 'ready' && d.id)
  const readyIds = readyDrafts.map((d) => d.id!)
  const readyAttachments: Attachment[] = readyDrafts.map((draft) => ({
    id: draft.id!,
    fileName: draft.name,
    contentType: draft.contentType,
    sizeBytes: draft.size,
    checksum: '',
    createdAt: '',
  }))
  const hasContent = Boolean(value.trim()) || readyIds.length > 0
  const ready = !disabled && !mutationDisabled && !sending && !uploading
  // 新規投稿は空のとき送信ボタンを無効にする。編集は「なぜ保存できないか」を示す必要が
  // あるので押せるままにし、submit でエラーを出す。
  const canSend = ready && (editing || hasContent)

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
      next.push({
        key,
        name: typed.name,
        size: typed.data.byteLength,
        contentType: type,
        file: typed,
        progress: 0,
        status: 'uploading',
        preview,
      })
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
    if (!hasContent) {
      setError('本文または添付のいずれかが必要です')
      return
    }
    setSending(true)
    setError(null)
    const snapshot = value
    try {
      await onSubmit(value, readyIds, readyAttachments)
      if (!persistDraft) return
      setValue('')
      draftsRef.current.forEach((d) => {
        if (d.preview) URL.revokeObjectURL(d.preview)
      })
      replaceDrafts([])
      await platform.removeItem(storageKey)
    } catch {
      // 編集モードでは呼び出し側が mutate を投げっぱなしにするため onSubmit は reject しない。
      // 編集の失敗処理は usePosts の edit mutation の onError で行う。
      setValue(snapshot)
      setError(submitFailureMessage(submitLabel))
    } finally {
      setSending(false)
    }
  }

  /** setValue で本文を書き換えたあと、描画を待ってからカーソルを置き直す。 */
  const restoreSelection = (start: number, end: number) => {
    const el = area.current
    requestAnimationFrame(() => {
      if (!el) return
      el.focus()
      el.setSelectionRange(start, end)
    })
  }

  const runFormat = (action: FormatAction) => {
    const el = area.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? start
    const next = applyFormat(action, value, start, end)
    setValue(next.value)
    restoreSelection(next.selectionStart, next.selectionEnd)
  }

  return (
    <form
      // 左右のパディングは shell-composer が safe-area 込みで持つ。
      // 編集モードはポスト行の内側に置くので、その余白と影は付けない。
      className={cn(
        'relative',
        editing
          ? 'py-1'
          : 'material-regular z-10 rounded-t-xl py-3 shadow-sm transition-[background-color,box-shadow] shell-composer',
        dragging && (editing ? 'bg-accent/40' : 'bg-accent/60 shadow-md'),
      )}
      data-testid={editing ? 'post-editor' : storageKey.startsWith('draft:thread') ? 'thread-composer' : 'composer'}
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      onKeyDown={(e) => {
        // Escape で編集を取り消す。IME 変換中の Escape は変換の取り消しなので拾わない。
        if (e.key !== 'Escape' || !onCancel) return
        if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return
        e.preventDefault()
        e.stopPropagation()
        onCancel()
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
          onChange={(e) => {
            const next = e.target.value
            const caret = e.target.selectionStart ?? next.length
            // IME 変換中は展開しない。1 文字ずつ増えて見える変換途中を拾わないための保険。
            const composing = (e.nativeEvent as InputEvent).isComposing
            const expanded = composing ? null : expandFenceTrigger(value, next, caret)
            if (!expanded) {
              setValue(next)
              return
            }
            setValue(expanded.value)
            restoreSelection(expanded.cursor, expanded.cursor)
          }}
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
            if (e.key === 'Tab') {
              const start = e.currentTarget.selectionStart ?? value.length
              const end = e.currentTarget.selectionEnd ?? start
              const next = indentLines(value, start, end, { outdent: e.shiftKey })
              // 箇条書きでない行では Tab を奪わない。Tab は textarea から抜ける唯一の
              // キーボード手段であり（送信は Shift+Enter）、奪うとここに閉じ込められる。
              if (!next) return
              e.preventDefault()
              setValue(next.value)
              restoreSelection(next.selectionStart, next.selectionEnd)
              return
            }
            // Enter は改行、確定は Shift+Enter（編集モードの保存も同じ操作）
            if (e.key !== 'Enter' || !e.shiftKey) return
            // IME 変換中（変換候補の確定 Enter）は確定しない
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
                <DraftThumb draft={d} resolveAttachmentUrl={resolveAttachmentUrl} />
                <span className="min-w-0 flex-1 truncate">{d.name}</span>
                <span className="text-muted-foreground">{formatBytes(d.size)}</span>
                {d.status === 'uploading' ? <span>{Math.round(d.progress * 100)}%</span> : null}
                {d.status === 'error' ? <span className="text-destructive">{d.error}</span> : null}
                {d.status === 'error' && d.file ? (
                  <Button type="button" variant="ghost" size="sm" className="h-7 px-2 text-caption" disabled={mutationDisabled} onClick={() => runUpload(d.key, d.file!)}>
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
            {error ? <p role="alert" className="min-w-0 text-caption text-destructive">{error}</p> : null}
          </div>
          {onCancel ? (
            <div className="flex shrink-0 items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={onCancel}>
                取り消し
              </Button>
              <Button type="submit" size="sm" title={`${submitLabel} (Shift+Enter)`} disabled={!canSend}>
                {submitLabel}
              </Button>
            </div>
          ) : (
            <Button type="submit" size="icon" className="size-9" aria-label={submitLabel} title={`${submitLabel} (Shift+Enter)`} disabled={!canSend}>
              <Send className="size-4" />
            </Button>
          )}
        </div>
      </div>
    </form>
  )
}

function DraftThumb({
  draft,
  resolveAttachmentUrl,
}: {
  draft: DraftFile
  resolveAttachmentUrl?: (id: string) => Promise<string>
}) {
  if (draft.preview) return <img src={draft.preview} alt="" className="h-8 w-8 rounded-lg object-cover" />
  if (!isImageType(draft.contentType) || !draft.id || !resolveAttachmentUrl) return null
  return <RemoteThumb id={draft.id} resolveAttachmentUrl={resolveAttachmentUrl} />
}

function RemoteThumb({
  id,
  resolveAttachmentUrl,
}: {
  id: string
  resolveAttachmentUrl: (id: string) => Promise<string>
}) {
  const [url, setUrl] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    void resolveAttachmentUrl(id)
      .then((next) => {
        if (!cancelled) setUrl(next)
      })
      .catch(() => {
        // サムネイルは補助的な表示なので、取得できなくても添付そのものは扱える
      })
    return () => {
      cancelled = true
    }
  }, [id, resolveAttachmentUrl])
  if (!url) return <span className="h-8 w-8 shrink-0 rounded-lg bg-muted" aria-hidden="true" />
  return <img src={url} alt="" className="h-8 w-8 rounded-lg object-cover" />
}
