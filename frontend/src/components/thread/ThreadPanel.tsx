import { useEffect } from 'react'
import { m, useReducedMotion } from 'motion/react'
import { X } from 'lucide-react'
import { usePostMutations, useThread } from '@/hooks/usePosts'
import { formatDateTime } from '@/lib/dates'
import { THREAD_MAX_WIDTH, THREAD_MIN_WIDTH, useUi } from '@/state/ui'
import { useAuth } from '@/auth/AuthProvider'
import { Composer } from '@/components/composer/Composer'
import { PostBody } from '@/components/post/PostBody'
import { PostActions } from '@/components/post/PostActions'
import { ReactionBar } from '@/components/reactions/ReactionBar'
import { uploadPickedFile } from '@/lib/upload'
import { Button } from '@/components/ui/button'
import { useDragValue } from '@/lib/motion/useDragValue'
import { springPresets } from '@/lib/motion/springs'

export function ThreadPanel({ channelId }: { channelId: string | null }) {
  const postId = useUi((s) => s.threadPostId)
  const targetReplyId = useUi((s) => s.targetThreadReplyId)
  const canMutate = useUi((s) => s.canMutate)
  const width = useUi((s) => s.threadWidth)
  const { data, isLoading } = useThread(postId)
  const mutations = usePostMutations(channelId)
  const { api } = useAuth()
  const shouldReduceMotion = useReducedMotion()
  // 右寄せパネルの左端をつかむので、ポインタを左へ動かすと幅が増える（invert）。
  const resize = useDragValue({
    initialValue: width,
    min: THREAD_MIN_WIDTH,
    max: THREAD_MAX_WIDTH,
    invert: true,
    dimension: THREAD_MAX_WIDTH - THREAD_MIN_WIDTH,
    onCommit: (next) => useUi.getState().setThreadWidth(next),
  })
  const targetVisible = targetReplyId !== null && Boolean(data?.replies.some((reply) => reply.id === targetReplyId))
  useEffect(() => {
    if (!targetReplyId || !targetVisible) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`thread-reply-${targetReplyId}`)
      target?.scrollIntoView({ block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [targetReplyId, targetVisible])

  const setWidth = (nextWidth: number) => {
    useUi.getState().setThreadWidth(nextWidth)
    resize.value.set(useUi.getState().threadWidth)
  }

  if (!postId) return null

  return (
    <m.div
      initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
      animate={{ opacity: 1, x: 0 }}
      exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, x: 24 }}
      transition={shouldReduceMotion ? { duration: 0.14, ease: 'easeOut' } : springPresets.sheet}
      className="relative z-20 mt-12 flex shrink-0"
      style={{ width: resize.value }}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-valuemin={THREAD_MIN_WIDTH}
        aria-valuemax={THREAD_MAX_WIDTH}
        aria-valuenow={Math.round(width)}
        aria-label="スレッドの幅"
        tabIndex={0}
        data-testid="thread-resizer"
        className="absolute inset-y-0 -left-1.5 z-30 w-1.5 cursor-col-resize touch-pan-y bg-transparent outline-none after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border hover:after:w-0.5 hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-ring"
        {...resize.dragProps}
        onKeyDown={(event) => {
          const step = event.shiftKey ? 40 : 10
          // 左へ広がるパネルなので ← が拡大、→ が縮小。
          if (event.key === 'ArrowLeft') setWidth(width + step)
          else if (event.key === 'ArrowRight') setWidth(width - step)
          else if (event.key === 'Home') setWidth(THREAD_MIN_WIDTH)
          else if (event.key === 'End') setWidth(THREAD_MAX_WIDTH)
          else return
          event.preventDefault()
        }}
      />
      <aside
        className="material-regular flex min-w-0 flex-1 flex-col overflow-hidden"
        data-testid="thread-panel"
      >
        <header className="flex items-center justify-between border-b border-border px-3 py-2">
          <h2 className="text-title font-semibold">スレッド</h2>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-8"
            aria-label="スレッドを閉じる"
            title="閉じる"
            onClick={() => useUi.getState().openThread(null)}
          >
            <X className="size-4" />
          </Button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto p-3">
          {isLoading ? <p className="text-body text-muted-foreground">読み込み中…</p> : null}
          {data?.root.deleted ? (
            <p className="rounded-lg bg-muted p-3 text-body text-muted-foreground">このポストは削除されました</p>
          ) : (
            <div className="mb-4">
              <p className="text-caption text-muted-foreground">{data ? formatDateTime(data.root.createdAt) : ''}</p>
              {data ? (
                <>
                  <PostBody post={data.root} />
                  <ReactionBar postId={data.root.id} reactions={data.root.reactions ?? []} />
                </>
              ) : null}
            </div>
          )}
          {data?.replies.map((reply) => (
            <article
              key={reply.id}
              id={`thread-reply-${reply.id}`}
              tabIndex={-1}
              className={`group relative mb-3 border-t border-border pt-3 focus:outline-none ${
                reply.id === targetReplyId ? 'rounded-md bg-accent p-2 ring-2 ring-primary' : ''
              }`}
            >
              <p className="text-caption text-muted-foreground">{formatDateTime(reply.createdAt)}</p>
              <PostBody post={reply} />
              <ReactionBar postId={reply.id} reactions={reply.reactions ?? []} />
              <PostActions
                post={reply}
                kind="返信"
                mutationDisabled={!canMutate}
                onEdit={(body, attachmentIds) => mutations.edit.mutate({ id: reply.id, body, attachmentIds })}
                onDelete={() => mutations.remove.mutate(reply.id)}
              />
            </article>
          ))}
        </div>
        <Composer
          key={postId}
          storageKey={`draft:thread:${postId}`}
          placeholder="返信を入力"
          mutationDisabled={!canMutate}
          uploadFile={(file, onProgress) => uploadPickedFile(api, file, onProgress)}
          onSubmit={async (body, attachmentIds) => {
            await mutations.reply.mutateAsync({ postId, body, attachmentIds })
          }}
        />
      </aside>
    </m.div>
  )
}
