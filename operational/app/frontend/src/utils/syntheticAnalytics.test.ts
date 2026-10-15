import { describe, expect, it } from 'vitest'

import { delayRankSensitivity, empiricalPercentile, syntheticAnalytics } from './syntheticAnalytics'

const drivers = [
  { driverId: 'SYN_001', lapTimeSeconds: 80, raceDurationSeconds: 240 },
  { driverId: 'SYN_002', lapTimeSeconds: 81, raceDurationSeconds: 243 },
  { driverId: 'SYN_003', lapTimeSeconds: 82, raceDurationSeconds: 246 },
  { driverId: 'SYN_004', lapTimeSeconds: 83, raceDurationSeconds: 249 },
]

describe('synthetic comparative analytics', () => {
  it('calculates deterministic empirical percentiles and VM comparison rank without counting VM in the field', () => {
    const analytics = syntheticAnalytics(drivers, 3, 81.5, 0)
    expect(analytics.durations).toEqual([240, 243, 246, 249])
    expect(analytics.rank).toBe(3)
    expect(analytics.ahead).toBe(2)
    expect(analytics.behind).toBe(2)
    expect(analytics.percentile).toBe(50)
    expect(analytics.median).toBe(244.5)
    expect(analytics.percentiles.p10).toBeCloseTo(240.9)
    expect(analytics.percentiles.p90).toBeCloseTo(248.1)
  })

  it('moves comparison rank deterministically across the maximum-delay limit', () => {
    const sweep = delayRankSensitivity(drivers, 3, 81.5, 5.85)
    expect(sweep).toHaveLength(13)
    expect(sweep[0].delaySeconds).toBe(-4.15)
    expect(sweep.at(-1)?.delaySeconds).toBe(20.85)
    expect(sweep.some((point) => point.delaySeconds < 5.85)).toBe(true)
    expect(sweep.some((point) => point.delaySeconds > 5.85)).toBe(true)
    expect(sweep[0].rank).toBeLessThanOrEqual(sweep.at(-1)!.rank)
    expect(empiricalPercentile([], .5)).toBeNull()
  })
})
