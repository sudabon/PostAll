export const NARROW_DND_DELAY_MS = 250
export const DND_DISTANCE_PX = 6
export const NARROW_DND_TOLERANCE_PX = 8

export function channelTreeSensorConstraints(wide: boolean) {
  return {
    mouse: { activationConstraint: { distance: DND_DISTANCE_PX } },
    touch: wide
      ? { activationConstraint: { distance: DND_DISTANCE_PX } }
      : { activationConstraint: { delay: NARROW_DND_DELAY_MS, tolerance: NARROW_DND_TOLERANCE_PX } },
  }
}
