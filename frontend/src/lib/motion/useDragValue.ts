import { useCallback, useEffect, useRef, useState, type PointerEvent, type PointerEventHandler } from 'react'
import { animate, useMotionValue, useReducedMotion, type Transition } from 'motion/react'
import { calculateVelocity, projectMomentum, rubberBandPosition, type PositionSample } from './gesture'
import { momentumSpring, springPresets } from './springs'

export type DragDirection = 'negative' | 'positive' | null

export type DragRelease = {
  velocity: number
  target: number
  transition: Transition
}

type UseDragValueOptions = {
  initialValue: number
  min: number
  max: number
  axis?: 'x' | 'y'
  /** 右寄せ要素の左端をつかむ場合など、ポインタの移動方向と値の増減が逆になるとき true。 */
  invert?: boolean
  dimension?: number
  threshold?: number
  snapPoints?: readonly number[]
  onChange?: (value: number) => void
  onCommit?: (value: number) => void
  onRelease?: (release: DragRelease) => void
}

function coordinate(event: PointerEvent<HTMLElement>, axis: 'x' | 'y', sign: 1 | -1) {
  return sign * (axis === 'x' ? event.clientX : event.clientY)
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value))
}

function nearest(value: number, candidates: readonly number[]) {
  return candidates.reduce((closest, candidate) => (
    Math.abs(candidate - value) < Math.abs(closest - value) ? candidate : closest
  ))
}

export function useDragValue({
  initialValue,
  min,
  max,
  axis = 'x',
  invert = false,
  dimension = max - min,
  threshold = 10,
  snapPoints,
  onChange,
  onCommit,
  onRelease,
}: UseDragValueOptions) {
  const sign: 1 | -1 = invert ? -1 : 1
  const value = useMotionValue(initialValue)
  const shouldReduceMotion = useReducedMotion()
  const [isDragging, setDragging] = useState(false)
  const [direction, setDirection] = useState<DragDirection>(null)
  const activePointer = useRef<number | null>(null)
  const grabOffset = useRef(0)
  const pointerOrigin = useRef(0)
  const samples = useRef<PositionSample[]>([])
  const animation = useRef<{ stop: () => void; then?: (callback: () => void) => unknown } | null>(null)
  const settling = useRef(false)

  useEffect(() => {
    if (activePointer.current !== null || settling.current) return
    value.set(initialValue)
  }, [initialValue, value])

  useEffect(() => () => animation.current?.stop(), [])

  const record = useCallback((position: number, time: number) => {
    samples.current = [...samples.current.slice(-4), { position, time }]
  }, [])

  const updateFromPointer = useCallback((event: PointerEvent<HTMLElement>) => {
    const point = coordinate(event, axis, sign)
    const raw = point - grabOffset.current
    const next = rubberBandPosition(raw, { min, max, dimension })
    value.set(next)
    onChange?.(next)
    record(point, event.timeStamp)

    const delta = point - pointerOrigin.current
    setDirection(Math.abs(delta) < threshold ? null : delta < 0 ? 'negative' : 'positive')
    return next
  }, [axis, dimension, max, min, onChange, record, sign, threshold, value])

  const settle = useCallback((velocity: number) => {
    const projected = projectMomentum(value.get(), velocity)
    const target = snapPoints && snapPoints.length > 0
      ? clamp(nearest(projected, snapPoints), min, max)
      : clamp(projected, min, max)
    const transition = momentumSpring(velocity)

    onCommit?.(target)
    onRelease?.({ velocity, target, transition })

    animation.current?.stop()
    if (shouldReduceMotion) {
      value.set(target)
      onChange?.(target)
      settling.current = false
    } else {
      settling.current = true
      const controls = animate(value, target, transition)
      animation.current = controls
      void controls.then(() => {
        settling.current = false
      })
    }
  }, [max, min, onChange, onCommit, onRelease, shouldReduceMotion, snapPoints, value])

  const finish = useCallback((event: PointerEvent<HTMLElement>, cancelled: boolean) => {
    if (activePointer.current !== event.pointerId) return

    if (!cancelled) updateFromPointer(event)
    const velocity = cancelled ? 0 : calculateVelocity(samples.current)
    activePointer.current = null
    setDragging(false)
    setDirection(null)
    event.currentTarget.releasePointerCapture?.(event.pointerId)
    settle(velocity)
  }, [settle, updateFromPointer])

  const handlePointerDown = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (event.button !== 0) return

    animation.current?.stop()
    settling.current = false
    const point = coordinate(event, axis, sign)
    activePointer.current = event.pointerId
    pointerOrigin.current = point
    grabOffset.current = point - value.get()
    samples.current = []
    record(point, event.timeStamp)
    setDragging(true)
    setDirection(null)
    event.currentTarget.setPointerCapture?.(event.pointerId)
  }, [axis, record, sign, value])

  const handlePointerMove = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (activePointer.current === event.pointerId) updateFromPointer(event)
  }, [updateFromPointer])

  const handlePointerUp = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    finish(event, false)
  }, [finish])

  const handlePointerCancel = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    finish(event, true)
  }, [finish])

  const handleLostPointerCapture = useCallback<PointerEventHandler<HTMLElement>>((event) => {
    if (activePointer.current === event.pointerId) finish(event, true)
  }, [finish])

  return {
    value,
    isDragging,
    direction,
    shouldReduceMotion: Boolean(shouldReduceMotion),
    dragProps: {
      'data-dragging': isDragging ? '' : undefined,
      onPointerDown: handlePointerDown,
      onPointerMove: handlePointerMove,
      onPointerUp: handlePointerUp,
      onPointerCancel: handlePointerCancel,
      onLostPointerCapture: handleLostPointerCapture,
    },
    settleTransition: shouldReduceMotion ? { duration: 0 } : springPresets.momentum,
  }
}
