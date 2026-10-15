import type { BaseballCardDataRow } from '../types/raceIntelligence'
import { wallGap, wallLapTime } from '../utils/liveWallPresentation'

const present = (value: number | null | undefined): value is number => value != null && Number.isFinite(value)
const position = (value: number | null) => value == null ? '—' : `P${value}`

export function FactualBaseballCard({ row, sourceMode }: { row: BaseballCardDataRow; sourceMode?: string }) {
  const lapTime = (value: number) => sourceMode ? wallLapTime(value) : `${value.toFixed(3)} s`
  const peak = row['Peak Position']
  const primary = present(peak) ? ['PEAK OBSERVED', `P${peak}`, 'Best position observed during this capture.']
    : present(row.bestLapSeconds) ? ['BEST VALID LAP', lapTime(row.bestLapSeconds), 'Personal best among the valid laps received.']
      : present(row.latestObservedPosition) ? ['LATEST OBSERVED', `P${row.latestObservedPosition}`, 'Latest captured position, not final classification.']
        : ['FACTUAL EVIDENCE', 'KART', 'Race metrics are not available for this capture.']
  const secondary = [
    ['LATEST OBSERVED', present(row.latestObservedPosition) ? `P${row.latestObservedPosition}` : null],
    ['BEST VALID LAP', present(row.bestLapSeconds) && primary[0] !== 'BEST VALID LAP' ? lapTime(row.bestLapSeconds) : null],
    ['OBSERVED LAP', present(row.observedLap) ? `L${row.observedLap}` : null],
    ['GAP TO LEADER', sourceMode ? wallGap({position:row.latestObservedPosition ?? null,gapFirstSeconds:row.gapToLeaderSeconds ?? null}) : present(row.gapToLeaderSeconds) ? `${row.gapToLeaderSeconds.toFixed(3)} s` : null],
    ['INTERVAL', present(row.intervalSeconds) ? `${row.intervalSeconds.toFixed(3)} s` : null],
  ].filter((metric) => metric[1] !== null)
  return <article className="bc-portrait" aria-label={`Factual card ${row['Kart Display']}`}>
    <header><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /><div><b>MAX VS 100</b><span>RACE INTELLIGENCE</span></div></header>
    <div className="bc-identity"><span className="bc-watermark" aria-hidden="true">{row['Kart No']}</span><small>FACTUAL EVENT</small><h3>{row['Kart Display']}</h3></div>
    <div className="bc-primary"><h4>{primary[0]}</h4><strong>{primary[1]}</strong><p>{primary[2]}</p></div>
    {secondary.length > 0 && <div className="bc-secondary">{[secondary.slice(0, 2), secondary.slice(2)].filter((panel) => panel.length).map((panel, i) => <div key={i}>{panel.map(([label, value]) => <section key={label}><span>{label}</span><b>{value}</b></section>)}</div>)}</div>}
    <div className="bc-position-strip">{[['START', position(row['Start Position'])], ['PEAK', position(peak)], ['FINAL', position(row['Final Position'])], ['CHANGE', row['Change Display'] ?? '—']].map(([label, value]) => <div key={label}><span>{label}</span><b>{value}</b></div>)}</div>
    <footer><b>FACTUAL EVENT CARD {sourceMode ? `${sourceMode} / OBSERVED DATA` : 'REHEARSAL'}</b><span>Observed evidence, not official final classification</span><small>Powered by Oracle</small></footer>
  </article>
}
