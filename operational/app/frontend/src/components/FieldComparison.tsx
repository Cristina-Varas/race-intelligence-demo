import { probability, signedSeconds } from './Format'
import type { CustomSimulationResult } from '../types/raceIntelligence'

export function FieldComparison({ observed, synthetic }: { observed: CustomSimulationResult; synthetic: CustomSimulationResult }) {
  const rows = [
    ['Field size', String(observed.fieldSize), String(synthetic.fieldSize)],
    ['Evidence type', observed.fieldEvidenceType, synthetic.fieldEvidenceType],
    ['Deterministic max delay', signedSeconds(observed.deterministicMaxDelaySeconds), signedSeconds(synthetic.deterministicMaxDelaySeconds)],
    ['P50', signedSeconds(observed.thresholds.p50), signedSeconds(synthetic.thresholds.p50)],
    ['P80', signedSeconds(observed.thresholds.p80), signedSeconds(synthetic.thresholds.p80)],
    ['P90', signedSeconds(observed.thresholds.p90), signedSeconds(synthetic.thresholds.p90)],
    ['P(catch | 0 s delay)', probability(observed.probabilityCurve.find((point) => point.delaySeconds === 0)?.catchProbability ?? 0), probability(synthetic.probabilityCurve.find((point) => point.delaySeconds === 0)?.catchProbability ?? 0)],
  ]
  return <section className="field-comparison panel" aria-labelledby="field-comparison-title">
    <div className="panel-heading"><div><p className="eyebrow">Selected configuration</p><h2 id="field-comparison-title">Field comparison</h2></div><span className="unit-label">TIMING CATCH ONLY</span></div>
    <div className="comparison-grid"><div>METRIC</div><div>OBSERVED {observed.fieldSize}</div><div>SYNTHETIC {synthetic.fieldSize}</div>{rows.map(([metric, left, right]) => <><span key={`${metric}-metric`}>{metric}</span><strong key={`${metric}-left`}>{left}</strong><strong key={`${metric}-right`}>{right}</strong></>)}</div>
    <p className="panel-note">The synthetic field tests stress under the same race parameters. It does not increase historical evidence or historical sample size.</p>
  </section>
}
