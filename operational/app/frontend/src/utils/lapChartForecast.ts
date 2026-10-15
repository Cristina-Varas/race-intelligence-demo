import type { CustomSimulationResult, SyntheticReplayDriver } from '../types/raceIntelligence'

export interface LapRankPoint { lap: number; rank: number; timingProgress: number }
export interface LapChartForecast { raceLaps: number; scenarioId: string; populationId: string; trajectories: Record<string, LapRankPoint[]>; virtualMax: LapRankPoint[] }

type TimingEntry = { driverId: string; timingProgress: number; entityType: 'synthetic' | 'virtual_max'; finishTimeSeconds?: number }

/** Shared timing ranking: visual grid offsets are deliberately excluded. */
export function rankTimingEntries(entries: TimingEntry[], raceLaps?: number): TimingEntry[] {
  return [...entries].sort((left, right) => {
    const leftFinished = raceLaps !== undefined && left.timingProgress >= raceLaps - 1e-9
    const rightFinished = raceLaps !== undefined && right.timingProgress >= raceLaps - 1e-9
    if (leftFinished !== rightFinished) return leftFinished ? -1 : 1
    if (leftFinished && rightFinished && left.finishTimeSeconds !== right.finishTimeSeconds) return (left.finishTimeSeconds ?? Number.POSITIVE_INFINITY) - (right.finishTimeSeconds ?? Number.POSITIVE_INFINITY)
    return right.timingProgress - left.timingProgress || (left.entityType === 'virtual_max' ? 1 : right.entityType === 'virtual_max' ? -1 : left.driverId.localeCompare(right.driverId))
  })
}

export function syntheticProgressAtTime(driver: SyntheticReplayDriver, timeSeconds: number, raceLaps: number) {
  const lapTimes = driver.lapTimes
  if (lapTimes?.length) {
    if (timeSeconds <= 0) return 0
    let elapsed = 0
    for (let index = 0; index < lapTimes.length; index += 1) {
      if (elapsed + lapTimes[index] >= timeSeconds) return Math.min(raceLaps, index + (timeSeconds - elapsed) / lapTimes[index])
      elapsed += lapTimes[index]
    }
    return raceLaps
  }
  return Math.min(raceLaps, Math.max(0, timeSeconds / driver.paceSecondsPerLap))
}

export function createLapChartForecast(scenario: CustomSimulationResult): LapChartForecast | null {
  const replay = scenario.syntheticReplay
  if (!replay?.entities?.length) return null
  const trajectories: Record<string, LapRankPoint[]> = Object.fromEntries(replay.entities.map((driver) => [driver.driverId, []]))
  const virtualMax: LapRankPoint[] = []
  for (let lap = 0; lap <= replay.raceLaps; lap += 1) {
    const timeSeconds = lap === 0 ? 0 : scenario.startingDelaySeconds + lap * scenario.virtualMaxPace
    const vmProgress = Math.min(replay.raceLaps, Math.max(0, (timeSeconds - scenario.startingDelaySeconds) / scenario.virtualMaxPace))
    const ranked = rankTimingEntries([
      ...replay.entities.map((driver) => ({ driverId: driver.driverId, timingProgress: syntheticProgressAtTime(driver, timeSeconds, replay.raceLaps), finishTimeSeconds: driver.raceDurationSeconds ?? driver.lapTimes?.reduce((total, lapTime) => total + lapTime, 0) ?? driver.paceSecondsPerLap * replay.raceLaps, entityType: 'synthetic' as const })),
      { driverId: 'VIRTUAL MAX', timingProgress: vmProgress, finishTimeSeconds: scenario.startingDelaySeconds + replay.raceLaps * scenario.virtualMaxPace, entityType: 'virtual_max' as const },
    ], replay.raceLaps)
    const terminalRanks = lap === scenario.raceLaps && scenario.terminalState?.raceFormat === 'TIMED_RACE'
      ? new Map(scenario.terminalState.entities.map((entity) => [entity.entityId === 'VIRTUAL MAX' ? 'VIRTUAL MAX' : entity.entityId, entity.finalRank]))
      : null
    ranked.forEach((entry, index) => {
      const point = { lap, rank: terminalRanks?.get(entry.driverId) ?? index + 1, timingProgress: entry.timingProgress }
      if (entry.entityType === 'virtual_max') virtualMax.push(point)
      else trajectories[entry.driverId].push(point)
    })
  }
  return { raceLaps: replay.raceLaps, scenarioId: replay.scenarioId, populationId: replay.populationId, trajectories, virtualMax }
}
