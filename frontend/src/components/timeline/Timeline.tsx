import { useEffect, useRef } from 'react'
import type { Post } from '@/api/client'
import { flattenPages, usePostMutations, useTimeline } from '@/hooks/usePosts'
import { formatDateLabel, formatTime, localDateKey } from '@/lib/dates'
import { useUi } from '@/state/ui'
import { useAuth } from '@/auth/AuthProvider'
import { Composer } from '@/components/composer/Composer'
import { PostActions } from '@/components/post/PostActions'
import { PostBody } from '@/components/post/PostBody'
import { ReactionBar } from '@/components/reactions/ReactionBar'
import { uploadPickedFile } from '@/lib/upload'
import { cn } from '@/lib/utils'
import { useScrollEdge } from '@/lib/motion/useScrollEdge'
import { Button } from '@/components/ui/button'

export function Timeline({
  channelId,
  onScrollEdgeChange,
}: {
  channelId: string | null
  onScrollEdgeChange?: (isContentUnderChrome: boolean) => void
}) {
  const timelineAnchorId = useUi((s) => s.timelineAnchorId)
  const targetPostId = useUi((s) => s.targetPostId)
  const canMutate = useUi((s) => s.canMutate)
  const { data, fetchNextPage, hasNextPage, isFetchingNextPage, isLoading } = useTimeline(channelId, timelineAnchorId)
  const posts = flattenPages(data?.pages)
  const scroller = useRef<HTMLDivElement>(null)
  const sentinelRef = useRef<HTMLDivElement>(null)
  const isContentUnderChrome = useScrollEdge(scroller, sentinelRef)
  const loading = useRef(false)
  const mutations = usePostMutations(channelId)
  const { api } = useAuth()
  const initial = useRef(true)

  useEffect(() => {
    onScrollEdgeChange?.(isContentUnderChrome)
  }, [isContentUnderChrome, onScrollEdgeChange])

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
      <div className="flex flex-1 items-center justify-center pt-12 text-body text-muted-foreground">
        チャネルが選択されていません
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto px-4 pb-3 pt-14"
        data-testid="timeline"
      >
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        {timelineAnchorId ? (
          <div className="material-thin mb-3 rounded-lg px-4 py-2 text-center shadow-sm">
            <Button type="button" variant="ghost" size="sm" className="text-primary" onClick={() => useUi.getState().returnToLatest()}>
              最新のポストへ戻る
            </Button>
          </div>
        ) : null}
        {isFetchingNextPage ? <p className="mb-2 text-center text-caption text-muted-foreground">読み込み中…</p> : null}
        {!hasNextPage && posts.length > 0 ? (
          <p className="mb-2 text-center text-caption text-muted-foreground">履歴の先頭です</p>
        ) : null}
        {isLoading ? <p className="text-body text-muted-foreground">読み込み中…</p> : null}
        {!isLoading && posts.length === 0 ? (
          <p className="text-body text-muted-foreground">まだポストがありません</p>
        ) : null}
        {posts.map((post, i) => {
          const prev = posts[i - 1]
          const showDate = !prev || localDateKey(prev.createdAt) !== localDateKey(post.createdAt)
          return (
            <div key={post.id}>
              {showDate ? (
                <div className="my-4 flex items-center gap-3 text-caption font-medium text-muted-foreground">
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                  <span>{formatDateLabel(post.createdAt)}</span>
                  <span className="h-px flex-1 bg-border" aria-hidden="true" />
                </div>
              ) : null}
              <PostRow
                post={post}
                highlighted={post.id === targetPostId}
                mutationDisabled={!canMutate}
                onEdit={(body, attachmentIds) => mutations.edit.mutate({ id: post.id, body, attachmentIds })}
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
  onEdit: (body: string, attachmentIds: string[]) => void
  onDelete: () => void
}) {
  return (
    <article
      id={`post-${post.id}`}
      tabIndex={-1}
      className={cn(
        'group relative rounded-lg px-3 py-2.5 transition-colors hover:bg-accent/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        highlighted && 'bg-accent shadow-sm ring-2 ring-primary',
      )}
      data-testid={`post-${post.id}`}
    >
      <header className="mb-1 flex items-baseline gap-2 text-caption text-muted-foreground">
        <span className="font-medium text-foreground">投稿者</span>
        <time>{formatTime(post.createdAt)}</time>
        {post.editedAt ? <span>編集済み</span> : null}
      </header>
      <PostBody post={post} />
      <ReactionBar postId={post.id} reactions={post.reactions ?? []} />
      {post.replyCount > 0 ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-2 text-caption text-primary"
          onClick={() => useUi.getState().openThread(post.id)}
        >
          {post.replyCount} 件の返信
          {post.lastReplyAt ? ` · 最終 ${formatTime(post.lastReplyAt)}` : ''}
        </Button>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="mt-1 h-7 px-2 text-caption text-muted-foreground"
          onClick={() => useUi.getState().openThread(post.id)}
        >
          スレッドで返信
        </Button>
      )}
      <PostActions
        post={post}
        kind="ポスト"
        mutationDisabled={mutationDisabled}
        onEdit={onEdit}
        onDelete={onDelete}
      />
    </article>
  )
}
