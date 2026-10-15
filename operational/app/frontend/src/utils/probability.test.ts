import { describe, expect, it } from 'vitest'

import { interpolateProbability } from './probability'

const curve = [
  { delaySeconds: -1, catchProbability: 0.9 },
  { delaySeconds: 0, catchProbability: 0.7 },
  { delaySeconds: 1, catchProbability: 0.5 },
]

describe('interpolateProbability', () => {
  it('uses exact governed curve points when present', () => {
    expect(interpolateProbability(0, curve)).toBe(0.7)
  })

  it('interpolates only between adjacent governed curve points', () => {
    expect(interpolateProbability(0.5, curve)).toBeCloseTo(0.6)
  })

  it('uses the nearest endpoint outside the governed curve range', () => {
    expect(interpolateProbability(-10, curve)).toBe(0.9)
    expect(interpolateProbability(10, curve)).toBe(0.5)
  })
})
