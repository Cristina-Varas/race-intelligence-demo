import { Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import type { CustomSimulationResult } from '../types/raceIntelligence'
import { delayRankSensitivity, syntheticAnalytics } from '../utils/syntheticAnalytics'

function seconds(value: number) { return `${value.toFixed(2)} s` }

export function SyntheticComparativeAnalytics({ scenario, historicalFieldSize, trackLengthMeters }: { scenario: CustomSimulationResult; historicalFieldSize: number; trackLengthMeters: number | null }) {
  const replay = scenario.syntheticReplay
  if (!replay) return null
  const entities = replay.entities ?? replay.drivers ?? []
  const metrics = syntheticAnalytics(entities, replay.raceLaps, scenario.virtualMaxPace, scenario.startingDelaySeconds)
  const distribution = metrics.durations.map((duration, index) => ({ duration, cumulative: (index + 1) / metrics.durations.length }))
  const sensitivity = delayRankSensitivity(entities, replay.raceLaps, scenario.virtualMaxPace, scenario.deterministicMaxDelaySeconds)
  const averageLap = entities.reduce((total, driver) => total + driver.lapTimeSeconds, 0) / entities.length
  const bestLap = Math.min(...entities.map((driver) => driver.lapTimeSeconds))
  return <section className="comparative-analytics panel" aria-labelledby="comparative-analytics-title">
    <div className="panel-heading"><div><p className="eyebrow">Comparative analytics</p><h2 id="comparative-analytics-title">Virtual Max vs simulated field</h2></div><span className="unit-label">{trackLengthMeters === null ? 'MAIN ROUTE TOPOLOGY · LOADING' : `TRACK LENGTH · ${(trackLengthMeters / 1000).toFixed(3)} KM`}</span></div>
    <p className="panel-note">Synthetic 100 is a seeded simulated population, not historical evidence. Historical observed field: {historicalFieldSize} drivers, kept separate.</p>
    <div className="analytics-kpis">
      <article><span>VM RACE DURATION</span><strong>{seconds(metrics.vmDuration)}</strong><p>{replay.raceLaps} laps · synthetic WHAT-IF</p></article>
      <article><span>SYNTHETIC AVG LAP</span><strong>{seconds(averageLap)}</strong><p>Mean of 100 deterministic pace values</p></article>
      <article><span>SYNTHETIC BEST LAP</span><strong>{seconds(bestLap)}</strong><p>Fastest generated nominal pace</p></article>
      <article><span>NOMINAL PACE RANK</span><strong>{metrics.rank} / {entities.length + 1}</strong><p>Baseline nominal pace only; not the selected seeded final classification.</p></article>
      <article><span>NOMINAL PACE PERCENTILE</span><strong>{metrics.percentile.toFixed(0)}th</strong><p>Faster than {metrics.behind} / {entities.length} simulated nominal pace values; not seed-42 terminal rank.</p></article>
      <article><span>TIMING-CATCH PROBABILITY</span><strong>{(scenario.fullFieldCatchProbability * 100).toFixed(1)}%</strong><p>Existing Monte Carlo metric</p></article>
      <article><span>SYNTHETIC MEDIAN</span><strong>{seconds(metrics.median)}</strong><p>Empirical P10–P90 {seconds(metrics.percentiles.p10)}–{seconds(metrics.percentiles.p90)}</p></article>
      <article><span>VM DELTA TO MEDIAN</span><strong>{`${metrics.vmDuration - metrics.median >= 0 ? '+' : ''}${seconds(metrics.vmDuration - metrics.median)}`}</strong><p>{metrics.ahead} ahead · {metrics.behind} behind</p></article>
    </div>
    <div className="analytics-charts">
      <article className="analytics-chart"><p className="eyebrow">Empirical distribution</p><h3>Synthetic race duration ECDF</h3><p>Each step is one simulated driver; VM marker uses the same race-duration semantics.</p><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={distribution} margin={{ top: 16, right: 16, bottom: 8, left: -8 }}><XAxis dataKey="duration" tickFormatter={(value) => `${Math.round(value)}s`} stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 10 }} /><YAxis dataKey="cumulative" domain={[0, 1]} tickFormatter={(value) => `${Math.round(value * 100)}%`} stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#171717', border: '1px solid #505050', borderRadius: 0, color: '#f2f2ef' }} formatter={(value: number) => `${(value * 100).toFixed(0)}%`} labelFormatter={(value) => `RACE DURATION ${Number(value).toFixed(2)} s`} /><ReferenceLine x={metrics.vmDuration} stroke="#e52d32" strokeWidth={2} label={{ value: 'VM', fill: '#ffafb1', fontSize: 10, position: 'top' }} /><Line type="stepAfter" dataKey="cumulative" stroke="#70b8b4" strokeWidth={2} dot={false} activeDot={{ r: 3, fill: '#70b8b4', stroke: '#171717' }} /></LineChart></ResponsiveContainer></div></article>
      <article className="analytics-chart"><p className="eyebrow">Deterministic nominal sensitivity</p><h3>VM start delay vs nominal pace rank</h3><p>Nominal deterministic sweep crossing the maximum-delay limit; it does not use the selected Historical Seeded realization.</p><div className="chart-wrap"><ResponsiveContainer width="100%" height="100%"><LineChart data={sensitivity} margin={{ top: 16, right: 16, bottom: 8, left: -8 }}><XAxis dataKey="delaySeconds" tickFormatter={(value) => `${value}s`} stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 10 }} /><YAxis dataKey="rank" reversed domain={[1, entities.length + 1]} allowDecimals={false} stroke="#696969" tick={{ fill: '#a9a9a9', fontSize: 10 }} /><Tooltip contentStyle={{ background: '#171717', border: '1px solid #505050', borderRadius: 0, color: '#f2f2ef' }} formatter={(value: number) => `${value} / ${entities.length + 1}`} labelFormatter={(value) => `START DELAY ${Number(value).toFixed(1)} s`} /><ReferenceLine x={scenario.startingDelaySeconds} stroke="#e52d32" strokeDasharray="4 4" label={{ value: 'ACTIVE', fill: '#ffafb1', fontSize: 10, position: 'insideTopLeft' }} /><ReferenceLine x={scenario.deterministicMaxDelaySeconds} stroke="#f5c400" strokeDasharray="3 3" label={{ value: `DETERMINISTIC LIMIT +${scenario.deterministicMaxDelaySeconds.toFixed(2)} s`, fill: '#f5c400', fontSize: 10, position: 'insideTopRight' }} /><Line type="linear" dataKey="rank" stroke="#e52d32" strokeWidth={2} dot={{ r: 2, fill: '#e52d32' }} activeDot={{ r: 4, fill: '#e52d32', stroke: '#171717' }} /></LineChart></ResponsiveContainer></div></article>
    </div>
    <p className="analytics-note">Short-track distance is geometrically known. It cannot by itself linearly scale race duration, lap count, delay strategy, traffic, tyres or performance delta to a long track.</p>
  </section>
}
