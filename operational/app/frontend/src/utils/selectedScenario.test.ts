import { describe, expect, it } from 'vitest'

import { selectedScenario } from './selectedScenario'

const synthetic = { fieldMode: 'synthetic_100', fieldSize: 100 } as never
const observed = { fieldMode: 'historical', fieldSize: 16 } as never

describe('selectedScenario', () => {
  it('binds Baseline Synthetic 100 to its synthetic response', () => {
    expect(selectedScenario('baseline', 'synthetic_100', observed, synthetic)).toBe(synthetic)
  })

  it('never reuses a previous custom result in Baseline Observed mode', () => {
    expect(selectedScenario('baseline', 'historical', observed, synthetic)).toBeNull()
  })

  it('uses the selected custom response in Custom mode', () => {
    expect(selectedScenario('custom', 'historical', observed, synthetic)).toBe(observed)
  })
})
