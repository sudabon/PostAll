import type { PendingPost } from '@/state/ui'
import { AttachmentGallery } from '@/components/attachments/AttachmentGallery'
import { MarkdownBody } from '@/components/markdown/MarkdownBody'
import { Button } from '@/components/ui/button'
import { formatTime } from '@/lib/dates'
import { cn } from '@/lib/utils'

export const pendingFailureMessage = '送信できませんでした。再送するか破棄してください。'

/**
 * サーバーが確定していないポスト・返信の行。
 * id がまだ無いので、編集・削除・リアクション・スレッドの導線は一切描かない。
 * 「押せるが失敗する」を作らないために、通常の行コンポーネントとは分けている。
 */
export function PendingPostRow({
  pending,
  mutationDisabled,
  onRetry,
  onDiscard,
}: {
  pending: PendingPost
  mutationDisabled: boolean
  onRetry: () => void
  onDiscard: () => void
}) {
  const failed = pending.status === 'failed'
  return (
    <article
      className={cn('relative rounded-lg px-3 py-2.5', !failed && 'opacity-60')}
      data-testid={`pending-post-${pending.key}`}
      data-status={pending.status}
    >
      <header className="mb-1 flex items-baseline gap-2 text-caption text-muted-foreground">
        <span className="font-medium">投稿者</span>
        <time>{formatTime(pending.createdAt)}</time>
        <span>{failed ? '未送信' : '送信中'}</span>
      </header>
      <div className={cn(failed && 'text-muted-foreground')}>
        {pending.body.trim() ? <MarkdownBody markdown={pending.body} /> : null}
        <AttachmentGallery items={pending.attachments} />
      </div>
      {failed ? (
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <p role="alert" className="basis-full text-caption text-destructive">
            {pendingFailureMessage}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-7 px-2 text-caption"
            disabled={mutationDisabled}
            onClick={onRetry}
          >
            再送
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 px-2 text-caption"
            onClick={onDiscard}
          >
            破棄
          </Button>
        </div>
      ) : null}
    </article>
  )
}
