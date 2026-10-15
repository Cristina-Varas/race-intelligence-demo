import { useEffect, useMemo, useState } from 'react'
import { baseballCardDataExportUrl, fetchBaseballCardData, runSimulation } from '../api/raceIntelligence'
import type { BaseballCardDataResponse, BaseballCardDataRow, CustomSimulationResult } from '../types/raceIntelligence'
import './BaseballCardData.css'
import { FactualBaseballCard } from './FactualBaseballCard'
import { ModelledBaseballCard } from './ModelledBaseballCard'
import { CARD_REFERENCE, cardDuration, projectModelledCards } from '../utils/modelledBaseballCard'
import { wallGap, wallLapTime, wallSeconds } from '../utils/liveWallPresentation'
import { useLiveEventSession } from '../hooks/useLiveEventSession'

export const MARKETING_HEADERS = ['Card No', 'Participant ID', 'Participant Name', 'Kart No', 'Kart Display', 'Laps When Max Passed', 'Time Spent Ahead of Max', 'Field Performance Rank', 'Field Performance Display', 'Start Position', 'Peak Position', 'Final Position', 'Position Change', 'Start Display', 'Peak Display', 'Final Display', 'Change Display', 'Primary Result Label', 'Primary Result Statement', 'Time Metric Label', 'Field Metric Label', 'Campaign', 'Campaign Subtitle', 'Photo Asset'] as const
const pos = (value: number | null | undefined) => value == null ? '—' : `P${value}`
const reasons: Record<string, string> = { NO_PROVEN_START_POSITION: 'The capture does not establish the race start.', NO_FINAL_CLASSIFICATION: 'No approved final classification is available.', MISSING_CATCH_MODEL: 'Timing catch, time ahead and field performance are unavailable for this factual card.' }
type View = 'TABLE' | 'CARD PREVIEW' | 'EXPORT PREVIEW'
type Sort = 'Kart No' | 'Peak Position' | 'latestObservedPosition' | 'Position Change' | 'Laps When Max Passed' | 'Time Spent Ahead of Max' | 'Field Performance Rank'

