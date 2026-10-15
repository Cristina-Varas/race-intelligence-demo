export const NEXT_TARGETS_LIMIT = 6

import type { ReplayAheadEntity } from './distanceToField'

export interface NextTargetReplayEntity extends ReplayAheadEntity {
  timingCatchTimeSeconds: number | null
}

export interface NextTargetsState<T extends NextTargetReplayEntity> {
  caughtCount: number
  /** Competitors not timing-caught at any point in this replay. */
  uncaughtTargetCount: number
  lastCatch: T | null
  nextTarget: T | null
  targets: T[]
}

/**
 * Select presentation targets from the authoritative synthetic replay state.
 * Gaps remain reconstructed Main-route metres; no map-speed conversion is made.
 */
export function getNextTargets<T extends NextTargetReplayEntity>({
  entities,
  virtualMaxRaceDistance,
  replayTime,
  limit = NEXT_TARGETS_LIMIT,
}: {
  entities: T[]
  virtualMaxRaceDistance: number
  replayTime: number
  limit?: number
}): NextTargetsState<T> {
  const caught = entities.filter((entity) => entity.caughtByVirtualMax)
  // A next target is intentionally a never-caught timing target.  It is not a
  // current-classification calculation: a caught competitor can later finish
  // ahead under a different active race model.
  const ahead = entities
    .filter((entity) => !entity.caughtByVirtualMax && entity.raceDistance > virtualMaxRaceDistance)
    .sort((left, right) => left.gapToVirtualMaxMeters - right.gapToVirtualMaxMeters)
  const lastCatch = caught
    .filter((entity) => entity.timingCatchTimeSeconds !== null && entity.timingCatchTimeSeconds <= replayTime)
    .sort((left, right) => (right.timingCatchTimeSeconds ?? -Infinity) - (left.timingCatchTimeSeconds ?? -Infinity))[0] ?? null

  return {
    caughtCount: caught.length,
    uncaughtTargetCount: entities.length - caught.length,
    lastCatch,
    nextTarget: ahead[0] ?? null,
    targets: ahead.slice(0, limit),
  }
}
