import { formatRaceTime } from '../utils/raceTiming'
import type { CustomSimulationResult } from '../types/raceIntelligence'

function lap(value: number | null) { return value === null ? '—' : `LAP ${value}` }
function time(value: number | null) { return value === null ? '—' : formatRaceTime(value) }

export function RaceModelComparison({ scenario }: { scenario: CustomSimulationResult }) {
  if (!scenario.trafficAdjusted || !scenario.pureTiming) return null
  const pure = scenario.pureTiming
  const adjusted = scenario.trafficAdjusted
  return <section className="race-model-comparison panel" aria-label="Pure Timing and Traffic-Adjusted Scenario comparison">
    <p className="eyebrow">Scenario assumption comparison</p>
    <h2>Model comparison</h2>
    <div className="race-model-grid">
      <div className="race-model-head"><span>METRIC</span><strong>PURE TIMING</strong><strong>TRAFFIC ADJUSTED</strong></div>
      <div><span>P1 · RECONSTRUCTED RANK</span><strong>{lap(pure.p1Lap)}</strong><strong>{lap(adjusted.p1Lap)}</strong></div>
      <div><span>FULL-FIELD CLEAR</span><strong>{time(pure.fullFieldClearTimeSeconds)}</strong><strong>{time(adjusted.fullFieldClearTimeSeconds)}</strong></div>
      <div><span>PROJECTED FINISH</span><strong>{time(pure.projectedFinishTimeSeconds)}</strong><strong>{time(adjusted.projectedFinishTimeSeconds)}</strong></div>
      <div><span>TRAFFIC COST ASSUMPTION</span><strong>—</strong><strong>+{adjusted.cumulativeTrafficCostSeconds.toFixed(1)} s</strong></div>
      <div><span>TIMING CAUGHT</span><strong>—</strong><strong>{adjusted.timingCatchCount ?? 0}</strong></div>
      <div><span>CLEARED / STILL TO CLEAR</span><strong>—</strong><strong>{adjusted.clearedCount ?? 0} / {adjusted.stillToClearCount ?? '—'}</strong></div>
    </div>
    <p className="panel-note">Traffic-adjusted clear is a deterministic scenario assumption. It is not a physical pass model or measured telemetry.</p>
  </section>
}
