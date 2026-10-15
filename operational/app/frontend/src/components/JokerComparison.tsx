import { useState } from 'react'

import { compareJokers } from '../api/raceIntelligence'
import type { CustomSimulationResult, JokerStrategyResult } from '../types/raceIntelligence'

type ComparisonRow = JokerStrategyResult & { optionId: string }

function gap(value: number | null) {
  return value === null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(3)} s`
}

export function JokerComparison({ scenario, onSelect }: { scenario: CustomSimulationResult; onSelect: (result: JokerStrategyResult) => void }) {
  const [from, setFrom] = useState(5)
  const [to, setTo] = useState(10)
  const [j1, setJ1] = useState(1)
  const [j2, setJ2] = useState(.8)
  const [rows, setRows] = useState<ComparisonRow[]>([])
  const [best, setBest] = useState<string[]>([])
  const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null)

  const run = async () => {
    const firstLap = Math.max(1, from)
    const finalLap = Math.min(scenario.raceLaps, to)
    const laps = Array.from({ length: Math.max(0, finalLap - firstLap + 1) }, (_, index) => firstLap + index)
    const result = await compareJokers({
      driverId: 'VIRTUAL_MAX',
      options: laps.flatMap((lap) => [
        { routeId: 'joker_1' as const, lap, jokerSpeedFactor: j1 },
        { routeId: 'joker_2' as const, lap, jokerSpeedFactor: j2 },
      ]),
      scenario: {
        raceLaps: scenario.raceLaps,
        virtualMaxAdvantageSecondsPerLap: scenario.virtualMaxAdvantageSecondsPerLap,
        startingDelaySeconds: scenario.startingDelaySeconds,
        simulations: scenario.simulations,
        fieldMode: scenario.fieldMode,
      },
    })
    setRows(result.evaluatedOptions)
    setBest(result.bestTimingOptionIds)
    setSelectedOptionId(null)
  }

  const bestRow = rows[0]
  return <section className="joker-comparison panel">
    <p className="eyebrow">Deterministic comparison</p>
    <h2>Joker comparison</h2>
    <div className="joker-controls">
      <label>FROM <input type="number" value={from} min="1" max={scenario.raceLaps} onChange={(event) => setFrom(+event.target.value)} /></label>
      <label>TO <input type="number" value={to} min="1" max={scenario.raceLaps} onChange={(event) => setTo(+event.target.value)} /></label>
      <label>J1 FACTOR <input type="number" step=".01" value={j1} onChange={(event) => setJ1(+event.target.value)} /></label>
      <label>J2 FACTOR <input type="number" step=".01" value={j2} onChange={(event) => setJ2(+event.target.value)} /></label>
      <button className="run-scenario-button" onClick={run}>COMPARE OPTIONS</button>
    </div>
    {bestRow ? <div className="joker-best-card" aria-label="Best evaluated timing outcome">
      <p>BEST EVALUATED TIMING OUTCOME</p>
      <div><strong>{bestRow.routeId.toUpperCase()}</strong><span>LAP {bestRow.lap}</span><span>FACTOR {bestRow.speedFactor.toFixed(2)}</span></div>
      <div><b>Δ {bestRow.timingDeltaSeconds.toFixed(3)} s</b><span>REJOIN P{bestRow.projectedRejoin.rank}</span></div>
      <small>AHEAD {bestRow.projectedRejoin.aheadDriverId ?? '—'} · BEHIND {bestRow.projectedRejoin.behindDriverId ?? '—'}</small>
    </div> : null}
    {rows.length ? <div className="telemetry-scroll-panel joker-comparison-table" tabIndex={0} aria-label="Scrollable Joker comparison options">
      <table>
        <colgroup><col className="option" /><col className="lap" /><col className="factor" /><col className="delta" /><col className="rejoin" /><col className="driver" /><col className="gap" /><col className="driver" /><col className="gap" /></colgroup>
        <thead><tr><th>OPTION</th><th>LAP</th><th>FACTOR</th><th>Δ TIME</th><th>REJOIN</th><th>AHEAD</th><th>GAP AHEAD</th><th>BEHIND</th><th>GAP BEHIND</th></tr></thead>
        <tbody>{rows.map((row) => {
          const isBest = best.includes(row.optionId)
          const isSelected = selectedOptionId === row.optionId
          return <tr key={row.optionId} className={`${isBest ? 'best' : ''}${isSelected ? ' is-selected' : ''}`} onClick={() => { setSelectedOptionId(row.optionId); onSelect(row) }}>
            <td>{row.routeId.toUpperCase()}</td><td>{row.lap}</td><td>{row.speedFactor.toFixed(2)}</td><td className="joker-delta">{row.timingDeltaSeconds.toFixed(3)} s</td><td>P{row.projectedRejoin.rank}</td><td>{row.projectedRejoin.aheadDriverId ?? '—'}</td><td>{gap(row.projectedRejoin.gapAheadSeconds)}</td><td>{row.projectedRejoin.behindDriverId ?? '—'}</td><td>{gap(row.projectedRejoin.gapBehindSeconds)}</td>
          </tr>
        })}</tbody>
      </table>
    </div> : null}
    <p className="panel-note">Best evaluated timing outcome under current assumptions. Joker pace is not measured telemetry; rejoin is reconstructed timing order, not a guaranteed physical merge.</p>
  </section>
}
