import type { BaseballCardDataRow } from '../types/raceIntelligence'
import { cardDuration, ordinal } from '../utils/modelledBaseballCard'

export function ModelledBaseballCard({ row }: { row: BaseballCardDataRow }) {
  const laps = row['Laps When Max Passed'], rank = row['Field Performance Rank']
  return <article className="bc-portrait bc-modelled" aria-label={`Modelled card ${row['Kart Display']}`}>
    <header><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /><div><b>MAX VS 100</b><span>RACE INTELLIGENCE</span></div></header>
    <div className="bc-identity"><span className="bc-watermark" aria-hidden="true">{row['Kart No']}</span><small>MODELLED TIMING CATCH</small><h3>{row['Kart Display']}</h3></div>
    <div className="bc-primary"><strong>{laps === null ? '—' : laps.toFixed(1)}{laps !== null && <small> LAPS</small>}</strong><h4>{row['Primary Result Label']}</h4><p>{row['Primary Result Statement'] ?? 'No timing catch established within this scenario.'}</p></div>
    <div className="bc-secondary">
      <div><span>TIME SPENT AHEAD OF MAX</span><b>{cardDuration(row['Time Spent Ahead of Max'])}</b></div>
      <div><span>FIELD PERFORMANCE</span><b>{rank === null ? '—' : ordinal(rank)}</b></div>
    </div>
    <div className="bc-position-strip">{[['START', row['Start Display']], ['PEAK', row['Peak Display']], ['FINAL', row['Final Display']], ['CHANGE', row['Change Display']]].map(([label, value]) => <div key={label}><span>{label}</span><b>{value ?? '—'}</b></div>)}</div>
    <footer><b>MODELLED TIMING CATCH</b><span>Not an observed physical overtake</span><small>Powered by Oracle</small></footer>
  </article>
}
