import type { SimulationRequest } from '../types/raceIntelligence'

export interface SimulationValidation {
  raceLapsValid: boolean
  raceDurationValid: boolean
  advantageValid: boolean
  delayValid: boolean
  simulationsValid: boolean
  formValid: boolean
}

/** Mirror the public API bounds so invalid local input cannot start a request. */
export function validateSimulationRequest(parameters: SimulationRequest): SimulationValidation {
  const raceLapsValid = Number.isInteger(parameters.raceLaps) && parameters.raceLaps >= 5 && parameters.raceLaps <= 100
  const raceDurationValid = Number.isFinite(parameters.raceDurationSeconds) && (parameters.raceDurationSeconds ?? 0) >= 600 && (parameters.raceDurationSeconds ?? 0) <= 7200
  const advantageValid = Number.isFinite(parameters.virtualMaxAdvantageSecondsPerLap)
    && parameters.virtualMaxAdvantageSecondsPerLap > 0
    && parameters.virtualMaxAdvantageSecondsPerLap <= 1
  const delayValid = Number.isFinite(parameters.startingDelaySeconds)
    && parameters.startingDelaySeconds >= -120
    && parameters.startingDelaySeconds <= 120
  const simulationsValid = Number.isInteger(parameters.simulations) && parameters.simulations >= 500 && parameters.simulations <= 20_000
  return {
    raceLapsValid,
    raceDurationValid,
    advantageValid,
    delayValid,
    simulationsValid,
    formValid: (parameters.raceFormat === 'TIMED_RACE' ? raceDurationValid : raceLapsValid) && advantageValid && delayValid && simulationsValid,
  }
}
