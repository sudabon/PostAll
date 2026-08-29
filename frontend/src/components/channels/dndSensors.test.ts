import { describe, expect, it } from 'vitest'
import { channelTreeSensorConstraints, DND_DISTANCE_PX, NARROW_DND_DELAY_MS } from './dndSensors'

describe('channelTreeSensorConstraints', () => {
  it('starts mouse drag after a short distance on a wide viewport', () => {
    expect(channelTreeSensorConstraints(true)).toEqual({
      mouse: { activationConstraint: { distance: DND_DISTANCE_PX } },
      touch: { activationConstraint: { distance: DND_DISTANCE_PX } },
    })
  })

  it('requires a long press before touch drag on a narrow viewport', () => {
    const { touch } = channelTreeSensorConstraints(false)
    expect(touch.activationConstraint).toEqual({
      delay: NARROW_DND_DELAY_MS,
      tolerance: 8,
    })
    expect(NARROW_DND_DELAY_MS).toBe(250)
  })
})
