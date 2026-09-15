import { useEffect, useId, useState } from 'react'
import { ArrowLeft, ImagePlus } from 'lucide-react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { ApiError, type Emoji } from '@/api/client'
import { useAuth } from '@/auth/AuthProvider'
import {
  ACCEPTED_STAMP_ACCEPT,
  deriveShortcode,
  isValidShortcode,
  validateStampFile,
} from '@/lib/stamp-upload'

export function StampUploadPanel({
  onBack,
  onRegistered,
}: {
  onBack: () => void
  onRegistered: (emoji: Emoji) => void
}) {
  const { api } = useAuth()
  const queryClient = useQueryClient()
  // ファイルとプレビュー URL は組で持つ。片方だけが更新される状態を作らない。
  const [selection, setSelection] = useState<{ file: File; preview: string } | null>(null)
  const [shortcode, setShortcode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const headingId = useId()
  const shortcodeId = useId()

  useEffect(() => {
    const url = selection?.preview
    if (!url) return
    return () => URL.revokeObjectURL(url)
  }, [selection])

  const register = useMutation({
    mutationFn: (input: { file: File; shortcode: string }) =>
      api.createEmoji(input.file, input.shortcode),
    onSuccess: async (emoji: Emoji) => {
      // 一覧に出すのに必要な id と checksum はサーバが決めるので、
      // 楽観挿入せずカタログを取り直す。
      await queryClient.invalidateQueries({ queryKey: ['emojis'] })
      onRegistered(emoji)
    },
    onError: (cause: unknown) => setError(registerErrorMessage(cause)),
  })

  const file = selection?.file ?? null
  const preview = selection?.preview ?? null
  const canSubmit = file !== null && isValidShortcode(shortcode) && !register.isPending

  return (
    <div aria-labelledby={headingId}>
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          aria-label="スタンプの一覧に戻る"
          className="rounded-lg p-1 text-muted-foreground hover:bg-accent hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          onClick={onBack}
        >
          <ArrowLeft aria-hidden="true" size={16} />
        </button>
        <h4 id={headingId} className="text-title font-semibold">
          スタンプを追加
        </h4>
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          if (!canSubmit || file === null) return
          setError(null)
          register.mutate({ file, shortcode })
        }}
      >
        <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-input p-3 text-body hover:bg-accent has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
          {preview ? (
            <img
              src={preview}
              alt=""
              className="h-10 w-10 shrink-0 object-contain"
            />
          ) : (
            <ImagePlus aria-hidden="true" size={20} className="shrink-0 text-muted-foreground" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {file ? file.name : '画像ファイルを選ぶ'}
          </span>
          <input
            type="file"
            // ファイルを選ぶとラベルの文字がファイル名に変わるので、
            // 参照名が動かないよう aria-label を明示する。
            aria-label="スタンプの画像ファイル"
            accept={ACCEPTED_STAMP_ACCEPT}
            className="sr-only"
            disabled={register.isPending}
            onChange={(event) => {
              const selected = event.target.files?.[0] ?? null
              // 同じファイルを選び直せるように input の値は毎回空に戻す。
              event.target.value = ''
              if (!selected) return
              const reason = validateStampFile(selected)
              if (reason) {
                // 制約を満たさないファイルはアップロードを始めず、その場で理由を出す。
                setSelection(null)
                setShortcode('')
                setError(reason)
                return
              }
              setError(null)
              setSelection({ file: selected, preview: URL.createObjectURL(selected) })
              setShortcode(deriveShortcode(selected.name))
            }}
          />
        </label>

        <div className="mt-3">
          <label htmlFor={shortcodeId} className="block text-caption text-muted-foreground">
            ショートコード
          </label>
          <input
            id={shortcodeId}
            type="text"
            value={shortcode}
            disabled={register.isPending}
            placeholder="英数字・_・-（先頭は英数字）"
            className="mt-1 w-full rounded-lg border border-input bg-background px-3 py-2 text-body outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            onChange={(event) => setShortcode(event.target.value)}
          />
          {file && shortcode === '' ? (
            <p className="mt-1 text-caption text-muted-foreground">
              ファイル名から決められませんでした。ショートコードを入力してください
            </p>
          ) : null}
        </div>

        {error ? (
          <p role="alert" className="mt-3 text-body text-destructive">
            {error}
          </p>
        ) : null}
        {register.isPending ? (
          <p role="status" className="mt-3 text-body text-muted-foreground">
            登録中…
          </p>
        ) : null}

        <button
          type="submit"
          disabled={!canSubmit}
          className="mt-3 w-full rounded-lg bg-primary px-3 py-2 text-body font-medium text-primary-foreground disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          登録する
        </button>
      </form>
    </div>
  )
}

function registerErrorMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.message
  return 'スタンプを登録できませんでした。通信を確かめてもう一度お試しください'
}
