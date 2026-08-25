import { useEffect, useId, useRef, useState } from 'react'
import type { Reaction } from '@/api/client'
import { cn } from '@/lib/utils'
import { useReactionMutation } from '@/hooks/useReactions'
import { EmojiImage } from './EmojiImage'
import { EmojiPicker } from './EmojiPicker'
import { useUi } from '@/state/ui'

export function ReactionBar({ postId, reactions }: { postId: string; reactions: Reaction[] }) {
  const mutation = useReactionMutation()
  const canMutate = useUi((state) => state.canMutate)

  return (
    <div className="mt-1.5 flex flex-wrap items-center gap-1" data-testid={`reactions-${postId}`}>
      {reactions.map((reaction) => (
        <ReactionButton
          key={reaction.emoji.id}
          reaction={reaction}
          busy={mutation.isPending || !canMutate}
          onToggle={() =>
            mutation.mutate({
              postId,
              emoji: reaction.emoji,
              react: !reaction.reactedByMe,
            })
          }
        />
      ))}
      <EmojiPicker
        disabled={!canMutate}
        onSelect={(emoji) => mutation.mutate({ postId, emoji, react: true })}
      />
      {mutation.isError ? (
        <p role="alert" className="basis-full text-xs text-destructive">
          リアクションを更新できませんでした。元の状態に戻しました。
        </p>
      ) : null}
    </div>
  )
}

function ReactionButton({
  reaction,
  busy,
  onToggle,
}: {
  reaction: Reaction
  busy: boolean
  onToggle: () => void
}) {
  const tooltipId = useId()
  const holdTimer = useRef<number | null>(null)
  const suppressClick = useRef(false)
  const [held, setHeld] = useState(false)

  useEffect(
    () => () => {
      if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    },
    [],
  )

  const startHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = window.setTimeout(() => {
      suppressClick.current = true
      setHeld(true)
    }, 500)
  }
  const endHold = () => {
    if (holdTimer.current !== null) window.clearTimeout(holdTimer.current)
    holdTimer.current = null
    setHeld(false)
  }

  return (
    <span className="group/reaction relative inline-flex">
      <button
        type="button"
        aria-pressed={reaction.reactedByMe}
        aria-describedby={tooltipId}
        aria-label={`:${reaction.emoji.shortcode}: ${reaction.count}件。${
          reaction.reactedByMe ? '自分のリアクションを解除' : 'リアクションを付ける'
        }`}
        disabled={busy}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60',
          reaction.reactedByMe
            ? 'border-primary bg-primary/10 text-primary'
            : 'border-border bg-background text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        onPointerDown={startHold}
        onPointerUp={endHold}
        onPointerCancel={endHold}
        onPointerLeave={endHold}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false
            return
          }
          onToggle()
        }}
      >
        <EmojiImage
          emoji={reaction.emoji}
          decorative
          className="h-4 w-4"
          fallbackClassName="max-w-24"
        />
        <span>{reaction.count}</span>
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className={cn(
          'pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 w-max max-w-64 -translate-x-1/2 rounded bg-foreground px-2 py-1 text-xs text-background opacity-0 transition-opacity group-hover/reaction:opacity-100 group-focus-within/reaction:opacity-100',
          held && 'opacity-100',
        )}
      >
        {reactorLabel(reaction)}
      </span>
    </span>
  )
}

function reactorLabel(reaction: Reaction): string {
  const labels = reaction.reactedByMe
    ? ['自分', ...reaction.reactorIds.slice(1).map(abbreviateUser)]
    : reaction.reactorIds.map(abbreviateUser)
  if (labels.length < reaction.count) labels.push(`ほか${reaction.count - labels.length}人`)
  return labels.length > 0 ? labels.join('、') : `${reaction.count}人がリアクションしました`
}

function abbreviateUser(id: string): string {
  return id.length > 8 ? `${id.slice(0, 8)}…` : id
}
