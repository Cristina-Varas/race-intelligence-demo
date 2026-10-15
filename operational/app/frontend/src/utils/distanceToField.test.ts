import { describe, expect, it } from 'vitest'

import { fieldGapBarWidth, getDistanceToField } from './distanceToField'
import { getNextTargets } from './nextTargets'

const row = (driverId: string, gapToVirtualMaxMeters: number, caughtByVirtualMax = false) => ({ driverId, gapToVirtualMaxMeters, raceDistance: 4 + gapToVirtualMaxMeters / 100, caughtByVirtualMax })

describe('distance to field selector', () => {
  it('keeps only active ahead drivers, ordered from leader to nearest target', () => {
    const result = getDistanceToField([row('SYN_080', 2.1), row('SYN_074', 26), row('SYN_081', -1, true), row('SYN_079', 3.8)], 4)
    expect(result.ahead.map((item) => item.driverId)).toEqual(['SYN_074', 'SYN_079', 'SYN_080'])
    expect(result.leader?.driverId).toBe('SYN_074')
    expect(result.leaderGapToVMMeters).toBe(26)
    expect(result.nextTarget?.driverId).toBe('SYN_080')
  })

  it('scales bars to leader-relative reconstructed gap and handles clear track', () => {
    expect(fieldGapBarWidth(26, 26)).toBe(1)
    expect(fieldGapBarWidth(2.1, 26)).toBeCloseTo(2.1 / 26)
    expect(fieldGapBarWidth(.01, 26)).toBe(.025)
    expect(getDistanceToField([row('SYN_001', -2, true)], 4)).toMatchObject({ ahead: [], leader: null, nextTarget: null, leaderGapToVMMeters: null })
  })

  it('uses the same nearest target as Next Targets', () => {
    const entities = [
      { ...row('SYN_074', 26), timingCatchTimeSeconds: null },
      { ...row('SYN_080', 2.1), timingCatchTimeSeconds: null },
    ]
    expect(getDistanceToField(entities, 4).nextTarget?.driverId).toBe(getNextTargets({ entities, virtualMaxRaceDistance: 4, replayTime: 10 }).nextTarget?.driverId)
  })
})
