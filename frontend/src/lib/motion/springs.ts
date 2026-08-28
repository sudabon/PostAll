import type { Transition } from 'motion/react'

export const springPresets = {
  snap: {
    type: 'spring',
    bounce: 0,
    duration: 0.35,
  },
  sheet: {
    type: 'spring',
    bounce: 0.2,
    duration: 0.3,
  },
  momentum: {
    type: 'spring',
    bounce: 0.2,
    duration: 0.4,
  },
} as const satisfies Record<string, Transition>

export function momentumSpring(velocity: number): Transition {
  return { ...springPresets.momentum, velocity }
}
