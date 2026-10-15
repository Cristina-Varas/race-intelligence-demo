import { describe, expect, it } from 'vitest'

import { deriveFixedLapTiming, formatRaceTime } from './raceTiming'

describe('fixed-lap race timing', () => {
  it('formats durations below and above one hour', () => {
    expect(formatRaceTime(2404.44)).toBe('40:04.4')
    expect(formatRaceTime(3734.7)).toBe('1:02:14.7')
  })

  it('applies positive and negative delay to the common race clock', () => {
    const zero = deriveFixedLapTiming({ raceLaps: 30, virtualMaxPace: 80.098, startingDelaySeconds: 0, driverPaces: [80.293] })
    const late = deriveFixedLapTiming({ raceLaps: 30, virtualMaxPace: 80.098, startingDelaySeconds: 1.5, driverPaces: [80.293] })
    const early = deriveFixedLapTiming({ raceLaps: 30, virtualMaxPace: 80.098, startingDelaySeconds: -1.5, driverPaces: [80.293] })
    expect(zero.projectedFinishTimeSeconds).toBeCloseTo(2402.94)
    expect(late.projectedFinishTimeSeconds).toBeCloseTo(zero.projectedFinishTimeSeconds + 1.5)
    expect(early.projectedFinishTimeSeconds).toBeCloseTo(zero.projectedFinishTimeSeconds - 1.5)
    expect(late.fullFieldCatchTimeSeconds).not.toBeNull()
    expect(late.fullFieldCatchTimeSeconds!).toBeLessThanOrEqual(late.projectedFinishTimeSeconds)
  })

  it('does not make Virtual Max finish time depend on field mode inputs', () => {
    const observed = deriveFixedLapTiming({ raceLaps: 30, virtualMaxPace: 80.098, startingDelaySeconds: 1.5, driverPaces: [80.293, 80.488] })
    const synthetic = deriveFixedLapTiming({ raceLaps: 30, virtualMaxPace: 80.098, startingDelaySeconds: 1.5, driverPaces: [80.293, 80.4, 80.488, 80.7] })
    expect(observed.projectedFinishTimeSeconds).toBe(synthetic.projectedFinishTimeSeconds)
  })

  it('returns a null catch time when one driver cannot be timing-caught', () => {
    const timing = deriveFixedLapTiming({ raceLaps: 30, virtualMaxPace: 80.098, startingDelaySeconds: 1.5, driverPaces: [79.9] })
    expect(timing.fullFieldCaught).toBe(false)
    expect(timing.fullFieldCatchTimeSeconds).toBeNull()
  })
})
