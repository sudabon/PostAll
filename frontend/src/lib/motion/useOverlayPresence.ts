import { useCallback, useEffect, useMemo, useRef, useState, type SyntheticEvent } from 'react'
import { useReducedMotion, type MotionProps } from 'motion/react'
import { springPresets } from './springs'

type UseOverlayPresenceOptions = {
  open: boolean
  onClose: () => void
}

const crossFade = { duration: 0.14, ease: 'easeOut' } as const

export function useOverlayPresence({ open, onClose }: UseOverlayPresenceOptions) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const openRef = useRef(open)
  const [previousOpen, setPreviousOpen] = useState(open)
  const [isExiting, setIsExiting] = useState(false)
  const shouldReduceMotion = useReducedMotion()

  if (open !== previousOpen) {
    setPreviousOpen(open)
    setIsExiting(!open)
  }

  useEffect(() => {
    openRef.current = open
  }, [open])

  const shouldRender = open || isExiting
  useEffect(() => {
    const dialog = dialogRef.current
    if (shouldRender && dialog && !dialog.open) dialog.showModal()
  }, [shouldRender])

  const onExitComplete = useCallback(() => {
    if (openRef.current) return false

    const dialog = dialogRef.current
    if (dialog?.open) dialog.close()
    setIsExiting(false)
    return true
  }, [])

  const onCancel = useCallback((event: SyntheticEvent<HTMLDialogElement>) => {
    event.preventDefault()
    onClose()
  }, [onClose])

  const motionProps = useMemo((): { surface: MotionProps; backdrop: MotionProps } => {
    if (shouldReduceMotion) {
      return {
        surface: {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: crossFade,
        },
        backdrop: {
          initial: { opacity: 0 },
          animate: { opacity: 1 },
          exit: { opacity: 0 },
          transition: crossFade,
        },
      }
    }

    return {
      surface: {
        initial: { opacity: 0, scale: 0.96, filter: 'blur(14px)' },
        animate: { opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: { opacity: 0, scale: 0.96, filter: 'blur(14px)' },
        transition: springPresets.snap,
      },
      backdrop: {
        initial: { opacity: 0 },
        animate: { opacity: 1 },
        exit: { opacity: 0 },
        transition: springPresets.snap,
      },
    }
  }, [shouldReduceMotion])

  return {
    dialogRef,
    shouldRender,
    isPresent: open,
    shouldReduceMotion: Boolean(shouldReduceMotion),
    onCancel,
    onExitComplete,
    motionProps,
  }
}
