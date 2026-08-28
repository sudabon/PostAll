export type PositionSample = {
  position: number
  time: number
}

const VELOCITY_WINDOW_MS = 120
const VELOCITY_SAMPLE_COUNT = 5
const DEFAULT_DECELERATION_RATE = 0.998
const DEFAULT_RUBBER_BAND_CONSTANT = 0.55

export function calculateVelocity(samples: readonly PositionSample[]): number {
  if (samples.length < 2) return 0

  const latest = samples[samples.length - 1]
  const recent = samples
    .slice(-VELOCITY_SAMPLE_COUNT)
    .filter((sample) => latest.time - sample.time <= VELOCITY_WINDOW_MS)
  const earliest = recent.find((sample) => sample.time < latest.time)
  if (!earliest) return 0

  return ((latest.position - earliest.position) / (latest.time - earliest.time)) * 1_000
}

export function projectMomentum(
  current: number,
  velocity: number,
  decelerationRate = DEFAULT_DECELERATION_RATE,
): number {
  return current + (velocity / 1_000) * decelerationRate / (1 - decelerationRate)
}

export function rubberBandPosition(
  value: number,
  {
    min,
    max,
    dimension,
    constant = DEFAULT_RUBBER_BAND_CONSTANT,
  }: {
    min: number
    max: number
    dimension: number
    constant?: number
  },
): number {
  if (value >= min && value <= max) return value

  const boundary = value < min ? min : max
  const overshoot = value - boundary
  const safeDimension = Math.max(dimension, 1)
  const resisted = (overshoot * safeDimension * constant)
    / (safeDimension + constant * Math.abs(overshoot))
  return boundary + resisted
}
