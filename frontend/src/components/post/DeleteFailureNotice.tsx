import { Button } from '@/components/ui/button'

/**
 * 削除に失敗して元の位置へ戻したポストの行に出す通知。
 * トースト等のグローバルな通知基盤が無いので、`ReactionBar` の失敗表示と同じく
 * 対象の行の中に `role="alert"` で置く。
 */
export function DeleteFailureNotice({
  message,
  mutationDisabled,
  onRetry,
}: {
  message: string | undefined
  mutationDisabled: boolean
  onRetry: () => void
}) {
  if (!message) return null
  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-2">
      <p role="alert" className="basis-full text-caption text-destructive">
        {message}
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-7 px-2 text-caption"
        disabled={mutationDisabled}
        onClick={onRetry}
      >
        再試行
      </Button>
    </div>
  )
}
