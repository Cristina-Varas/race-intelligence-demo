import { describe, expect, it } from 'vitest'

import { validateSimulationRequest } from './simulationValidation'

describe('validateSimulationRequest', () => {
  it('accepts the visible default inputs and rejects values outside API bounds', () => {
    expect(validateSimulationRequest({ raceLaps: 30, virtualMaxAdvantageSecondsPerLap: 0.195, startingDelaySeconds: 1.5, simulations: 5000, fieldMode: 'historical' })).toEqual({
      raceLapsValid: true, raceDurationValid: false, advantageValid: true, delayValid: true, simulationsValid: true, formValid: true,
    })
    expect(validateSimulationRequest({ raceLaps: 101, virtualMaxAdvantageSecondsPerLap: 0.195, startingDelaySeconds: 1.5, simulations: 5000, fieldMode: 'historical' }).formValid).toBe(false)
    expect(validateSimulationRequest({ raceFormat: 'TIMED_RACE', raceLaps: 30, raceDurationSeconds: 3600, virtualMaxAdvantageSecondsPerLap: .195, startingDelaySeconds: 1.5, simulations: 5000, fieldMode: 'synthetic_100' }).formValid).toBe(true)
    expect(validateSimulationRequest({ raceFormat: 'TIMED_RACE', raceLaps: 30, raceDurationSeconds: 300, virtualMaxAdvantageSecondsPerLap: .195, startingDelaySeconds: 1.5, simulations: 5000, fieldMode: 'synthetic_100' }).formValid).toBe(false)
  })
})
