import { useCallback, useRef, useState, type PointerEvent, type PointerEventHandler } from 'react'
import { useReducedMotion } from 'motion/react'

type UsePressableOptions<T extends HTMLElement> = {
  disabled?: boolean
  hitPadding?: number
  /** タッチで「動いていない」とみなす許容量（px） */
  moveTolerance?: number
  onPress?: (event: PointerEvent<T>) => void
  onPointerDown?: PointerEventHandler<T>
  onPointerMove?: PointerEventHandler<T>
  onPointerUp?: PointerEventHandler<T>
  onPointerCancel?: PointerEventHandler<T>
  onLostPointerCapture?: PointerEventHandler<T>
}

function isInside<T extends HTMLElement>(event: PointerEvent<T>, hitPadding: number) {
  const bounds = event.currentTarget.getBoundingClientRect()
  return event.clientX >= bounds.left - hitPadding
    && event.clientX <= bounds.right + hitPadding
    && event.clientY >= bounds.top - hitPadding
    && event.clientY <= bounds.bottom + hitPadding
}

/**
 * タッチは要素の現在位置ではなく「指が動いていないか」で判定する。
 * 押下から離すまでの間にタイムラインが再描画やスクロールで動くと、
 * 指はそのままでも要素が下から抜けてしまい、押したのに反応しない状態になる。
 */
function hasHeldStill<T extends HTMLElement>(
  event: PointerEvent<T>,
  start: { x: number; y: number } | null,
  tolerance: number,
) {
  if (!start) return false
  return Math.abs(event.clientX - start.x) <= tolerance && Math.abs(event.clientY - start.y) <= tolerance
}

export function usePressable<T extends HTMLElement>({
  disabled = false,
  hitPadding = 10,
  moveTolerance = 12,
  onPress,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
}: UsePressableOptions<T> = {}) {
  const [isPressed, setPressed] = useState(false)
  const activePointer = useRef<number | null>(null)
  const isWithinBounds = useRef(false)
  const startPoint = useRef<{ x: number; y: number } | null>(null)
  const shouldReduceMotion = useReducedMotion()

  const reset = useCallback(() => {
    activePointer.current = null
    isWithinBounds.current = false
    startPoint.current = null
    setPressed(false)
  }, [])

  const isStillOnTarget = useCallback(
    (event: PointerEvent<T>) =>
      event.pointerType === 'touch'
        ? hasHeldStill(event, startPoint.current, moveTolerance)
        : isInside(event, hitPadding),
    [hitPadding, moveTolerance],
  )

  const handlePointerDown = useCallback<PointerEventHandler<T>>((event) => {
    onPointerDown?.(event)
    if (disabled || event.defaultPrevented || event.button !== 0) return

    activePointer.current = event.pointerId
    isWithinBounds.current = true
    startPoint.current = { x: event.clientX, y: event.clientY }
    setPressed(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [disabled, onPointerDown])

  const handlePointerMove = useCallback<PointerEventHandler<T>>((event) => {
    onPointerMove?.(event)
    if (activePointer.current !== event.pointerId) return

    const inside = isStillOnTarget(event)
    isWithinBounds.current = inside
    setPressed(inside)
  }, [isStillOnTarget, onPointerMove])

  const handlePointerUp = useCallback<PointerEventHandler<T>>((event) => {
    onPointerUp?.(event)
    if (activePointer.current !== event.pointerId) return

    const inside = isStillOnTarget(event)
    if (inside && isWithinBounds.current) onPress?.(event)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    reset()
  }, [isStillOnTarget, onPointerUp, onPress, reset])

  const handlePointerCancel = useCallback<PointerEventHandler<T>>((event) => {
    onPointerCancel?.(event)
    if (activePointer.current === event.pointerId) reset()
  }, [onPointerCancel, reset])

  const handleLostPointerCapture = useCallback<PointerEventHandler<T>>((event) => {
    onLostPointerCapture?.(event)
    if (activePointer.current === event.pointerId) reset()
  }, [onLostPointerCapture, reset])

  return {
    isPressed,
    shouldReduceMotion: Boolean(shouldReduceMotion),
    pressProps: {
      'data-pressed': isPressed ? '' : undefined,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
    },
  }
}
