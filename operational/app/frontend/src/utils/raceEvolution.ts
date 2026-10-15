import type { CustomSimulationResult, SyntheticReplayDriver } from '../types/raceIntelligence'
import { createLapChartForecast, syntheticProgressAtTime, type LapRankPoint } from './lapChartForecast'

export type EvolutionModel = 'PURE_TIMING' | 'TRAFFIC_ADJUSTED'
export interface EvolutionPoint extends LapRankPoint { gapToVmSeconds: number }
export interface RaceEvolutionData { raceLaps: number; virtualMax: EvolutionPoint[]; trajectories: Record<string, EvolutionPoint[]>; traffic?: CustomSimulationResult['trafficAdjusted'] }

function pace(driver: SyntheticReplayDriver) { return driver.paceSecondsPerLap ?? driver.lapTimeSeconds }

/**
 * Presentation-only trajectory adapter.  Traffic rank is deliberately read from
 * the backend's authoritative Phase 8 trajectory; it is never recalculated here.
 */
export function createRaceEvolution(scenario: CustomSimulationResult, model: EvolutionModel): RaceEvolutionData | null {
  const base = createLapChartForecast(scenario)
  const entities = scenario.syntheticReplay?.entities ?? scenario.syntheticReplay?.drivers
  if (!base || !entities?.length) return null
  const traffic = model === 'TRAFFIC_ADJUSTED' ? scenario.trafficAdjusted ?? undefined : undefined
  const trafficByLap = new Map(traffic?.rankTrajectory.map((point) => [point.lap, point]) ?? [])
  const vmByLap = new Map(base.virtualMax.map((point) => [point.lap, point]))
  const virtualMax = base.virtualMax.map((point) => {
    const authoritative = trafficByLap.get(point.lap)
    const raceTimeSeconds = authoritative?.raceTimeSeconds ?? scenario.startingDelaySeconds + point.lap * scenario.virtualMaxPace
    return { ...point, rank: authoritative?.rank ?? point.rank, gapToVmSeconds: 0, timingProgress: point.lap, raceTimeSeconds }
  })
  const trajectories = Object.fromEntries(entities.map((driver) => {
    const points = base.trajectories[driver.driverId].map((point) => {
      const authoritative = trafficByLap.get(point.lap)
      const pureVmRank = vmByLap.get(point.lap)?.rank ?? 101
      // `base` is already a 101-entity ordering (100 SYN + VM). Remove VM to
      // recover the stable 100-driver field rank, then insert VM exactly once
      // at the backend-authoritative traffic rank.  The previous projection
      // shifted a rank that still contained VM, which could produce P103.
      const fieldRank = point.rank - (point.rank > pureVmRank ? 1 : 0)
      const adjustedRank = authoritative
        ? fieldRank + (fieldRank >= authoritative.rank ? 1 : 0)
        : point.rank
      const vmRaceTime = authoritative?.raceTimeSeconds ?? scenario.startingDelaySeconds + point.lap * scenario.virtualMaxPace
      const gapToVmSeconds = driver.lapTimes?.length
        ? (point.lap - syntheticProgressAtTime(driver, vmRaceTime, scenario.raceLaps)) * pace(driver)
        : vmRaceTime - point.lap * pace(driver)
      return { ...point, rank: adjustedRank, gapToVmSeconds }
    })
    return [driver.driverId, points]
  }))
  return { raceLaps: base.raceLaps, virtualMax, trajectories, traffic }
}

export function tacticalEvolutionIds(nextTargetId: string | null, selectedDriverId: string | null, nearbyIds: string[]) {
  return new Set(['VIRTUAL MAX', ...nearbyIds, ...(nextTargetId ? [nextTargetId] : []), ...(selectedDriverId && selectedDriverId !== 'VIRTUAL MAX' ? [selectedDriverId] : [])])
}
