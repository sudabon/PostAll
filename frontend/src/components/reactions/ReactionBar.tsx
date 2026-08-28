import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, m } from 'motion/react'
import type { Reaction } from '@/api/client'
import { cn } from '@/lib/utils'
import { useReactionMutation } from '@/hooks/useReactions'
import { EmojiImage } from './EmojiImage'
import { EmojiPicker } from './EmojiPicker'
import { useUi } from '@/state/ui'
import { usePressable } from '@/lib/motion/usePressable'
import { springPresets } from '@/lib/motion/springs'

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
        <p role="alert" className="basis-full text-caption text-destructive">
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
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)

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
  const { isPressed, shouldReduceMotion, pressProps } = usePressable<HTMLButtonElement>({
    disabled: busy,
    onPointerDown: startHold,
    onPointerUp: endHold,
    onPointerCancel: endHold,
  })
  const showTooltip = held || hovered || focused

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={() => setHovered(true)}
      onPointerLeave={() => {
        setHovered(false)
        endHold()
      }}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={() => setFocused(false)}
    >
      <m.button
        type="button"
        aria-pressed={reaction.reactedByMe}
        aria-describedby={tooltipId}
        aria-label={`:${reaction.emoji.shortcode}: ${reaction.count}件。${
          reaction.reactedByMe ? '自分のリアクションを解除' : 'リアクションを付ける'
        }`}
        disabled={busy}
        className={cn(
          'inline-flex h-7 items-center gap-1 rounded-full border px-2 text-caption font-medium shadow-sm transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:border-border disabled:bg-muted disabled:text-disabled-foreground disabled:shadow-none data-[pressed]:bg-accent',
          reaction.reactedByMe
            ? 'border-primary bg-primary/10 text-primary hover:bg-primary/15'
            : 'border-border bg-material-thin text-muted-foreground hover:bg-accent hover:text-foreground',
        )}
        {...pressProps}
        animate={shouldReduceMotion
          ? { opacity: isPressed ? 0.78 : 1 }
          : { scale: isPressed ? 0.96 : 1 }}
        transition={shouldReduceMotion ? { duration: 0.1 } : springPresets.snap}
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
      </m.button>
      <AnimatePresence>
        {showTooltip ? (
          <m.span
            id={tooltipId}
            role="tooltip"
            initial={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 3 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={shouldReduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.94, y: 3 }}
            transition={shouldReduceMotion ? { duration: 0.12, ease: 'easeOut' } : springPresets.snap}
            style={{ transformOrigin: 'bottom center' }}
            className="material-thin pointer-events-none absolute bottom-full left-1/2 z-40 mb-1 w-max max-w-64 -translate-x-1/2 rounded-lg px-2 py-1 text-caption text-foreground shadow-sm"
          >
            {reactorLabel(reaction)}
          </m.span>
        ) : null}
      </AnimatePresence>
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
