import { useEffect, useRef } from 'react'
import type { Post } from '@/api/client'
import { flattenPages, usePostMutations, useTimeline } from '@/hooks/usePosts'
import { formatDateLabel, formatTime, localDateKey } from '@/lib/dates'
import { useUi } from '@/state/ui'
import { useAuth } from '@/auth/AuthProvider'
import { Composer } from '@/components/composer/Composer'
import { PostBody } from '@/components/post/PostBody'
import { ReactionBar } from '@/components/reactions/ReactionBar'
import { uploadPickedFile } from '@/lib/upload'
import { cn } from '@/lib/utils'

export function Timeline({ channelId }: { channelId: string | null }) {
  const timelineAnchorId = useUi((s) => s.timelineAnchorId)
  const targetPostId = useUi((s) => s.targetPostId)
  const canMutate = useUi((s) => s.canMutate)
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useTimeline(channelId, timelineAnchorId)
  const posts = flattenPages(data?.pages)
  const scroller = useRef<HTMLDivElement>(null)
  const loading = useRef(false)
  const mutations = usePostMutations(channelId)
  const { api } = useAuth()
  const initial = useRef(true)

  useEffect(() => {
    initial.current = true
  }, [channelId, timelineAnchorId])

  useEffect(() => {
    const el = scroller.current
    if (!el || !initial.current || posts.length === 0) return
    el.scrollTop = el.scrollHeight
    initial.current = false
  }, [posts.length, channelId, timelineAnchorId])

  const targetVisible = targetPostId !== null && posts.some((post) => post.id === targetPostId)
  useEffect(() => {
    if (!targetPostId || !targetVisible) return
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`post-${targetPostId}`)
      target?.scrollIntoView({ block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [targetPostId, targetVisible])

  const onScroll = () => {
    const el = scroller.current
    if (!el || loading.current || !hasNextPage || isFetchingNextPage) return
    if (el.scrollTop > 40) return
    loading.current = true
    const prev = el.scrollHeight
    void fetchNextPage().then(() => {
      requestAnimationFrame(() => {
        if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight - prev + el.scrollTop
        loading.current = false
      })
    })
  }

  if (!channelId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        チャネルが選択されていません
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {timelineAnchorId ? (
        <div className="border-b border-border bg-muted/50 px-4 py-2 text-center">
          <button type="button" className="text-sm text-primary" onClick={() => useUi.getState().returnToLatest()}>
            最新のポストへ戻る
          </button>
        </div>
      ) : null}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 py-3"
        data-testid="timeline"
      >
        {isFetchingNextPage ? <p className="mb-2 text-center text-xs text-muted-foreground">読み込み中…</p> : null}
        {!hasNextPage && posts.length > 0 ? (
          <p className="mb-2 text-center text-xs text-muted-foreground">履歴の先頭です</p>
        ) : null}
        {isLoading ? <p className="text-sm text-muted-foreground">読み込み中…</p> : null}
        {!isLoading && posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">まだポストがありません</p>
        ) : null}
        {posts.map((post, i) => {
          const prev = posts[i - 1]
          const showDate = !prev || localDateKey(prev.createdAt) !== localDateKey(post.createdAt)
          return (
            <div key={post.id}>
              {showDate ? (
                <div className="my-3 text-center text-xs text-muted-foreground">{formatDateLabel(post.createdAt)}</div>
              ) : null}
              <PostRow
                post={post}
                highlighted={post.id === targetPostId}
                mutationDisabled={!canMutate}
                onEdit={(body) => mutations.edit.mutate({ id: post.id, body })}
                onDelete={() => mutations.remove.mutate(post.id)}
              />
            </div>
          )
        })}
      </div>
      <Composer
        key={channelId}
        storageKey={`draft:${channelId}`}
        disabled={!channelId}
        mutationDisabled={!canMutate}
        uploadFile={(file, onProgress) => uploadPickedFile(api, file, onProgress)}
        onSubmit={async (body, attachmentIds) => {
          await mutations.create.mutateAsync({ body, attachmentIds })
          requestAnimationFrame(() => {
            if (scroller.current) scroller.current.scrollTop = scroller.current.scrollHeight
          })
        }}
      />
    </div>
  )
}

function PostRow({
  post,
  highlighted,
  mutationDisabled,
  onEdit,
  onDelete,
}: {
  post: Post
  highlighted: boolean
  mutationDisabled: boolean
  onEdit: (body: string) => void
  onDelete: () => void
}) {
  return (
    <article
      id={`post-${post.id}`}
      tabIndex={-1}
      className={cn(
        'group relative rounded-md px-2 py-2 hover:bg-accent/60 focus:outline-none',
        highlighted && 'bg-accent ring-2 ring-primary',
      )}
      data-testid={`post-${post.id}`}
    >
      <header className="mb-1 flex items-baseline gap-2 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">投稿者</span>
        <time>{formatTime(post.createdAt)}</time>
        {post.editedAt ? <span>編集済み</span> : null}
      </header>
      <PostBody post={post} />
      <ReactionBar postId={post.id} reactions={post.reactions ?? []} />
      {post.replyCount > 0 ? (
        <button
          type="button"
          className="mt-1 text-xs text-primary"
          onClick={() => useUi.getState().openThread(post.id)}
        >
          {post.replyCount} 件の返信
          {post.lastReplyAt ? ` · 最終 ${formatTime(post.lastReplyAt)}` : ''}
        </button>
      ) : (
        <button
          type="button"
          className="mt-1 text-xs text-muted-foreground"
          onClick={() => useUi.getState().openThread(post.id)}
        >
          スレッドで返信
        </button>
      )}
      <div className={cn('absolute right-2 top-2 hidden gap-2 group-hover:flex')}>
        <button
          type="button"
          className="text-xs"
          disabled={mutationDisabled}
          onClick={() => {
            const next = window.prompt('本文を編集', post.body)
            if (next != null) onEdit(next)
          }}
        >
          編集
        </button>
        <button
          type="button"
          className="text-xs text-destructive"
          disabled={mutationDisabled}
          onClick={() => {
            if (window.confirm('このポストを削除しますか？')) onDelete()
          }}
        >
          削除
        </button>
      </div>
    </article>
  )
}
