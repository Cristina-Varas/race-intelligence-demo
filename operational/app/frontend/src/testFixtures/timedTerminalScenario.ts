import type { CustomSimulationResult } from '../types/raceIntelligence'

/** Backend terminal order deliberately conflicts with capped live progress. */
export function timedTerminalScenario(): CustomSimulationResult {
  return {
    mode: 'custom', scenarioType: 'SYNTHETIC WHAT-IF', fieldMode: 'synthetic_100', fieldLabel: 'fixture', fieldSize: 2, fieldEvidenceType: 'SYNTHETIC', raceLaps: 45, simulations: 0,
    fastestObservedPace: 80, virtualMaxAdvantageSecondsPerLap: .195, virtualMaxPace: 80, startingDelaySeconds: 0, deterministicMaxDelaySeconds: 0, fullFieldCatchProbability: 0, thresholds: { p50: null, p80: null, p90: null }, probabilityCurve: [], drivers: [], caveats: [],
    timing: { raceFormat: 'FIXED_LAP', projectedFinishTimeSeconds: 3605, projectedFinishLap: 45, fullFieldCatchTimeSeconds: null, fullFieldCatchLap: null, fullFieldCaught: false },
    raceFormat: { mode: 'TIMED_RACE', durationSeconds: 3600, finishRule: 'COMPLETE_CURRENT_LAP' },
    terminalState: { raceFormat: 'TIMED_RACE', raceClockExpirySeconds: 3600, finishRule: 'COMPLETE_CURRENT_LAP', entities: [
      { entityId: 'SYN_A', completedLaps: 46, finishLap: 46, finishTimeSeconds: 3670, finalRank: 1, finished: true },
      { entityId: 'VIRTUAL MAX', completedLaps: 45, finishLap: 45, finishTimeSeconds: 3605, finalRank: 2, finished: true },
      { entityId: 'SYN_B', completedLaps: 44, finishLap: 44, finishTimeSeconds: 3601, finalRank: 3, finished: true },
    ], virtualMax: { completedLaps: 45, finishLap: 45, finishTimeSeconds: 3605, finalRank: 2 }, fieldSummary: { maxCompletedLaps: 46, minCompletedLaps: 44, distinctCompletedLapCounts: 3 } },
    syntheticReplay: { method: 'seeded_historical_lap_variability', seed: 42, populationId: 'fixture', scenarioId: 'timed-terminal', raceLaps: 45, fieldSize: 2, grid: { kind: 'ILLUSTRATIVE_SYNTHETIC_STARTING_GRID', ordering: 'nominal_pace_ascending', frontOffsetMeters: 5, spacingMeters: 5, lastOffsetMeters: 10, totalLengthMeters: 5 }, caveat: 'fixture', entities: [
      // At the final local sample these deliberately look behind VM; terminalState must win.
      { driverId: 'SYN_A', entityType: 'synthetic', gridPosition: 1, paceSecondsPerLap: 81, lapTimeSeconds: 81, raceDurationSeconds: 3670, gridOffsetMeters: 5, initialRaceDistanceMeters: -5, routeId: 'main', replayDirection: 'reverse', timingCatchTimeSeconds: null, lapTimes: Array(46).fill(81) },
      { driverId: 'SYN_B', entityType: 'synthetic', gridPosition: 2, paceSecondsPerLap: 82, lapTimeSeconds: 82, raceDurationSeconds: 3601, gridOffsetMeters: 10, initialRaceDistanceMeters: -10, routeId: 'main', replayDirection: 'reverse', timingCatchTimeSeconds: null, lapTimes: Array(44).fill(82) },
    ] },
  } as CustomSimulationResult
}
