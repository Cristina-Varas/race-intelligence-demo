import type { CustomSimulationResult, RaceModelMode } from '../types/raceIntelligence'
import { createRaceEvolution, type EvolutionPoint } from './raceEvolution'

export interface ParticipantRaceCardData {
  identity: { driverId: string; kartNumber: number | null; displayName: string | null; scenarioId: string | null; fieldMode: string; raceModelMode: RaceModelMode; synthetic: boolean }
  result: { startPosition: number; finalPosition: number; bestPosition: number; worstPosition: number; lapsCompleted: number; positionsGained: number }
  pace: { nominalLapSeconds: number; pacePercentile: number; finalPositionPercentile: number }
  fieldComparison: { heldOffPercentile: number | null; heldOffTopPercent: number | null; fieldMedianCatchLap: number | null; fieldMedianTimeAheadSeconds: number | null }
  virtualMaxInteraction: { firstTimingCatchLap: number | null; firstTimingCatchRaceProgress: number | null; firstTimingCatchTimeSeconds: number | null; firstClearLap: number | null; firstClearTimeSeconds: number | null; timeAheadOfVirtualMaxSeconds: number | null; closestGapToVirtualMaxSeconds: number | null; closestGapLap: number | null }
  trajectory: { positionTrajectory: EvolutionPoint[]; virtualMaxPositionTrajectory: EvolutionPoint[]; gapToVirtualMaxTrajectory: EvolutionPoint[]; chaseTrajectory: { progress: number; gapToVmSeconds: number; isTimingCatch?: boolean }[] }
  highlights: string[]
}

function percentile(index: number, total: number) { return total <= 1 ? 100 : Math.round((total - 1 - index) / (total - 1) * 100) }

export function buildParticipantRaceHighlights(card: Pick<ParticipantRaceCardData, 'identity' | 'result' | 'pace' | 'virtualMaxInteraction'>): string[] {
  const { result, virtualMaxInteraction: vm, pace } = card
  const highlights: string[] = []
  if (vm.firstTimingCatchRaceProgress !== null) highlights.push(`Held Virtual Max off for ${vm.firstTimingCatchRaceProgress.toFixed(1)} laps.`)
  if (vm.firstTimingCatchLap !== null) highlights.push(`Virtual Max timing-caught this kart on Lap ${vm.firstTimingCatchLap}.`)
  if (result.bestPosition < result.startPosition) highlights.push(`Reached a best position of P${result.bestPosition}.`)
  if (result.positionsGained > 0) highlights.push(`Gained ${result.positionsGained} positions during the race.`)
  else if (result.positionsGained < 0) highlights.push(`Position change: ${result.positionsGained}.`)
  if (pace.finalPositionPercentile >= 75) highlights.push('Finished in the top 25% of the field.')
  if (!highlights.length) highlights.push(`Started P${result.startPosition} and finished P${result.finalPosition}.`)
  return highlights.slice(0, 4)
}

