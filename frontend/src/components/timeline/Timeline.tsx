import { useEffect, useRef } from 'react'
import type { Attachment, Post } from '@/api/client'
import { flattenPages, usePostMutations, useTimeline } from '@/hooks/usePosts'
import { formatDateLabel, formatTime, localDateKey } from '@/lib/dates'
import { useUi } from '@/state/ui'
import { useAuth } from '@/auth/AuthProvider'
import { Composer } from '@/components/composer/Composer'
import { PostActions } from '@/components/post/PostActions'
import { PostBody } from '@/components/post/PostBody'
import { PostEditor } from '@/components/post/PostEditor'
import { ReactionBar } from '@/components/reactions/ReactionBar'
import { uploadPickedFile } from '@/lib/upload'
import { cn } from '@/lib/utils'
import { useScrollEdge } from '@/lib/motion/useScrollEdge'
import { Button } from '@/components/ui/button'

const bottomThreshold = 32

function pinToBottom(el: HTMLElement, measuredHeight: { current: number }) {
  el.scrollTop = el.scrollHeight
  measuredHeight.current = el.scrollHeight
}

/**
 * 編集フォームがタイムライン上に開いているか。行の存在まで見るので、対象が取得結果から
 * 消えて編集状態だけが残っても追従は止まらないし、スレッド側の返信の編集で
 * タイムラインが固まることもない。
 */
function isEditingInTimeline() {
  const id = useUi.getState().editingPostId
  return id !== null && document.getElementById(`post-${id}`) !== null
}

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
  const contentRef = useRef<HTMLDivElement>(null)
  const isContentUnderChrome = useScrollEdge(scroller, sentinelRef)
  const loading = useRef(false)
  const mutations = usePostMutations(channelId)
  const { api } = useAuth()
  const initial = useRef(true)
  const pinnedToBottom = useRef(true)
  const measuredHeight = useRef(0)

  useEffect(() => {
    onScrollEdgeChange?.(isContentUnderChrome)
  }, [isContentUnderChrome, onScrollEdgeChange])

  useEffect(() => {
    initial.current = true
    pinnedToBottom.current = true
  }, [channelId, timelineAnchorId])

  useEffect(() => {
    const el = scroller.current
    if (!el || !initial.current || posts.length === 0) return
    pinToBottom(el, measuredHeight)
    initial.current = false
  }, [posts.length, channelId, timelineAnchorId])

  // 再取得や画像・コードハイライトの遅延描画で本文が伸びても最下部に留まらせる
  useEffect(() => {
    const el = scroller.current
    const content = contentRef.current
    if (!el || !content || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      // 編集中は追従しない。フォームの高さが変わるたびに編集箇所が画面外へ送られる。
      // 副作用の中でしか要る判断ではないので購読せず getState で読む。
      if (isEditingInTimeline()) {
        measuredHeight.current = el.scrollHeight
        return
      }
      if (pinnedToBottom.current) pinToBottom(el, measuredHeight)
      else measuredHeight.current = el.scrollHeight
    })
    observer.observe(content)
    observer.observe(el)
    return () => observer.disconnect()
  }, [channelId])

  const targetVisible = targetPostId !== null && posts.some((post) => post.id === targetPostId)
  useEffect(() => {
    if (!targetPostId || !targetVisible) return
    pinnedToBottom.current = false
    const frame = requestAnimationFrame(() => {
      const target = document.getElementById(`post-${targetPostId}`)
      target?.scrollIntoView({ block: 'center' })
      target?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(frame)
  }, [targetPostId, targetVisible])

  const onScroll = () => {
    const el = scroller.current
    if (!el) return
    // 本文が伸びた直後のスクロールイベントは利用者の操作ではないので追従状態を変えない。
    // 編集中は追従状態そのものを触らず、閉じた時点で編集前の値をそのまま使う。
    if (!isEditingInTimeline() && el.scrollHeight === measuredHeight.current) {
      pinnedToBottom.current = el.scrollHeight - el.clientHeight - el.scrollTop <= bottomThreshold
    }
    measuredHeight.current = el.scrollHeight
    if (loading.current || !hasNextPage || isFetchingNextPage) return
    if (el.scrollTop > 40) return
    loading.current = true
    const prev = el.scrollHeight
    void fetchNextPage().then(() => {
      requestAnimationFrame(() => {
        if (scroller.current) {
          scroller.current.scrollTop = scroller.current.scrollHeight - prev + el.scrollTop
          measuredHeight.current = scroller.current.scrollHeight
        }
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
    // min-w-0: 横並び flex の子は既定の min-width:auto で最小コンテンツ幅まで広がるため、
    // 長い URL やコードブロックがあると iPhone 幅を超えて横スクロールが生まれる。
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div
        ref={scroller}
        onScroll={onScroll}
        className="min-h-0 flex-1 overflow-y-auto scroll-clip-x px-4 pb-3 shell-content-pad"
        data-testid="timeline"
      >
        <div ref={sentinelRef} className="h-px" aria-hidden="true" />
        <div ref={contentRef}>
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
                  onSave={(body, _attachmentIds, attachments) => {
                    useUi.getState().setEditingPost(null)
                    mutations.edit.mutate({ id: post.id, body, attachments, postUpdatedAt: post.updatedAt })
                  }}
                  onDelete={() => mutations.remove.mutate(post.id)}
                />
              </div>
            )
          })}
        </div>
      </div>
      <Composer
        key={channelId}
        storageKey={`draft:${channelId}`}
        disabled={!channelId}
        mutationDisabled={!canMutate}
        uploadFile={(file, onProgress) => uploadPickedFile(api, file, onProgress)}
        onSubmit={async (body, attachmentIds) => {
          await mutations.create.mutateAsync({ body, attachmentIds })
          const el = scroller.current
          if (!el) return
          pinnedToBottom.current = true
          pinToBottom(el, measuredHeight)
        }}
      />
    </div>
  )
}

function PostRow({
  post,
  highlighted,
  mutationDisabled,
  onSave,
  onDelete,
}: {
  post: Post
  highlighted: boolean
  mutationDisabled: boolean
  onSave: (body: string, attachmentIds: string[], attachments: Attachment[]) => void | Promise<void>
  onDelete: () => void
}) {
  // 行ごとに真偽値で購読するので、編集の開始・終了で再描画されるのは当該行だけになる
  const editing = useUi((s) => s.editingPostId === post.id)
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
      {editing ? (
        <PostEditor post={post} mutationDisabled={mutationDisabled} onSave={onSave} />
      ) : (
        <PostBody post={post} />
      )}
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
        onDelete={onDelete}
      />
    </article>
  )
}
