import { ReferenceLine, ResponsiveContainer, Line, LineChart, Tooltip, XAxis, YAxis } from 'recharts'

import { delayInterpretation, probability, signedSeconds } from './Format'
import type { ProbabilityPoint, ScenarioSummary } from '../types/raceIntelligence'

interface Props {
  curve: ProbabilityPoint[]
  summary: ScenarioSummary
  activeDelay: number
  trafficAdjusted?: boolean
  historicalSeeded?: boolean
  timedRace?: boolean
  referenceOnly?: boolean
}

function ChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ProbabilityPoint }> }) {
  if (!active || !payload?.[0]) return null
  const point = payload[0].payload
  return (
    <div className="telemetry-tooltip probability-tooltip">
      <span className="telemetry-tooltip-label">START DELAY</span>
      <strong className="telemetry-tooltip-primary">{signedSeconds(point.delaySeconds, 1)}</strong>
      <div className="telemetry-tooltip-reading">
        <span>FULL-FIELD CATCH</span>
        <strong>{probability(point.catchProbability)}</strong>
      </div>
      <small>{delayInterpretation(point.delaySeconds)}</small>
    </div>
  )
}

export function ProbabilityChart({ curve, summary, activeDelay, trafficAdjusted = false, historicalSeeded = false, timedRace = false, referenceOnly = false }: Props) {
  if (timedRace) return <section className="panel chart-panel" aria-labelledby="probability-title"><div className="panel-heading"><div><p className="eyebrow">Monte Carlo</p><h2 id="probability-title">Full-field catch probability</h2></div></div><p className="panel-note">MONTE CARLO UNAVAILABLE FOR TIMED RACE. The fixed-lap uncertainty curve is not reused as timed-race output.</p></section>
  const references = [
    { label: 'P90', value: summary.thresholds.p90, color: '#8f8f8f' },
    { label: 'P80', value: summary.thresholds.p80, color: '#b5b5b5' },
    { label: 'P50', value: summary.thresholds.p50, color: '#f04444' },
    { label: '0 s', value: 0, color: '#585858' },
    { label: 'DET', value: summary.deterministicMaxDelaySeconds, color: '#ff9d9d' },
  ]

  return (
    <section className="panel chart-panel" aria-labelledby="probability-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">{referenceOnly ? 'Governed Monte Carlo reference' : trafficAdjusted || historicalSeeded ? 'Pure-timing Monte Carlo' : 'Monte Carlo'}</p>
          <h2 id="probability-title">Full-field catch probability</h2>
        </div>
        <span className="unit-label">STARTING DELAY / SECONDS</span>
      </div>
      {referenceOnly ? <p className="panel-note">The cursor follows the active deterministic start delay. This governed 5,000-run reference curve has not been recomputed for pending custom inputs.</p> : trafficAdjusted || historicalSeeded ? <p className="panel-note">{historicalSeeded ? 'The selected historical-seeded field realization is not included in this uncertainty model.' : 'Traffic-adjusted pace and traffic-cost assumptions are not included in this uncertainty model.'}</p> : null}
      <div className="chart-wrap">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={curve} margin={{ top: 16, right: 18, bottom: 8, left: -10 }}>
            <XAxis dataKey="delaySeconds" type="number" domain={['dataMin', 'dataMax']} tickFormatter={(value) => `${value}s`} stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 11 }} />
            <YAxis dataKey="catchProbability" domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} cursor={{ stroke: '#ffffff', strokeOpacity: 0.16 }} />
            {[0.5, 0.8, 0.9].map((value) => <ReferenceLine key={value} y={value} stroke="#555" strokeDasharray="3 6" />)}
            {references.map((reference) => reference.value === null ? null : (
              <ReferenceLine key={reference.label} x={reference.value} stroke={reference.color} strokeDasharray="4 4" label={{ value: reference.label, fill: reference.color, fontSize: 10, fontFamily: 'ui-monospace, monospace', fontWeight: 700, position: 'top' }} />
            ))}
            <ReferenceLine x={activeDelay} stroke="#ffffff" strokeWidth={1.5} />
            <Line type="linear" dataKey="catchProbability" stroke="#f04444" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#f04444', stroke: '#171717', strokeWidth: 2 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </section>
  )
}
