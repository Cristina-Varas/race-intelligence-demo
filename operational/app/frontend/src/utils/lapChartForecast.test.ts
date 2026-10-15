import { describe, expect, it } from 'vitest'

import { timedTerminalScenario } from '../testFixtures/timedTerminalScenario'
import { createLapChartForecast } from './lapChartForecast'

function scenario(delay = 1.5, pace = 80.098, laps = 3) {
  return { raceLaps: laps, virtualMaxPace: pace, startingDelaySeconds: delay, syntheticReplay: { scenarioId: 'scenario-a', populationId: 'bootstrap_bounded_v1:seed=42', raceLaps: laps, entities: [
    { driverId: 'SYN_001', paceSecondsPerLap: 80.3, gridOffsetMeters: 500, entityType: 'synthetic' },
    { driverId: 'SYN_002', paceSecondsPerLap: 80.6, gridOffsetMeters: 5, entityType: 'synthetic' },
  ] } } as never
}

describe('lap chart forecast', () => {
  it('reuses every active synthetic entity plus VM and starts delayed VM at the rear timing rank', () => {
    const forecast = createLapChartForecast(scenario())!
    expect(Object.keys(forecast.trajectories)).toHaveLength(2)
    expect(forecast.virtualMax).toHaveLength(4)
    expect(forecast.virtualMax[0].rank).toBe(3)
    expect(forecast.trajectories.SYN_001[0].rank).toBeLessThan(3)
  })

  it('uses timing progress rather than illustrative grid offsets and changes under a custom scenario', () => {
    const one = createLapChartForecast(scenario(1.5))!
    const two = createLapChartForecast(scenario(6, 79.7, 3))!
    expect(one.virtualMax.map((point) => point.rank)).not.toEqual(two.virtualMax.map((point) => point.rank))
    // SYN_001 has a much larger display-only grid offset, but equal-time pace
    // progression determines rank and remains ahead of the slower SYN_002.
    expect(one.trajectories.SYN_001[1].rank).toBeLessThan(one.trajectories.SYN_002[1].rank)
  })

  it('uses backend-provided seeded lap sequences rather than resampling in the browser', () => {
    const seeded = scenario() as { syntheticReplay: { entities: { driverId: string; lapTimes?: number[] }[] } }
    seeded.syntheticReplay.entities[0].lapTimes = [82, 79, 82]
    seeded.syntheticReplay.entities[1].lapTimes = [79, 82, 79]
    const first = createLapChartForecast(seeded as never)!
    const second = createLapChartForecast(seeded as never)!
    expect(first).toEqual(second)
    expect(first.trajectories.SYN_001[1].rank).toBeGreaterThan(first.trajectories.SYN_002[1].rank)
  })

  it('uses finish time, not equal capped progress, for the terminal rank', () => {
    const terminal = {
      raceLaps: 2, virtualMaxPace: 1, startingDelaySeconds: .5,
      syntheticReplay: { scenarioId: 'terminal', populationId: 'test', raceLaps: 2, entities: [
        { driverId: 'SYN_EARLY', paceSecondsPerLap: 1, raceDurationSeconds: 2, lapTimes: [1, 1], entityType: 'synthetic' },
      ] },
    } as never
    const forecast = createLapChartForecast(terminal)!
    expect(forecast.virtualMax.at(-1)?.rank).toBe(2)
    expect(forecast.trajectories.SYN_EARLY.at(-1)?.rank).toBe(1)
  })

  it('uses the backend TIMED_RACE terminal state when it conflicts with local terminal progress', () => {
    const forecast = createLapChartForecast(timedTerminalScenario())!
    // The fixture's local capped timing progress would place VM ahead of SYN_A.
    // The terminal classification is backend-authoritative instead.
    expect(forecast.trajectories.SYN_A.at(-1)?.rank).toBe(1)
    expect(forecast.virtualMax.at(-1)?.rank).toBe(2)
  })

  it('keeps FIXED_LAPS on its existing local timing-ranking path', () => {
    const timed = timedTerminalScenario()
    const fixed = {
      ...timed,
      raceFormat: { mode: 'FIXED_LAPS' as const, durationSeconds: null, finishRule: null },
      terminalState: { ...timed.terminalState!, raceFormat: 'FIXED_LAPS' as const },
    }
    const forecast = createLapChartForecast(fixed)!
    expect(forecast.virtualMax.at(-1)?.rank).toBe(1)
    expect(forecast.trajectories.SYN_A.at(-1)?.rank).toBe(2)
  })
})
