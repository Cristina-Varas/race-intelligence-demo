import type { ScenarioTiming } from '../types/raceIntelligence'

type TimingInputs = {
  raceLaps: number
  virtualMaxPace: number
  startingDelaySeconds: number
  driverPaces: number[]
}

/**
 * Presentation projection for governed Baseline data.
 *
 * Custom scenarios receive this exact contract from the API.  Baseline keeps
 * its governed Gold payload unchanged, so its selected slider delay is
 * projected locally from the same deterministic timing convention.
 */
export function deriveFixedLapTiming({ raceLaps, virtualMaxPace, startingDelaySeconds, driverPaces }: TimingInputs): ScenarioTiming {
  const projectedFinishTimeSeconds = startingDelaySeconds + raceLaps * virtualMaxPace
  const catchLaps = driverPaces.map((driverPace) => {
    const paceGain = driverPace - virtualMaxPace
    if (paceGain <= 0) return null
    if (startingDelaySeconds <= 0) return 0
    const catchLap = startingDelaySeconds / paceGain
    return catchLap <= raceLaps ? catchLap : null
  })
  const allCaught = catchLaps.length > 0 && catchLaps.every((catchLap) => catchLap !== null)
  const finalCatchLapExact = allCaught ? Math.max(...catchLaps as number[]) : null

  return {
    raceFormat: 'FIXED_LAP',
    projectedFinishTimeSeconds,
    projectedFinishLap: raceLaps,
    fullFieldCatchTimeSeconds: finalCatchLapExact === null
      ? null
      : startingDelaySeconds + finalCatchLapExact * virtualMaxPace,
    fullFieldCatchLap: finalCatchLapExact === null ? null : Math.ceil(finalCatchLapExact),
    fullFieldCaught: allCaught,
  }
}

export function formatRaceTime(totalSeconds: number): string {
  const sign = totalSeconds < 0 ? '-' : ''
  const tenths = Math.round(Math.abs(totalSeconds) * 10)
  const hours = Math.floor(tenths / 36_000)
  const minutes = Math.floor((tenths % 36_000) / 600)
  const seconds = Math.floor((tenths % 600) / 10)
  const decimal = tenths % 10
  const secondsText = `${seconds}`.padStart(2, '0')
  return hours > 0
    ? `${sign}${hours}:${`${minutes}`.padStart(2, '0')}:${secondsText}.${decimal}`
    : `${sign}${minutes}:${secondsText}.${decimal}`
}