/** Generic, deterministic post-race contract built from the active scenario only. */
export function buildParticipantRaceCard(scenario: CustomSimulationResult, driverId: string, mode: RaceModelMode = scenario.raceModel?.mode ?? 'PURE_TIMING'): ParticipantRaceCardData | null {
  const entities = scenario.syntheticReplay?.entities ?? scenario.syntheticReplay?.drivers ?? []
  const driver = entities.find((item) => item.driverId === driverId)
  const evolution = createRaceEvolution(scenario, mode)
  const positionTrajectory = evolution?.trajectories[driverId]
  if (!driver || !evolution || !positionTrajectory?.length) return null
  const gapToVirtualMaxTrajectory = positionTrajectory
  const paceValues = [...entities].sort((a, b) => (a.paceSecondsPerLap ?? a.lapTimeSeconds) - (b.paceSecondsPerLap ?? b.lapTimeSeconds))
  const paceIndex = paceValues.findIndex((item) => item.driverId === driverId)
  const startPosition = positionTrajectory[0].rank
  const terminalFinalPosition = scenario.terminalState?.raceFormat === 'TIMED_RACE'
    ? scenario.terminalState.entities.find((entity) => entity.entityId === driverId)?.finalRank
    : undefined
  const finalPosition = terminalFinalPosition ?? positionTrajectory.at(-1)!.rank
  const closest = gapToVirtualMaxTrajectory.reduce((best, point) => Math.abs(point.gapToVmSeconds) < Math.abs(best.gapToVmSeconds) ? point : best)
  const trafficEvent = scenario.trafficAdjusted?.clearanceEvents?.find((item) => entities[item.driverIndex]?.driverId === driverId)
  const exactTimingCatch = mode === 'TRAFFIC_ADJUSTED' ? trafficEvent?.timingCatchTimeSeconds ?? null : driver.timingCatchTimeSeconds ?? null
  const fieldCatchTimes = mode === 'TRAFFIC_ADJUSTED'
    ? (scenario.trafficAdjusted?.clearanceEvents ?? []).map((event) => event.timingCatchTimeSeconds).sort((a, b) => a - b)
    : entities.map((item) => item.timingCatchTimeSeconds).filter((value): value is number => value !== null && value !== undefined).sort((a, b) => a - b)
  const catchTime = exactTimingCatch
  const heldOffDurations = mode === 'TRAFFIC_ADJUSTED'
    ? entities.map((_, index) => scenario.trafficAdjusted?.clearanceEvents?.find((event) => event.driverIndex === index)?.timingCatchTimeSeconds ?? null)
    : entities.map((item) => item.timingCatchTimeSeconds ?? null)
  const strictlyShorterCount = catchTime === null
    ? heldOffDurations.filter((value) => value !== null).length
    : heldOffDurations.filter((value) => value !== null && value < catchTime).length
  const comparableOthers = Math.max(0, entities.length - 1)
  const median = fieldCatchTimes.length ? fieldCatchTimes[Math.floor(fieldCatchTimes.length / 2)] : null
  const raceClock = mode === 'TRAFFIC_ADJUSTED' ? [{ lap: 0, raceTimeSeconds: scenario.startingDelaySeconds }, ...(scenario.trafficAdjusted?.rankTrajectory ?? [])] : []
  const catchProgress = catchTime === null ? null : mode === 'PURE_TIMING'
    ? Math.max(0, Math.min(scenario.raceLaps, (catchTime - scenario.startingDelaySeconds) / scenario.virtualMaxPace))
    : (() => { const upper = raceClock.find((point) => point.raceTimeSeconds >= catchTime) ?? raceClock.at(-1); const index = upper ? raceClock.indexOf(upper) : -1; const lower = index > 0 ? raceClock[index - 1] : raceClock[0]; if (!upper || !lower || upper.raceTimeSeconds === lower.raceTimeSeconds) return upper?.lap ?? null; return lower.lap + (catchTime - lower.raceTimeSeconds) / (upper.raceTimeSeconds - lower.raceTimeSeconds) * (upper.lap - lower.lap) })()
  const catchLap = catchProgress === null ? null : Math.ceil(catchProgress)
  const chaseTrajectory: ParticipantRaceCardData['trajectory']['chaseTrajectory'] = gapToVirtualMaxTrajectory.map((point) => ({ progress: point.lap, gapToVmSeconds: point.gapToVmSeconds }))
  if (catchProgress !== null) {
    const insertion = { progress: catchProgress, gapToVmSeconds: 0, isTimingCatch: true }
    const exists = chaseTrajectory.some((point) => Math.abs(point.progress - catchProgress) < 1e-8)
    if (exists) { const point = chaseTrajectory.find((item) => Math.abs(item.progress - catchProgress) < 1e-8)!; point.gapToVmSeconds = 0; point.isTimingCatch = true }
    else chaseTrajectory.push(insertion)
    chaseTrajectory.sort((a, b) => a.progress - b.progress)
  }
  const card: ParticipantRaceCardData = {
    identity: { driverId, kartNumber: driver.gridPosition ?? null, displayName: null, scenarioId: scenario.syntheticReplay?.scenarioId ?? null, fieldMode: scenario.fieldMode, raceModelMode: mode, synthetic: scenario.fieldEvidenceType === 'SYNTHETIC' },
    result: { startPosition, finalPosition, bestPosition: Math.min(...positionTrajectory.map((point) => point.rank)), worstPosition: Math.max(...positionTrajectory.map((point) => point.rank)), lapsCompleted: scenario.raceLaps, positionsGained: startPosition - finalPosition },
    pace: { nominalLapSeconds: driver.paceSecondsPerLap ?? driver.lapTimeSeconds, pacePercentile: percentile(paceIndex, entities.length), finalPositionPercentile: percentile(finalPosition - 1, entities.length + 1) },
    // Higher is better: the share of OTHER participants with a strictly
    // shorter held-off duration. Equal catch times are ties, never drivers
    // this participant held off longer than.
    fieldComparison: { heldOffPercentile: comparableOthers ? Math.round(strictlyShorterCount / comparableOthers * 100) : 100, heldOffTopPercent: entities.length ? Math.ceil((entities.length - strictlyShorterCount) / entities.length * 100) : null, fieldMedianCatchLap: median === null ? null : Math.ceil((median - scenario.startingDelaySeconds) / scenario.virtualMaxPace), fieldMedianTimeAheadSeconds: median },
    virtualMaxInteraction: { firstTimingCatchLap: catchLap, firstTimingCatchRaceProgress: catchProgress, firstTimingCatchTimeSeconds: catchTime, firstClearLap: mode === 'TRAFFIC_ADJUSTED' ? trafficEvent?.lap ?? null : null, firstClearTimeSeconds: mode === 'TRAFFIC_ADJUSTED' ? trafficEvent?.clearTimeSeconds ?? null : null, timeAheadOfVirtualMaxSeconds: catchTime, closestGapToVirtualMaxSeconds: closest.gapToVmSeconds, closestGapLap: closest.lap },
    trajectory: { positionTrajectory, virtualMaxPositionTrajectory: evolution.virtualMax, gapToVirtualMaxTrajectory, chaseTrajectory }, highlights: [],
  }
  card.highlights = buildParticipantRaceHighlights(card)
  return card
}

export function raceCardPdfFilename(card: ParticipantRaceCardData) { return `max-v-100_${card.identity.driverId.replace(/[^a-zA-Z0-9_-]/g, '-')}_race-card.pdf` }