export function BaseballCardData({ sessionId, modelledScenario, eventSource = 'auto' }: { sessionId: string; modelledScenario?: CustomSimulationResult | null; eventSource?: 'auto'|'live'|'replay' }) {
  const [mode, setMode] = useState<'event' | 'modelled'>('event')
  const [reference, setReference] = useState<CustomSimulationResult | null>(null)
  const [runningReference, setRunningReference] = useState(false)
  const [referenceError, setReferenceError] = useState(false)
  const projection = useMemo(() => {
    const scenario = modelledScenario ?? reference
    if (!scenario) return null
    try { return projectModelledCards(scenario) } catch { return null }
  }, [modelledScenario, reference])
  const [view, setView] = useState<View>('TABLE')
  const [eventData, setData] = useState<BaseballCardDataResponse | null>(null)
  const {state:liveState} = useLiveEventSession(sessionId,eventSource==='live')
  const rebuilding = mode==='event' && (eventData?.metadata.sourceState==='REBUILDING' || (liveState?.sourceEpoch!==undefined && eventData?.metadata.sourceEpoch!==liveState.sourceEpoch))
  const data = mode === 'event' ? (rebuilding && eventData ? {...eventData,rows:[]} : eventData) : projection
  function switchMode(next: 'event' | 'modelled') { setMode(next); setSelectedId(null); setQuery(''); setStatus('ALL'); setSort('Kart No'); setDownloadError(false) }
  async function loadReference() {
    setRunningReference(true); setReferenceError(false)
    try { setReference(await runSimulation(CARD_REFERENCE)) } catch { setReferenceError(true) }
    finally { setRunningReference(false) }
  }
  const [error, setError] = useState(false)
  const [reload, setReload] = useState(0)
  const [query, setQuery] = useState('')
  const [status, setStatus] = useState('ALL')
  const [sort, setSort] = useState<Sort>('Kart No')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [downloading, setDownloading] = useState<string | null>(null)
  const [downloadError, setDownloadError] = useState(false)
  useEffect(() => {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    setData(null); setError(false); setSelectedId(null)
    async function refresh() {
      try {
        const result = await fetchBaseballCardData(sessionId, 'event', controller.signal, eventSource)
        if (!controller.signal.aborted) { setData(result); setError(false) }
      } catch { if (!controller.signal.aborted) setError(true) }
      finally { if (!controller.signal.aborted && eventSource === 'live') timer = setTimeout(refresh, 1000) }
    }
    void refresh()
    return () => { controller.abort(); clearTimeout(timer) }
  }, [sessionId, reload, eventSource])
  const rows = useMemo(() => (data?.rows ?? []).filter((row) =>
    `${row['Kart Display']} ${row['Participant ID']}`.toLowerCase().includes(query.trim().toLowerCase()) && (status === 'ALL' || row.status === status)
  ).sort((a, b) => {
    const x = a[sort], y = b[sort]
    if (x == null && y != null) return 1
    if (y == null && x != null) return -1
    return String(x ?? '').localeCompare(String(y ?? ''), undefined, { numeric: true }) || a['Card No'] - b['Card No']
  }), [data, query, status, sort])
  const index = Math.max(0, rows.findIndex((row) => row['Participant ID'] === selectedId))
  const selected = rows[index]
  const choose = (row: BaseballCardDataRow) => { setSelectedId(row['Participant ID']); setView('CARD PREVIEW') }
  const move = (delta: number) => { const row = rows[index + delta]; if (row) setSelectedId(row['Participant ID']) }
  async function download(format: 'xlsx' | 'csv') {
    setDownloading(format); setDownloadError(false)
    try {
      const response = await fetch(baseballCardDataExportUrl(sessionId, format, mode, eventSource), mode === 'modelled' ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) } : undefined)
      if (!response.ok) throw new Error('Download unavailable')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = url; anchor.download = `${data?.sessionId ?? sessionId}_card_data.${format}`
      document.body.append(anchor); anchor.click(); anchor.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch { setDownloadError(true) }
    finally { setDownloading(null) }
  }
  return <section className="event-section panel baseball-workspace" aria-labelledby="baseball-card-data-title">
    <header className="bc-heading"><div><p className="eyebrow">SOCIAL DATA / MARKETING HANDOFF</p><h2 id="baseball-card-data-title">Baseball Card Data</h2><p>Review the evidence. Prepare the handoff.</p></div><span>{mode === 'event' ? `EVENT${eventData?.metadata.sourceMode ? ` · ${eventData.metadata.sourceMode}` : ''} · FACTUAL OBSERVATION` : 'MODELLED · SIMULATED SCENARIO'}</span></header>
    {rebuilding && <p role="status">REBUILDING LIVE EVENT EVIDENCE</p>}
    {mode === 'event' && eventSource === 'live' && <p className="panel-note">{sessionId} · Current hot-path observation window. PARTIAL is expected. Reload preserves backend state; backend restart begins a new window.{error ? ' Updates unavailable · retaining the last snapshot.' : ''}</p>}
    <div className="bc-modes" role="group" aria-label="Card data mode"><button type="button" aria-pressed={mode === 'event'} onClick={() => switchMode('event')}>EVENT</button><button type="button" aria-pressed={mode === 'modelled'} onClick={() => switchMode('modelled')}>MODELLED</button><button type="button" disabled>PREDICTION VS REALITY</button></div>
    {mode === 'modelled' && <div className="bc-model-context"><strong>MODELLED TIMING CATCH</strong><p>{modelledScenario ? 'Existing Race Analysis result. No new simulation is run.' : 'Reference: 30 fixed laps, existing Synthetic100 timing-catch methodology and traffic-adjusted scenario.'}</p><p>Marketing wording is presentational only. It does not represent an observed physical overtake.</p>{!data && !modelledScenario && <button type="button" disabled={runningReference} onClick={() => void loadReference()}>{runningReference ? 'RUNNING EXISTING ENGINE…' : 'RUN SYNTHETIC100 REFERENCE'}</button>}{referenceError && <p role="alert">Scenario request failed. No fallback data was substituted.</p>}{modelledScenario && !projection && <p role="alert">The supplied scenario does not contain a supported Synthetic100 projection.</p>}</div>}
    <nav className="bc-views" aria-label="Baseball card views">{(['TABLE', 'CARD PREVIEW', 'EXPORT PREVIEW'] as View[]).map((item) => <button type="button" key={item} aria-pressed={view === item} onClick={() => setView(item)}>{item}</button>)}</nav>
    <div className="bc-handoff"><div><strong>{data ? `${data.rows.length} participant rows` : 'Awaiting participant data'}</strong><span>0 participant names · SC excluded · 24 marketing columns</span><small>{data?.rows.some((row) => row['Final Position'] != null) ? 'Final positions shown only where supported' : 'FINAL POSITION unavailable'} · Downloads contain all rows, independent of table filters.</small></div><div className="bc-downloads">{(['xlsx', 'csv'] as const).map((format) => <div key={format}><button type="button" disabled={!data?.rows.length || downloading !== null} onClick={() => void download(format)}>{downloading === format ? 'DOWNLOADING…' : `DOWNLOAD ${format.toUpperCase()}`}</button><small>{data?.sessionId ?? sessionId}_card_data.{format}</small></div>)}</div></div>
    {downloadError ? <p role="alert">Download failed. Please retry; no file was generated in the browser.</p> : null}
    {mode === 'event' && error && !data ? <p role="alert">Card data could not be loaded. <button type="button" onClick={() => setReload((value) => value + 1)}>Retry</button></p> : !data ? <p role="status">{mode === 'event' ? 'Loading card data…' : 'Select a supported scenario result to review modelled cards.'}</p> : <>
      {view !== 'EXPORT PREVIEW' ? <div className="bc-filters"><label>KART / PARTICIPANT<input aria-label="Filter baseball card data" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="KART 23 or AKS_23" /></label><label>CARD STATUS<select aria-label="Card data status" value={status} onChange={(event) => setStatus(event.target.value)}>{['ALL', 'READY', 'PARTIAL', 'UNAVAILABLE'].map((item) => <option key={item}>{item}</option>)}</select></label><label>SORT BY<select aria-label="Sort cards" value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="Kart No">Kart No</option><option value="Peak Position">Peak position</option><option value="latestObservedPosition">Latest observed position</option><option value="Position Change">Position change</option>{mode === 'modelled' && <><option value="Laps When Max Passed">Laps when Max passed</option><option value="Time Spent Ahead of Max">Time spent ahead of Max</option><option value="Field Performance Rank">Field performance rank</option></>}</select></label><span>{rows.length} / {data.rows.length} karts</span></div> : null}
      {view === 'TABLE' && mode === 'event' ? <div className="bc-scroll" tabIndex={0} role="region" aria-label="Participant card table"><table className="event-table"><thead><tr>{['Kart', 'Latest observed', 'Peak', 'Lap', 'Gap', 'Interval', 'Best valid lap', 'Start', 'Final', 'Card status'].map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row) => <tr key={row['Participant ID']} onClick={() => choose(row)}><td><button type="button" onClick={() => choose(row)}>{row['Kart Display']}</button></td><td>{pos(row.latestObservedPosition)}</td><td>{pos(row['Peak Position'])}</td><td>{row.observedLap ?? '—'}</td><td>{wallGap({position:row.latestObservedPosition ?? null,gapFirstSeconds:row.gapToLeaderSeconds ?? null})}</td><td>{wallSeconds(row.intervalSeconds)}</td><td>{wallLapTime(row.bestLapSeconds)}</td><td>{pos(row['Start Position'])}</td><td>{pos(row['Final Position'])}</td><td><span title={row.statusReasons.map((reason) => reasons[reason] ?? reason).join(' ')}>{row.status}</span></td></tr>)}</tbody></table></div> : null}
      {view === 'CARD PREVIEW' && selected ? <div className="bc-review" onKeyDown={(event) => { if ((event.target as HTMLElement).closest('input,select,button')) return; if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1) } if (event.key === 'ArrowRight') { event.preventDefault(); move(1) } }} tabIndex={0} aria-label="Card data preview">
        <aside className="bc-roster"><p>PARTICIPANT REVIEW</p><div>{rows.map((row) => <button type="button" key={row['Participant ID']} aria-pressed={selected === row} onClick={() => setSelectedId(row['Participant ID'])}><b>{row['Kart Display']}</b><small>Peak {pos(row['Peak Position'])} · {mode === 'event' ? 'Latest' : 'Final'} {pos(mode === 'event' ? row.latestObservedPosition : row['Final Position'])}</small></button>)}</div></aside>
        <div className="bc-card-stage"><div className="bc-navigation"><button type="button" disabled={index === 0} onClick={() => move(-1)}>Previous Kart</button><label><span className="bc-sr">Selected kart</span><select aria-label="Selected kart" value={selected['Participant ID']} onChange={(event) => setSelectedId(event.target.value)}>{rows.map((row) => <option key={row['Participant ID']} value={row['Participant ID']}>{row['Kart Display']}</option>)}</select></label><span>{index + 1} / {rows.length}</span><button type="button" disabled={index === rows.length - 1} onClick={() => move(1)}>Next Kart</button></div>
          {mode === 'event' ? <FactualBaseballCard row={selected} sourceMode={typeof data.metadata.sourceMode === 'string' ? data.metadata.sourceMode : undefined} /> : <ModelledBaseballCard row={selected} />}
        </div><aside className="bc-evidence"><p className="eyebrow">REVIEW NOTES</p><h3>{selected.status}</h3>{mode === 'modelled' ? <><p>Simulated timing catch only. Start is the existing lap-0 reconstructed rank, not Kart No or a physical grid claim. Peak is the best sampled position in the existing modelled trajectory.</p><p>Field Performance excludes incomparable challengers and the target. Tied catch times never count as earlier.</p><p>Kart number is a join key, not proof of identity. Event values remain separate.</p><p>Comparable catches: {data.metadata.comparableCatchCount}. Common kart keys: {data.rows.filter(row => eventData?.rows.some(event => String(event['Kart No']) === String(row['Kart No']))).length}.</p></> : <><p>Latest observed position is not final classification.</p><ul>{selected.statusReasons.map(reason => <li key={reason}>{reasons[reason] ?? reason}</li>)}</ul><p>Lap, gap and interval use captured AKS standings. Best lap uses explicitly valid records only.</p></>}<small>App-only context stays outside the 24-column marketing sheet.</small></aside>
      </div> : null}
      {view === 'TABLE' && mode === 'modelled' && <div className="bc-scroll" role="region" aria-label="Modelled card table" tabIndex={0}><table className="event-table"><thead><tr>{['Kart', 'Laps When Max Passed', 'Time Spent Ahead of Max', 'Field Performance', 'Start', 'Peak', 'Final', 'Change', 'Status'].map(h => <th key={h}>{h}</th>)}</tr></thead><tbody>{rows.map(row => <tr key={row['Participant ID']}><td><button type="button" onClick={() => choose(row)}>{row['Kart Display']}</button></td><td>{row['Laps When Max Passed']?.toFixed(1) ?? '—'}</td><td>{cardDuration(row['Time Spent Ahead of Max'])}</td><td>{row['Field Performance Display'] ?? '—'}</td><td>{row['Start Display']}</td><td>{row['Peak Display']}</td><td>{row['Final Display']}</td><td>{row['Change Display']}</td><td>{row.status}</td></tr>)}</tbody></table></div>}
      {view !== 'EXPORT PREVIEW' && !rows.length ? <p role="status">No participants match these filters.</p> : null}
      {view === 'EXPORT PREVIEW' ? <><p className="bc-export-note">Card Data. All {data.rows.length} rows. Participant Name and Photo Asset are intentionally blank. Latest observed, lap and gap are app-only context.</p><div className="bc-scroll bc-export" role="region" aria-label="Exact marketing export preview" tabIndex={0}><table className="event-table"><thead><tr>{MARKETING_HEADERS.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{data.rows.map((row) => <tr key={row['Card No']}>{MARKETING_HEADERS.map((header) => <td key={header}>{header === 'Participant Name' || header === 'Photo Asset' ? '' : header === 'Time Spent Ahead of Max' && row[header] !== null ? cardDuration(row[header]) : row[header] ?? ''}</td>)}</tr>)}</tbody></table></div></> : null}
    </>}
    <p className="bc-join">Race Intelligence exports anonymised data with explicit EVENT / MODELLED provenance. The authorised content team can enrich the export with driver identity and photography using Kart No.</p>
    <details className="bc-future"><summary>Prediction vs Reality — not enabled</summary><p>Future comparison uses Kart No only after the two projections are validated. No identity inference.</p></details>
  </section>
}
