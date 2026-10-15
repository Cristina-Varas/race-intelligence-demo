import type { ProbabilityPoint } from '../types/raceIntelligence'

export function interpolateProbability(delay: number, curve: ProbabilityPoint[]): number {
  if (curve.length === 0) return 0
  const exact = curve.find((point) => Math.abs(point.delaySeconds - delay) < 1e-9)
  if (exact) return exact.catchProbability
  if (delay <= curve[0].delaySeconds) return curve[0].catchProbability
  if (delay >= curve[curve.length - 1].delaySeconds) return curve[curve.length - 1].catchProbability
  const upperIndex = curve.findIndex((point) => point.delaySeconds > delay)
  const lower = curve[upperIndex - 1]
  const upper = curve[upperIndex]
  const ratio = (delay - lower.delaySeconds) / (upper.delaySeconds - lower.delaySeconds)
  return lower.catchProbability + ratio * (upper.catchProbability - lower.catchProbability)
}
