import { useCallback, useRef, useState, type PointerEvent, type PointerEventHandler } from 'react'
import { useReducedMotion } from 'motion/react'

type UsePressableOptions<T extends HTMLElement> = {
  disabled?: boolean
  hitPadding?: number
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

export function usePressable<T extends HTMLElement>({
  disabled = false,
  hitPadding = 10,
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
  const shouldReduceMotion = useReducedMotion()

  const reset = useCallback(() => {
    activePointer.current = null
    isWithinBounds.current = false
    setPressed(false)
  }, [])

  const handlePointerDown = useCallback<PointerEventHandler<T>>((event) => {
    onPointerDown?.(event)
    if (disabled || event.defaultPrevented || event.button !== 0) return

    activePointer.current = event.pointerId
    isWithinBounds.current = true
    setPressed(true)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [disabled, onPointerDown])

  const handlePointerMove = useCallback<PointerEventHandler<T>>((event) => {
    onPointerMove?.(event)
    if (activePointer.current !== event.pointerId) return

    const inside = isInside(event, hitPadding)
    isWithinBounds.current = inside
    setPressed(inside)
  }, [hitPadding, onPointerMove])

  const handlePointerUp = useCallback<PointerEventHandler<T>>((event) => {
    onPointerUp?.(event)
    if (activePointer.current !== event.pointerId) return

    const inside = isInside(event, hitPadding)
    if (inside && isWithinBounds.current) onPress?.(event)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    reset()
  }, [hitPadding, onPointerUp, onPress, reset])

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
