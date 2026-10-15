import { describe, expect, it } from 'vitest'

import { timedTerminalScenario } from '../testFixtures/timedTerminalScenario'
import { createRaceEvolution } from './raceEvolution'

describe('race evolution data', () => {
  it('uses Phase 8 authoritative traffic rank rather than deriving a second VM rank', () => {
    const scenario = { raceLaps: 2, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 2, entities: [{ driverId: 'SYN_001', paceSecondsPerLap: 81, entityType: 'synthetic' }] }, trafficAdjusted: { rankTrajectory: [{ lap: 0, rank: 2, raceTimeSeconds: 1.5, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 0 }, { lap: 1, rank: 2, raceTimeSeconds: 83, trafficCostSeconds: 2, cumulativeTrafficCostSeconds: 2 }, { lap: 2, rank: 1, raceTimeSeconds: 163, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 2 }] } } as never
    const evolution = createRaceEvolution(scenario, 'TRAFFIC_ADJUSTED')!
    expect(evolution.virtualMax.map((point) => point.rank)).toEqual([2, 2, 1])
    expect(evolution.virtualMax.map((point) => point.gapToVmSeconds)).toEqual([0, 0, 0])
    expect(evolution.trajectories.SYN_001[1].gapToVmSeconds).toBe(2)
  })

  it('keeps every Pure Timing and Traffic Adjusted trajectory inside the 101-entity rank universe', () => {
    const entities = Array.from({ length: 100 }, (_, index) => ({
      driverId: `SYN_${String(index + 1).padStart(3, '0')}`,
      paceSecondsPerLap: 80 + index / 100,
      entityType: 'synthetic' as const,
    }))
    const scenario = {
      raceLaps: 3, virtualMaxPace: 79.8, startingDelaySeconds: 1.5,
      syntheticReplay: { raceLaps: 3, entities },
      trafficAdjusted: { rankTrajectory: [
        { lap: 0, rank: 101, raceTimeSeconds: 1.5, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 0 },
        { lap: 1, rank: 33, raceTimeSeconds: 82, trafficCostSeconds: 1, cumulativeTrafficCostSeconds: 1 },
        { lap: 2, rank: 19, raceTimeSeconds: 162, trafficCostSeconds: 1, cumulativeTrafficCostSeconds: 2 },
        { lap: 3, rank: 1, raceTimeSeconds: 242, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 2 },
      ] },
    } as never
    for (const model of ['PURE_TIMING', 'TRAFFIC_ADJUSTED'] as const) {
      const evolution = createRaceEvolution(scenario, model)!
      const ranks = [
        ...evolution.virtualMax.map((point) => point.rank),
        ...Object.values(evolution.trajectories).flatMap((points) => points.map((point) => point.rank)),
      ]
      expect(Math.min(...ranks)).toBeGreaterThanOrEqual(1)
      expect(Math.max(...ranks)).toBeLessThanOrEqual(entities.length + 1)
      expect(Math.max(...ranks)).toBe(101)
    }
  })

  it('keeps the terminal Pure Timing rank aligned with finish-time ordering', () => {
    const scenario = {
      raceLaps: 2, virtualMaxPace: 1, startingDelaySeconds: .5,
      syntheticReplay: { raceLaps: 2, entities: [{ driverId: 'SYN_EARLY', paceSecondsPerLap: 1, raceDurationSeconds: 2, lapTimes: [1, 1], entityType: 'synthetic' }] },
      pureTiming: { rankTrajectory: [{ lap: 1, rank: 2, raceTimeSeconds: 1.5, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 0 }, { lap: 2, rank: 2, raceTimeSeconds: 2.5, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 0 }] },
    } as never
    expect(createRaceEvolution(scenario, 'PURE_TIMING')!.virtualMax.at(-1)?.rank).toBe(2)
  })

  it('carries backend-authoritative TIMED_RACE final ranks into terminal evolution points', () => {
    const evolution = createRaceEvolution(timedTerminalScenario(), 'PURE_TIMING')!
    expect(evolution.trajectories.SYN_A.at(-1)?.rank).toBe(1)
    expect(evolution.virtualMax.at(-1)?.rank).toBe(2)
  })
})
