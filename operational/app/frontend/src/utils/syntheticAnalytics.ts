type PaceReplayDriver = { lapTimeSeconds: number }

export interface SyntheticAnalytics {
  durations: number[]
  vmDuration: number
  ahead: number
  behind: number
  rank: number
  percentile: number
  median: number
  percentiles: Record<'p10' | 'p25' | 'p50' | 'p75' | 'p90', number>
}

export function empiricalPercentile(sorted: number[], percentile: number) {
  if (!sorted.length) return null
  const index = (sorted.length - 1) * percentile
  const low = Math.floor(index); const high = Math.ceil(index)
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low)
}

export function syntheticAnalytics(drivers: PaceReplayDriver[], raceLaps: number, virtualMaxPace: number, startingDelaySeconds: number): SyntheticAnalytics {
  const durations = drivers.map((driver) => driver.lapTimeSeconds * raceLaps).sort((left, right) => left - right)
  const vmDuration = raceLaps * virtualMaxPace + startingDelaySeconds
  const ahead = durations.filter((duration) => duration < vmDuration).length
  const behind = durations.filter((duration) => duration >= vmDuration).length
  const read = (percentile: number) => empiricalPercentile(durations, percentile)!
  return { durations, vmDuration, ahead, behind, rank: ahead + 1, percentile: behind / durations.length * 100, median: read(.5), percentiles: { p10: read(.1), p25: read(.25), p50: read(.5), p75: read(.75), p90: read(.9) } }
}

export function delayRankSensitivity(drivers: PaceReplayDriver[], raceLaps: number, virtualMaxPace: number, deterministicMaxDelay: number) {
  const lower = deterministicMaxDelay - 10
  const upper = deterministicMaxDelay + 15
  const steps = 13
  return Array.from({ length: steps }, (_, index) => lower + index * (upper - lower) / (steps - 1)).map((delay) => ({ delaySeconds: Number(delay.toFixed(3)), rank: syntheticAnalytics(drivers, raceLaps, virtualMaxPace, delay).rank }))
}
