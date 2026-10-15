import { describe, expect, it } from 'vitest'

import { getNextTargets, NEXT_TARGETS_LIMIT } from './nextTargets'

const entity = (driverId: string, gap: number, caught = false, catchTime: number | null = null) => ({
  driverId, raceDistance: 10 + gap / 1000, gapToVirtualMaxMeters: gap, caughtByVirtualMax: caught, timingCatchTimeSeconds: catchTime,
})

describe('getNextTargets', () => {
  it('uses the replay catch state and sorts only positive reconstructed gaps ahead', () => {
    const result = getNextTargets({
      entities: [entity('SYN_080', 2.1), entity('SYN_079', 3.8), entity('SYN_081', -1, true, 22), entity('SYN_077', 7.4)],
      virtualMaxRaceDistance: 10,
      replayTime: 25,
    })
    expect(result.targets.map((target) => target.driverId)).toEqual(['SYN_080', 'SYN_079', 'SYN_077'])
    expect(result.nextTarget?.driverId).toBe('SYN_080')
    expect(result.lastCatch?.driverId).toBe('SYN_081')
    expect(result).toMatchObject({ caughtCount: 1, uncaughtTargetCount: 3 })
  })

  it('keeps timing-catch history separate from a current rank calculation', () => {
    const result = getNextTargets({ entities: [entity('SYN_001', -2, true, 5)], virtualMaxRaceDistance: 10, replayTime: 6, limit: NEXT_TARGETS_LIMIT })
    expect(result.targets).toEqual([])
    expect(result.nextTarget).toBeNull()
    expect(result).toMatchObject({ caughtCount: 1, uncaughtTargetCount: 0 })
  })
})
