import { describe, expect, it } from 'vitest'

import { timedTerminalScenario } from '../testFixtures/timedTerminalScenario'
import { buildParticipantRaceCard, buildParticipantRaceHighlights, raceCardPdfFilename } from './participantRaceCard'

function scenario() {
  return { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'TRAFFIC_ADJUSTED' }, raceLaps: 3, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { scenarioId: 'scenario-42', raceLaps: 3, entities: [
    { driverId: 'SYN_001', gridPosition: 1, paceSecondsPerLap: 80.3, timingCatchTimeSeconds: 81, entityType: 'synthetic' },
    { driverId: 'SYN_042', gridPosition: 2, paceSecondsPerLap: 81, timingCatchTimeSeconds: 161, entityType: 'synthetic' },
  ] }, trafficAdjusted: { rankTrajectory: [
    { lap: 0, rank: 3, raceTimeSeconds: 1.5, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 0 },
    { lap: 1, rank: 2, raceTimeSeconds: 82, trafficCostSeconds: 1, cumulativeTrafficCostSeconds: 1 },
    { lap: 2, rank: 1, raceTimeSeconds: 162, trafficCostSeconds: 1, cumulativeTrafficCostSeconds: 2 },
    { lap: 3, rank: 1, raceTimeSeconds: 242, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 2 },
  ], clearanceEvents: [{ driverIndex: 1, timingCatchTimeSeconds: 161, clearTimeSeconds: 162, trafficCostSeconds: 1, lap: 2 }] } }
}

describe('participant race card contract', () => {
  it('derives start/final/best/worst, pace, VM interaction and clear event from authoritative scenario data', () => {
    const card = buildParticipantRaceCard(scenario() as never, 'SYN_042', 'TRAFFIC_ADJUSTED')!
    expect(card.identity.driverId).toBe('SYN_042')
    expect(card.result.startPosition).toBeGreaterThanOrEqual(1)
    expect(card.result.finalPosition).toBeGreaterThanOrEqual(1)
    expect(card.result.bestPosition).toBeLessThanOrEqual(card.result.worstPosition)
    expect(card.result.lapsCompleted).toBe(3)
    expect(card.pace.nominalLapSeconds).toBe(81)
    expect(card.virtualMaxInteraction.firstClearLap).toBe(2)
    expect(card.virtualMaxInteraction.firstClearTimeSeconds).toBe(162)
    expect(card.virtualMaxInteraction.firstTimingCatchTimeSeconds!).toBeLessThanOrEqual(card.virtualMaxInteraction.firstClearTimeSeconds!)
    expect(card.fieldComparison.heldOffPercentile).toBe(0)
    expect(card.fieldComparison.fieldMedianCatchLap).toBe(2)
    expect(card.trajectory.positionTrajectory).toHaveLength(4)
    expect(card.trajectory.virtualMaxPositionTrajectory.map((point) => point.rank)).toEqual([3, 2, 1, 1])
    expect(raceCardPdfFilename(card)).toBe('max-v-100_SYN_042_race-card.pdf')
  })

  it('keeps Pure Timing card metrics in the Pure Timing model and injects the exact catch point', () => {
    const pure = buildParticipantRaceCard(scenario() as never, 'SYN_042', 'PURE_TIMING')!
    expect(pure.identity.raceModelMode).toBe('PURE_TIMING')
    expect(pure.virtualMaxInteraction.firstClearLap).toBeNull()
    expect(pure.virtualMaxInteraction.firstClearTimeSeconds).toBeNull()
    const catchPoint = pure.trajectory.chaseTrajectory.find((point) => point.isTimingCatch)
    expect(catchPoint?.gapToVmSeconds).toBe(0)
    expect(catchPoint?.progress).toBeCloseTo((161 - 1.5) / 80, 8)
    const catchIndex = pure.trajectory.chaseTrajectory.findIndex((point) => point.isTimingCatch)
    expect(pure.trajectory.chaseTrajectory[catchIndex - 1].gapToVmSeconds).toBeGreaterThan(0)
    expect(pure.trajectory.chaseTrajectory[catchIndex + 1].gapToVmSeconds).toBeLessThanOrEqual(0)
  })

  it('expresses chase percentile as other participants with strictly shorter held-off duration', () => {
    const entities = Array.from({ length: 10 }, (_, index) => ({ driverId: `SYN_${String(index + 1).padStart(3, '0')}`, gridPosition: index + 1, paceSecondsPerLap: 80.1 + index / 10, timingCatchTimeSeconds: 80 + (index + 1) * 10, entityType: 'synthetic' }))
    const rankedScenario = { ...scenario(), syntheticReplay: { ...scenario().syntheticReplay, entities } }
    // Earlier-than-median catch ranks below 50; later ranks above it. The
    // denominator is the other nine participants, never this participant.
    expect(buildParticipantRaceCard(rankedScenario as never, 'SYN_001', 'PURE_TIMING')!.fieldComparison.heldOffPercentile).toBe(0)
    expect(buildParticipantRaceCard(rankedScenario as never, 'SYN_005', 'PURE_TIMING')!.fieldComparison.heldOffPercentile).toBe(44)
    expect(buildParticipantRaceCard(rankedScenario as never, 'SYN_010', 'PURE_TIMING')!.fieldComparison.heldOffPercentile).toBe(100)
    const notCaught = { ...rankedScenario, syntheticReplay: { ...rankedScenario.syntheticReplay, entities: entities.map((entity, index) => index === 9 ? { ...entity, timingCatchTimeSeconds: undefined } : entity) } }
    expect(buildParticipantRaceCard(notCaught as never, 'SYN_010', 'PURE_TIMING')!.fieldComparison.heldOffPercentile).toBe(100)
  })

  it('does not count equal held-off durations as competitors held off longer', () => {
    const entities = Array.from({ length: 100 }, (_, index) => ({
      driverId: `SYN_${String(index + 1).padStart(3, '0')}`,
      gridPosition: index + 1,
      paceSecondsPerLap: 80 + index / 100,
      timingCatchTimeSeconds: index < 97 ? 100 + index : 1_000,
      entityType: 'synthetic',
    }))
    const tiedScenario = { ...scenario(), syntheticReplay: { ...scenario().syntheticReplay, entities } }
    const card = buildParticipantRaceCard(tiedScenario as never, 'SYN_098', 'PURE_TIMING')!
    expect(card.fieldComparison.heldOffPercentile).toBe(98)
    expect(card.fieldComparison.heldOffTopPercent).toBe(3)
  })

  it('uses bounded, evidence-backed highlights and never calls a timing catch an overtake', () => {
    const card = buildParticipantRaceCard(scenario() as never, 'SYN_042', 'TRAFFIC_ADJUSTED')!
    expect(card.highlights.length).toBeLessThanOrEqual(5)
    expect(card.highlights.join(' ')).not.toMatch(/overtake/i)
    expect(buildParticipantRaceHighlights({ ...card, result: { ...card.result, positionsGained: -4 } }).join(' ')).toContain('Position change: -4.')
    const missing = buildParticipantRaceHighlights({ ...card, virtualMaxInteraction: { ...card.virtualMaxInteraction, firstTimingCatchLap: null } })
    expect(missing.join(' ')).not.toMatch(/timing-caught/i)
  })

  it('uses terminalState finalRank for a TIMED_RACE participant instead of conflicting local progress', () => {
    const card = buildParticipantRaceCard(timedTerminalScenario(), 'SYN_A', 'PURE_TIMING')!
    expect(card.result.finalPosition).toBe(1)
    expect(card.trajectory.positionTrajectory.at(-1)?.rank).toBe(1)
  })
})
