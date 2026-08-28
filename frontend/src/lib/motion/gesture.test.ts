import { describe, expect, it } from 'vitest'
import { calculateVelocity, projectMomentum, rubberBandPosition } from './gesture'

describe('gesture calculations', () => {
  it('calculates release velocity from the most recent frames', () => {
    expect(calculateVelocity([
      { position: -100, time: 0 },
      { position: 0, time: 900 },
      { position: 20, time: 1_000 },
    ])).toBe(200)
  })

  it('projects a faster release farther in its direction of travel', () => {
    const slow = projectMomentum(100, 100)
    const fast = projectMomentum(100, 500)

    expect(slow).toBeCloseTo(149.9, 5)
    expect(fast).toBeCloseTo(349.5, 5)
    expect(fast).toBeGreaterThan(slow)
  })

  it('progressively damps movement after a boundary', () => {
    const damped = rubberBandPosition(120, { min: 0, max: 100, dimension: 100 })

    expect(damped).toBeCloseTo(109.9099, 4)
    expect(damped).toBeGreaterThan(100)
    expect(damped).toBeLessThan(120)
  })

  it('does not damp values within the boundaries', () => {
    expect(rubberBandPosition(50, { min: 0, max: 100, dimension: 100 })).toBe(50)
  })
})
