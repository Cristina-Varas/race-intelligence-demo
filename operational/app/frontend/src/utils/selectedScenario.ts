import type { CustomSimulationResult, FieldMode } from '../types/raceIntelligence'

export function selectedScenario(
  mode: 'baseline' | 'custom',
  fieldMode: FieldMode,
  customResult: CustomSimulationResult | null,
  baselineSynthetic: CustomSimulationResult | null,
): CustomSimulationResult | null {
  if (mode === 'custom') return customResult
  return fieldMode === 'synthetic_100' ? baselineSynthetic : null
}
