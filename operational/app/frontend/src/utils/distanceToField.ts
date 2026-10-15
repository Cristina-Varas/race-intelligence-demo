export interface ReplayAheadEntity {
  driverId: string
  raceDistance: number
  gapToVirtualMaxMeters: number
  caughtByVirtualMax: boolean
}

export interface DistanceToFieldState<T extends ReplayAheadEntity> {
  ahead: T[]
  leader: T | null
  leaderGapToVMMeters: number | null
  nextTarget: T | null
  maxGapMeters: number
}

/** Current spatially-ahead set for the Pure Timing reference replay.
 *
 * This intentionally does not inspect `caughtByVirtualMax`: timing catch and
 * current reconstructed order are different concepts.
 */
export function getAheadField<T extends ReplayAheadEntity>(entities: T[], virtualMaxRaceDistance: number): T[] {
  return entities
    .filter((entity) => entity.raceDistance > virtualMaxRaceDistance)
    .sort((left, right) => right.gapToVirtualMaxMeters - left.gapToVirtualMaxMeters)
}

export function getDistanceToField<T extends ReplayAheadEntity>(entities: T[], virtualMaxRaceDistance: number): DistanceToFieldState<T> {
  const ahead = getAheadField(entities, virtualMaxRaceDistance)
  const leader = ahead[0] ?? null
  const nextTarget = ahead[ahead.length - 1] ?? null
  return {
    ahead,
    leader,
    leaderGapToVMMeters: leader?.gapToVirtualMaxMeters ?? null,
    nextTarget,
    maxGapMeters: leader?.gapToVirtualMaxMeters ?? 0,
  }
}

export function fieldGapBarWidth(gapMeters: number, maxGapMeters: number): number {
  if (gapMeters <= 0 || maxGapMeters <= 0) return 0
  return Math.max(0.025, Math.min(1, gapMeters / maxGapMeters))
}
