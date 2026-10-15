import { Expand, Minimize, MonitorUp, Pause, Play, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'

import {
  fetchEventObservedReplaySummary,
  fetchEventSessions,
  fetchEventStandings,
  fetchEventStandingsSeries,
  fetchEventTrackGeometry,
  fetchEventTrackReplay,
  fetchTrackTopology,
  runSimulation,
} from '../api/raceIntelligence'
import { useRaceIntelligence } from '../hooks/useRaceIntelligence'
import type { CustomSimulationResult, EventObservedReplaySummary, EventSessionSummary, EventTrackGeometry, StandingReplayRow, TrackReplayRow, TrackTopology } from '../types/raceIntelligence'
import { interpolateProbability } from '../utils/probability'
import { eventUtcIsoAt, eventUtcMilliseconds } from '../utils/eventReplayTime'
import { LiveSourcePanel } from './LiveEventStatePanel'

type WallMode = 'overview' | 'historical' | 'synthetic' | 'event' | 'live'
const modes: { id: WallMode; label: string; context: string }[] = [
  { id: 'overview', label: 'OVERVIEW', context: 'RACE INTELLIGENCE' },
  { id: 'historical', label: 'HISTORICAL · 16', context: 'HISTORICAL EVIDENCE' },
  { id: 'synthetic', label: 'SYNTHETIC · 100', context: 'MODELLED SCENARIO' },
  { id: 'event', label: 'AKS EVENT', context: 'REHEARSAL · AKS' },
  { id: 'live', label: 'AKS HOT PATH', context: 'OPERATIONAL SOURCE' },
]

function safeMode(): WallMode {
  const value = new URLSearchParams(window.location.search).get('mode')
  return value === 'historical' || value === 'synthetic' || value === 'event' || value === 'live' ? value : 'overview'
}

function number(value: number | null | undefined, digits = 0) {
  return value === null || value === undefined ? '—' : value.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: digits })
}

function seconds(value: number | null | undefined, digits = 3) {
  return value === null || value === undefined ? '—' : `${value.toFixed(digits)} s`
}

function clock(value: string | null | undefined) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function participantLabel(row: { externalParticipantNumber: string | null; participantId: string | null; sourceEntityId?: string | null }) {
  if (row.sourceEntityId === 'SC') return 'SC'
  return row.externalParticipantNumber ? `#${row.externalParticipantNumber}` : row.participantId ?? ('sourceEntityId' in row ? row.sourceEntityId : null) ?? '—'
}

function changeMode(mode: WallMode) {
  const url = new URL(window.location.href)
  url.searchParams.set('mode', mode)
  window.history.replaceState({}, '', url)
}

type DisplayChange = { previous: string; current: string; changedAt: number } | null

/**
 * Shared display-only change detection. It deliberately compares values already
 * supplied by the governed APIs; it never derives a new race event or metric.
 */
function useDisplayChange(value: string, duration = 1100): DisplayChange {
  const previous = useRef<string | null>(null)
  const [change, setChange] = useState<DisplayChange>(null)
  useEffect(() => {
    if (previous.current !== null && previous.current !== value) {
      const next = { previous: previous.current, current: value, changedAt: Date.now() }
      setChange(next)
      const timer = window.setTimeout(() => setChange((current) => current === next ? null : current), duration)
      previous.current = value
      return () => window.clearTimeout(timer)
    }
    previous.current = value
    return undefined
  }, [duration, value])
  return change
}

type WallUpdate = { id: string; at: string; message: string }
function useStateChangeFeed(entries: Array<{ key: string; value: string; message: (previous: string, current: string) => string }>, at: string) {
  const previous = useRef<Record<string, string>>({})
  const [updates, setUpdates] = useState<WallUpdate[]>([])
  useEffect(() => {
    const next = { ...previous.current }
    const additions: WallUpdate[] = []
    entries.forEach((entry) => {
      const old = previous.current[entry.key]
      if (old !== undefined && old !== entry.value) additions.push({ id: `${entry.key}-${Date.now()}-${entry.value}`, at, message: entry.message(old, entry.value) })
      next[entry.key] = entry.value
    })
    previous.current = next
    if (additions.length) setUpdates((current) => [...additions.reverse(), ...current].slice(0, 8))
  }, [at, entries])
  return updates
}

function WallKpi({ label, value, detail }: { label: string; value: string; detail?: string }) {
  const change = useDisplayChange(value)
  return <article className={`race-wall-kpi${change ? ' changed' : ''}`} data-wall-kpi={label}><span>{label}</span><strong>{value}</strong>{detail ? <small>{change ? `UPDATED · ${detail}` : detail}</small> : null}</article>
}

function WallState({ children, error }: { children: ReactNode; error?: boolean }) {
  return <section className={`race-wall-state${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>{children}</section>
}

function isAbortError(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  const cause = error instanceof Error ? error.cause : null
  return cause instanceof DOMException && cause.name === 'AbortError'
}

export function RaceWall() {
  const [mode, setMode] = useState<WallMode>(safeMode)
  const [isFullscreen, setIsFullscreen] = useState(Boolean(document.fullscreenElement))
  const { data, loading, error } = useRaceIntelligence()

  useEffect(() => {
    const onFullscreen = () => setIsFullscreen(Boolean(document.fullscreenElement))
    document.addEventListener('fullscreenchange', onFullscreen)
    return () => document.removeEventListener('fullscreenchange', onFullscreen)
  }, [])

  const selectMode = (next: WallMode) => { setMode(next); changeMode(next) }
  const fullscreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else if (document.documentElement.requestFullscreen) await document.documentElement.requestFullscreen()
    } catch { /* Browser policy should never stop the wall from remaining usable. */ }
  }
  const context = modes.find((entry) => entry.id === mode)?.context ?? 'RACE INTELLIGENCE'
  return <main className="race-wall" aria-label="Race Intelligence Wall">
    <header className="race-wall-header">
      <div className="race-wall-brand"><span className="brand-mark" aria-hidden="true" /><div><b>RACE INTELLIGENCE</b><small>PRESENTATION WALL</small></div></div>
      <nav aria-label="Race Wall mode">{modes.map((entry) => <button key={entry.id} type="button" className={mode === entry.id ? 'active' : ''} onClick={() => selectMode(entry.id)}>{entry.label}</button>)}</nav>
      <div className="race-wall-actions"><span>{context}</span><button type="button" onClick={fullscreen} aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}>{isFullscreen ? <Minimize size={15} /> : <Expand size={15} />}{isFullscreen ? 'EXIT FULL SCREEN' : 'FULL SCREEN'}</button><a href="/" aria-label="Exit Race Wall"><X size={15} /> EXIT RACE WALL</a></div>
    </header>
    {mode === 'live' ? <LiveSourcePanel wall /> : loading ? <WallState>LOADING GOVERNED RACE INTELLIGENCE…</WallState> : error || !data ? <WallState error>GOVERNED RACE INTELLIGENCE IS UNAVAILABLE. {error ?? ''}</WallState> : <WallContent mode={mode} data={data} selectMode={selectMode} />}
  </main>
}

function WallContent({ mode, data, selectMode }: { mode: WallMode; data: NonNullable<ReturnType<typeof useRaceIntelligence>['data']>; selectMode: (mode: WallMode) => void }) {
  if (mode === 'historical') return <HistoricalWall data={data} />
  if (mode === 'synthetic') return <SyntheticWall data={data} />
  if (mode === 'event') return <EventWall />
  return <OverviewWall data={data} selectMode={selectMode} />
}

function OverviewWall({ data, selectMode }: { data: NonNullable<ReturnType<typeof useRaceIntelligence>['data']>; selectMode: (mode: WallMode) => void }) {
  const [sessions, setSessions] = useState<EventSessionSummary[]>([])
  useEffect(() => { const controller = new AbortController(); fetchEventSessions(controller.signal).then(setSessions).catch(() => setSessions([])); return () => controller.abort() }, [])
  const session = sessions[0]
  return <div className="race-wall-body race-wall-overview">
    <section className="race-wall-title"><p>GOVERNED RACE INTELLIGENCE</p><h1>Three evidence domains. One clear boundary.</h1><span>HISTORICAL EVIDENCE ≠ MODELLED SCENARIO ≠ EVENT OBSERVATION</span></section>
    <section className="race-wall-domain-grid">
      <button className="race-wall-domain historical" onClick={() => selectMode('historical')}><em>01</em><p>HISTORICAL EVIDENCE</p><strong>{data.summary.supportedFieldSize} PARTICIPANTS</strong><span>Supplied timing data provides the governed analytical baseline.</span><small>VIRTUAL MAX · WHAT-IF ONLY</small></button>
      <button className="race-wall-domain synthetic" onClick={() => selectMode('synthetic')}><em>02</em><p>MODELLED SCENARIO</p><strong>SYNTHETIC · 100</strong><span>Deterministic field stress testing with an explicit scenario profile.</span><small>NOT HISTORICAL EVIDENCE</small></button>
      <button className="race-wall-domain event" onClick={() => selectMode('event')}><em>03</em><p>FACTUAL EVENT OBSERVATION</p><strong>{session?.participantCount ?? '—'} PARTICIPANTS</strong><span>{session?.sessionName ?? 'AKS event/rehearsal evidence'} is governed separately from model inputs.</span><small>{session?.operationalContext ?? 'EVENT'} · {session?.source ?? 'AKS'}</small></button>
    </section>
    <section className="race-wall-governance"><b>HISTORICAL EVIDENCE ≠ MODELLED SCENARIO ≠ EVENT OBSERVATION</b><span>Actual Event data is never automatically promoted into Historical Evidence.</span><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /></section>
  </div>
}

function HistoricalWall({ data }: { data: NonNullable<ReturnType<typeof useRaceIntelligence>['data']> }) {
  const probabilityAtP50 = data.summary.thresholds.p50 === null ? null : interpolateProbability(data.summary.thresholds.p50, data.curve)
  const sorted = [...data.drivers].sort((a, b) => a.pooledMedianPace - b.pooledMedianPace)
  const min = Math.min(...sorted.map((driver) => driver.pooledMedianPace)); const max = Math.max(...sorted.map((driver) => driver.pooledMedianPace))
  return <div className="race-wall-body race-wall-analysis">
    <section className="race-wall-mode-heading"><div><p>HISTORICAL EVIDENCE · GOVERNED BASELINE</p><h1>Observed 16</h1></div><aside><b>VIRTUAL MAX · WHAT-IF</b><span>Not measured Verstappen performance. Historical IDs are categorical source identifiers.</span></aside></section>
    <section className="race-wall-kpi-strip race-wall-historical-kpis"><WallKpi label="OBSERVED FIELD" value={number(data.summary.supportedFieldSize)} detail="CATEGORICAL PARTICIPANT IDS" /><WallKpi label="VIRTUAL MAX BASELINE" value={seconds(data.virtualMax.virtualMaxPaceSeconds)} detail="SYNTHETIC WHAT-IF PROFILE" /><WallKpi label="DETERMINISTIC MAX DELAY" value={`+${number(data.summary.deterministicMaxDelaySeconds, 2)} s`} detail="TIMING-CATCH LIMIT" /><WallKpi label="P(CATCH ALL | 0 s)" value={`${number(data.summary.probabilityAtZeroDelay * 100, 2)}%`} detail="GOVERNED MONTE CARLO" /><WallKpi label="P50 DELAY" value={`${number(data.summary.thresholds.p50, 1)} s`} detail="50% CATCH THRESHOLD" /><WallKpi label="MONTE CARLO RUNS" value={number(data.summary.simulations)} detail="GOVERNED UNCERTAINTY" /></section>
    <section className="race-wall-analysis-grid">
      <article className="race-wall-panel race-wall-curve"><header><span>MONTE CARLO CATCH PROBABILITY</span><b>HISTORICAL EVIDENCE + WHAT-IF</b></header><ProbabilityLine points={data.curve} thresholds={data.summary.thresholds} deterministicDelay={data.summary.deterministicMaxDelaySeconds} /><footer><span>P90 {number(data.summary.thresholds.p90, 1)} s</span><span>P80 {number(data.summary.thresholds.p80, 1)} s</span><span>P50 {number(data.summary.thresholds.p50, 1)} s</span><span>DETERMINISTIC {number(data.summary.deterministicMaxDelaySeconds, 2)} s</span></footer></article>
      <div className="race-wall-historical-side"><article className="race-wall-panel race-wall-ranking"><header><span>OBSERVED PACE vs VIRTUAL MAX</span><b>WHAT-IF IS DISTINCT</b></header><div className="race-wall-bars"><div className="vm"><span>VIRTUAL MAX</span><i style={{ width: '100%' }} /><b>{data.virtualMax.virtualMaxPaceSeconds.toFixed(3)} s · WHAT-IF</b></div>{sorted.slice(0, 8).map((driver) => <div key={driver.driverId}><span>#{driver.driverId}</span><i style={{ width: `${12 + ((max - driver.pooledMedianPace) / Math.max(.001, max - min)) * 88}%` }} /><b>{driver.pooledMedianPace.toFixed(3)} s · +{(driver.pooledMedianPace - data.virtualMax.virtualMaxPaceSeconds).toFixed(3)}</b></div>)}</div></article><article className="race-wall-panel race-wall-thresholds"><header><span>START-DELAY CONFIDENCE</span><b>MONTE CARLO THRESHOLDS</b></header><div><strong>P90</strong><b>{number(data.summary.thresholds.p90, 1)} s</b><span>90% catch probability threshold</span></div><div><strong>P80</strong><b>{number(data.summary.thresholds.p80, 1)} s</b><span>80% catch probability threshold</span></div><div><strong>P50</strong><b>{number(data.summary.thresholds.p50, 1)} s</b><span>50% catch probability threshold</span></div><small>Raw 299-lap variability observations are not part of the historical frontend contract, so no distribution is fabricated here.</small></article></div>
    </section>
    <p className="race-wall-footer-note">Timing catch only. Historical evidence, scenario assumptions and Monte Carlo uncertainty remain distinct.</p>
  </div>
}

function SyntheticWall({ data }: { data: NonNullable<ReturnType<typeof useRaceIntelligence>['data']> }) {
  const [result, setResult] = useState<CustomSimulationResult | null>(null); const [topology, setTopology] = useState<TrackTopology | null>(null); const [failed, setFailed] = useState(false)
  const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(10); const [scenarioTime, setScenarioTime] = useState(0)
  // Exact same compact request as the validated Synthetic 100 bootstrap in App.
  useEffect(() => {
    const controller = new AbortController()
    setFailed(false)
    runSimulation({ fieldMode: 'synthetic_100', raceLaps: data.summary.raceLaps, virtualMaxAdvantageSecondsPerLap: data.virtualMax.assumedAdvantageSecondsPerLap, startingDelaySeconds: data.summary.thresholds.p50 ?? 1.5, simulations: data.summary.simulations }, controller.signal)
      .then((next) => { setResult(next); setScenarioTime(0); setFailed(false) })
      .catch((error: unknown) => { if (!isAbortError(error)) setFailed(true) })
    return () => controller.abort()
  }, [data])
  useEffect(() => {
    const controller = new AbortController()
    fetchTrackTopology(controller.signal).then(setTopology).catch(() => setTopology(null))
    return () => controller.abort()
  }, [])
  const entities = result?.syntheticReplay?.entities ?? result?.syntheticReplay?.drivers ?? []
  const orderedTargets = useMemo(() => [...(result?.drivers ?? [])]
    .filter((driver) => driver.catchLapExact !== null)
    .sort((left, right) => (left.catchLapExact ?? Infinity) - (right.catchLapExact ?? Infinity)), [result?.drivers])
  const duration = result ? Math.max(result.raceLaps * result.virtualMaxPace + result.startingDelaySeconds, result.pureTiming?.projectedFinishTimeSeconds ?? 0) : 0
  const scenarioLap = result ? Math.max(0, (scenarioTime - result.startingDelaySeconds) / Math.max(.001, result.virtualMaxPace)) : 0
  const caught = orderedTargets.filter((driver) => (driver.catchLapExact ?? Infinity) <= scenarioLap).length
  const remaining = Math.max(0, entities.length - caught)
  const target = orderedTargets.find((driver) => (driver.catchLapExact ?? Infinity) > scenarioLap) ?? null
  const timing = result?.timing ?? null
  const modelSummary = result?.pureTiming ?? null
  const targetContext = orderedTargets.filter((driver) => (driver.catchLapExact ?? Infinity) > scenarioLap).slice(0, 5)
  useEffect(() => {
    if (!playing || !duration) return
    const id = window.setInterval(() => setScenarioTime((current) => current >= duration ? 0 : Math.min(duration, current + speed * .1)), 100)
    return () => window.clearInterval(id)
  }, [duration, playing, speed])
  const updates = useStateChangeFeed([
    { key: 'synthetic-target', value: target?.driverId ?? 'ALL TARGETS PROCESSED', message: (_previous, next) => `NEXT TARGET → ${next}` },
    { key: 'synthetic-caught', value: String(caught), message: (previous, next) => `TIMING TARGETS CAUGHT ${previous} → ${next}` },
    { key: 'synthetic-state', value: scenarioLap === 0 ? 'WAITING TO START' : `L${scenarioLap.toFixed(2)}`, message: (_previous, next) => `VIRTUAL MAX MODEL STATE → ${next}` },
  ], `L${scenarioLap.toFixed(2)}`)
  return <div className="race-wall-body race-wall-synthetic">
    <section className="race-wall-mode-heading"><div><p>MODELLED SCENARIO · SYNTHETIC FIELD</p><h1>Synthetic 100</h1></div><aside className="race-wall-live-status"><b><i /> MODELLED REPLAY · L{scenarioLap.toFixed(2)}</b><span>Illustrative synthetic field. It is not historical evidence or GPS telemetry.</span><small>WINDOW · {speed}x · LAST RENDERED NOW</small></aside></section>
    {!result && !failed ? <WallState>BUILDING THE DEFAULT SYNTHETIC SCENARIO…</WallState> : null}{failed ? <WallState error>SCENARIO TEMPORARILY UNAVAILABLE</WallState> : null}
    {result && entities.length === 0 ? <WallState error>SCENARIO RESPONSE HAS NO SYNTHETIC REPLAY ENTITIES</WallState> : null}
    {result && entities.length > 0 ? <>
      <section className="race-wall-kpi-strip race-wall-synthetic-kpis">
        <WallKpi label="MODELLED FIELD" value={`${entities.length}`} detail="SYNTHETIC REPLAY ENTITIES" />
        <WallKpi label="VIRTUAL MAX" value={seconds(result.virtualMaxPace)} detail="WHAT-IF SCENARIO PROFILE" />
        <WallKpi label="CAUGHT" value={`${caught} / ${entities.length}`} detail="RECONSTRUCTED TIMING" />
        <WallKpi label="REMAINING" value={`${remaining}`} detail="UNCATCHED TIMING TARGETS" />
        <WallKpi label="NEXT TARGET" value={target?.driverId ?? '—'} detail={target?.catchLapExact === null || !target ? 'NO SUPPORTED TARGET' : `CATCH L${target.catchLapExact.toFixed(2)}`} />
        <WallKpi label="START DELAY" value={`+${number(result.startingDelaySeconds, 2)} s`} detail="SCENARIO ASSUMPTION" />
        <WallKpi label="PROJECTED FINISH" value={seconds(modelSummary?.projectedFinishTimeSeconds, 1)} detail="PURE TIMING · NOMINAL" />
      </section>
      <section className="race-wall-synthetic-main">
        <SyntheticTrackPanel topology={topology} entities={entities} target={target?.driverId ?? null} scenarioTime={scenarioTime} startingDelaySeconds={result.startingDelaySeconds} virtualMaxPace={result.virtualMaxPace} />
        <div className="race-wall-synthetic-right">
          <div className="race-wall-synthetic-detail-row">
            <article className="race-wall-panel race-wall-scenario-detail"><header><span>SCENARIO STATE</span><b>PURE TIMING · NOMINAL</b></header><dl><dt>Virtual Max gain</dt><dd>+{number(result.virtualMaxAdvantageSecondsPerLap, 3)} s/lap</dd><dt>Start delay</dt><dd>+{number(result.startingDelaySeconds, 2)} s</dd><dt>Modelled replay</dt><dd>{scenarioLap === 0 ? 'WAITING TO START' : `L${scenarioLap.toFixed(2)}`}</dd><dt>Projected finish</dt><dd>{seconds(modelSummary?.projectedFinishTimeSeconds, 1)}</dd></dl><div className="race-wall-playback"><button type="button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} />}{playing ? 'PAUSE' : 'PLAY'}</button><label> SPEED <select aria-label="Synthetic replay speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[1, 2, 5, 10, 30, 60].map((value) => <option key={value} value={value}>{value}x</option>)}</select></label><button type="button" className="race-wall-fit-window" onClick={() => setSpeed(Math.min(60, Math.max(1, Math.round(duration / 30))))}>FIT WINDOW</button><input aria-label="Synthetic replay timeline" type="range" min="0" max={duration || 1} step=".1" value={scenarioTime} onChange={(event) => { setPlaying(false); setScenarioTime(Number(event.target.value)) }} /></div><p>Reconstructed deterministic timing. No physical overtake claim.</p></article>
            <article className="race-wall-panel race-wall-target-context"><header><span>NEXT TARGET CONTEXT</span><b>ORDERED BY SUPPORTED TIMING CATCH</b></header><ol>{targetContext.map((driver, index) => <li key={driver.driverId} className={driver.driverId === target?.driverId ? 'next' : ''}><b>{index === 0 ? 'NEXT' : `+${index}`}</b><strong>{driver.driverId}</strong><span>{driver.catchLapExact === null ? '—' : `L${driver.catchLapExact.toFixed(2)}`}</span></li>)}</ol><p>Existing catch sequence only. This is not a physical running order.</p></article>
          </div>
          <div className="race-wall-synthetic-bottom"><article className="race-wall-panel race-wall-catch-progression"><header><span>CATCH PROGRESSION</span><b>FULL-FIELD TIMING CATCH {timing?.fullFieldCatchLap === null || timing?.fullFieldCatchLap === undefined ? '—' : `L${timing.fullFieldCatchLap}`} · {seconds(timing?.fullFieldCatchTimeSeconds, 3)}</b></header><CatchProgression drivers={result.drivers} raceLaps={data.summary.raceLaps} playheadLap={scenarioLap} /><p>Existing deterministic timing-catch sequence. It does not claim physical passes or positions.</p></article><StateChanges updates={updates} title="STATE CHANGES" /></div>
        </div>
      </section>
    </> : null}
  </div>
}

function venueTitle(session: EventSessionSummary | undefined) {
  // Jarama is approved rehearsal metadata already used by EventReplayPanels;
  // future captured session labels can carry their own venue without coordinate inference.
  if (session?.sessionId === 'REHEARSAL_AKS_4040') return 'JARAMA · RACE 1'
  return session?.sessionName ?? 'AKS Event'
}

function EventWall() {
  const [sessions, setSessions] = useState<EventSessionSummary[]>([]); const [sessionId, setSessionId] = useState<string | null>(null)
  const [summary, setSummary] = useState<EventObservedReplaySummary | null>(null); const [standings, setStandings] = useState<StandingReplayRow[]>([]); const [series, setSeries] = useState<StandingReplayRow[]>([]); const [geometry, setGeometry] = useState<EventTrackGeometry | null>(null); const [track, setTrack] = useState<TrackReplayRow[]>([]); const [selected, setSelected] = useState<string | null>(null); const [playing, setPlaying] = useState(false); const [windowSeconds, setWindowSeconds] = useState(60); const [speed, setSpeed] = useState(10); const [cursor, setCursor] = useState(0)
  const [errors, setErrors] = useState<{ session?: string; summary?: string; standings?: string; geometry?: string; replay?: string; analytics?: string }>({})
  useEffect(() => { const c = new AbortController(); fetchEventSessions(c.signal).then((rows) => { setSessions(rows); setSessionId(rows[0]?.sessionId ?? null); setErrors((current) => ({ ...current, session: undefined })) }).catch((error: unknown) => { if (!isAbortError(error)) setErrors({ session: 'Event sessions unavailable' }) }); return () => c.abort() }, [])
  // These read products intentionally load independently: replay samples are optional
  // presentation evidence, not a dependency of summary, standings, or geometry.
  useEffect(() => { if (!sessionId) return; const c = new AbortController(); setErrors({}); fetchEventObservedReplaySummary(sessionId, c.signal).then((next) => { setSummary(next); setErrors((current) => ({ ...current, summary: undefined })) }).catch((error: unknown) => { if (!isAbortError(error)) setErrors((current) => ({ ...current, summary: 'Observed summary unavailable' })) }); fetchEventStandings(sessionId, { limit: 500 }, c.signal).then((rows) => { setStandings(rows); setSelected((current) => current ?? [...rows].sort((a,b) => (a.position ?? 999) - (b.position ?? 999))[0]?.participantId ?? null); setErrors((current) => ({ ...current, standings: undefined })) }).catch((error: unknown) => { if (!isAbortError(error)) setErrors((current) => ({ ...current, standings: 'Observed standings unavailable' })) }); fetchEventTrackGeometry(sessionId, c.signal).then((next) => { setGeometry(next); setErrors((current) => ({ ...current, geometry: undefined })) }).catch((error: unknown) => { if (!isAbortError(error)) setErrors((current) => ({ ...current, geometry: 'Track reference unavailable' })) }); return () => c.abort() }, [sessionId])
  const sessionStart = eventUtcMilliseconds(summary?.positionFirstObservedAt) ?? 0; const sessionEnd = eventUtcMilliseconds(summary?.positionLastObservedAt) ?? 0; const windowStart = sessionEnd ? Math.max(sessionStart, sessionEnd - windowSeconds * 1000) : 0
  useEffect(() => { if (!sessionId || !sessionEnd) return; const c = new AbortController(); fetchEventTrackReplay(sessionId, { positionSource: 'GPS_CORRECTED', fromTime: eventUtcIsoAt(windowStart), toTime: eventUtcIsoAt(sessionEnd), resolutionSeconds: 1, limit: 5000 }, c.signal).then((rows) => { setTrack(rows); setCursor(eventUtcMilliseconds(rows[0]?.observedAt) ?? sessionEnd); setErrors((current) => ({ ...current, replay: undefined })) }).catch((error: unknown) => { if (!isAbortError(error)) setErrors((current) => ({ ...current, replay: 'Replay temporarily unavailable' })) }); return () => c.abort() }, [sessionId, sessionEnd, windowStart])
  useEffect(() => { if (!sessionId || !sessionStart || !sessionEnd) return; const c = new AbortController(); const query = { fromTime: eventUtcIsoAt(sessionStart), toTime: eventUtcIsoAt(sessionEnd), topN: 10, resolutionSeconds: 30, limit: 1500 }; const selectedQuery = selected ? fetchEventStandingsSeries(sessionId, { ...query, participantId: selected }, c.signal) : Promise.resolve([]); Promise.all([fetchEventStandingsSeries(sessionId, query, c.signal), selectedQuery]).then(([top, focus]) => { const unique = new Map<string, StandingReplayRow>(); [...top, ...focus].forEach((row) => unique.set(`${row.participantId}-${row.snapshotId}-${row.observedAt}`, row)); setSeries([...unique.values()]); setErrors((current) => ({ ...current, analytics: undefined })) }).catch((error: unknown) => { if (!isAbortError(error)) setErrors((current) => ({ ...current, analytics: 'Temporal analytics unavailable' })) }); return () => c.abort() }, [sessionId, sessionStart, sessionEnd, selected])
  const timestamps = useMemo(() => track.map((row) => eventUtcMilliseconds(row.observedAt)).filter((value): value is number => value !== null).sort((a, b) => a - b), [track]); const start = timestamps[0] ?? 0; const end = timestamps[timestamps.length - 1] ?? 0
  useEffect(() => { if (!playing || !start || !end) return; const id = window.setInterval(() => setCursor((current) => current >= end ? start : Math.min(end, current + speed * 100)), 100); return () => window.clearInterval(id) }, [playing, speed, start, end])
  const markers = useMemo(() => { const latest = new Map<string, TrackReplayRow>(); track.forEach((row) => { const time = eventUtcMilliseconds(row.observedAt); const key = row.sourceEntityId ?? row.participantId; if (key && time !== null && time <= cursor && row.latitude !== null && row.longitude !== null) latest.set(key, row) }); return [...latest.values()] }, [track, cursor])
  const currentSnapshotTime = useMemo(() => [...new Set(series.map((row) => eventUtcMilliseconds(row.observedAt)).filter((value): value is number => value !== null && value <= cursor))].sort((a, b) => b - a)[0] ?? null, [cursor, series])
  const cursorStandings = useMemo(() => currentSnapshotTime === null ? [] : series.filter((row) => eventUtcMilliseconds(row.observedAt) === currentSnapshotTime), [currentSnapshotTime, series])
  const selectedStanding = useMemo(() => {
    const focused = cursorStandings.find((row) => row.participantId === selected)
    if (focused) return focused
    return [...series].filter((row) => row.participantId === selected && (eventUtcMilliseconds(row.observedAt) ?? Infinity) <= cursor).sort((a, b) => (eventUtcMilliseconds(b.observedAt) ?? 0) - (eventUtcMilliseconds(a.observedAt) ?? 0))[0] ?? standings.find((row) => row.participantId === selected) ?? null
  }, [cursor, cursorStandings, selected, series, standings])
  const selectedMarker = markers.find((row) => row.participantId === selected) ?? null
  const participantRows = standings.filter((row) => row.participantId); const latest = [...(cursorStandings.length ? cursorStandings : standings)].sort((a,b) => (a.position ?? 999) - (b.position ?? 999)); const session = sessions.find((entry) => entry.sessionId === sessionId)
  const updates = useStateChangeFeed([
    { key: 'event-leader', value: participantLabel(latest[0] ?? { participantId: null, externalParticipantNumber: null }), message: (previous, next) => `LEADER ${previous} → ${next}` },
    { key: 'event-position', value: String(selectedStanding?.position ?? '—'), message: (previous, next) => `${participantLabel(selectedStanding ?? { participantId: selected, externalParticipantNumber: null })} P${previous} → P${next}` },
    { key: 'event-gap', value: selectedStanding?.gapFirstSeconds?.toFixed(3) ?? '—', message: (previous, next) => `${participantLabel(selectedStanding ?? { participantId: selected, externalParticipantNumber: null })} GAP ${previous} s → ${next} s` },
    { key: 'event-status', value: selectedStanding?.status ?? '—', message: (_previous, next) => `${participantLabel(selectedStanding ?? { participantId: selected, externalParticipantNumber: null })} STATUS → ${next}` },
  ], cursor ? clock(new Date(cursor).toISOString()) : '—')
  return <div className="race-wall-body race-wall-event">
    <section className="race-wall-mode-heading"><div><p>FACTUAL OBSERVATION · {session?.operationalContext ?? 'REHEARSAL'} · {session?.source ?? 'AKS'}</p><h1>{venueTitle(session)}</h1></div><aside className="race-wall-live-status"><b><i /> REPLAY · {cursor ? clock(new Date(cursor).toISOString()) : '—'}</b><span>WINDOW {windowSeconds >= 60 ? `${windowSeconds / 60} MIN` : `${windowSeconds} S`} · {speed}x · LAST RENDERED NOW</span></aside></section>
    {errors.session ? <WallState error>EVENT SESSION TEMPORARILY UNAVAILABLE</WallState> : null}
    <section className="race-wall-kpi-strip"><WallKpi label="OBSERVED LEADER" value={participantLabel(latest[0] ?? { participantId: null, externalParticipantNumber: null })} detail="CURSOR-ALIGNED SNAPSHOT" /><WallKpi label="OBSERVED LAP" value={selectedStanding?.lapNumber === null || selectedStanding?.lapNumber === undefined ? '—' : `L${selectedStanding.lapNumber}`} detail="CURSOR-ALIGNED" /><WallKpi label="FIELD" value={number(session?.participantCount)} detail="CAPTURED PARTICIPANTS" /><WallKpi label="FIELD SPREAD" value={seconds(latest.reduce<number | null>((maximum, row) => Math.max(maximum ?? 0, row.gapFirstSeconds ?? 0), null))} detail="OBSERVED GAP TO LEADER" /><WallKpi label="POSITION SOURCE" value="GPS CORRECTED" detail={`SC ${summary?.scSourceSampleCount ? 'PRESENT' : '—'}`} /><WallKpi label="OBSERVED TIME" value={cursor ? clock(new Date(cursor).toISOString()) : '—'} detail="REPLAY CURSOR" /></section>
    <section className="race-wall-event-main">
      <article className="race-wall-track"><header><span>OBSERVED TRACK REFERENCE - JARAMA</span><b>GPS-DERIVED · NOT OFFICIAL GEOMETRY</b></header>
        {errors.geometry ? <p className="race-wall-local-note">TRACK REFERENCE TEMPORARILY UNAVAILABLE</p> : <TrackMap geometry={geometry} markers={markers} selected={selected} onSelect={setSelected} />}
        {errors.replay ? <p className="race-wall-local-note">REPLAY TEMPORARILY UNAVAILABLE</p> : <div className="race-wall-playback"><button type="button" onClick={() => setPlaying((value) => !value)} disabled={!track.length}>{playing ? <Pause size={17} /> : <Play size={17} />}{playing ? 'PAUSE' : 'PLAY'}</button><label>WINDOW <select aria-label="Event replay window" value={windowSeconds} onChange={(event) => { setPlaying(false); setWindowSeconds(Number(event.target.value)) }}>{[[30, '30 S'], [60, '60 S'], [300, '5 MIN'], [900, '15 MIN']].map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>SPEED <select aria-label="Event replay speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{[1, 2, 5, 10, 30, 60].map((value) => <option key={value} value={value}>{value}x</option>)}</select></label><button type="button" className="race-wall-fit-window" onClick={() => setSpeed(Math.min(60, Math.max(1, Math.round((end - start) / 30_000))))}>FIT WINDOW</button><input aria-label="Replay timeline" type="range" min={start} max={end || start} step="1000" value={cursor || start} onChange={(event) => { setPlaying(false); setCursor(Number(event.target.value)) }} /><span>{cursor ? clock(new Date(cursor).toISOString()) : '—'}</span></div>}
      </article>
      <article className="race-wall-standings"><header><span>TOP 10 OBSERVED STANDINGS</span><b>CURSOR-ALIGNED · NOT FINAL</b></header>{errors.standings ? <p className="race-wall-local-note">STANDINGS TEMPORARILY UNAVAILABLE</p> : <><label className="race-wall-participant-select"><span>PARTICIPANT FOCUS</span><select aria-label="Wall participant selector" value={selected ?? ''} onChange={(event) => setSelected(event.target.value || null)}>{participantRows.map((row) => <option key={row.participantId} value={row.participantId ?? ''}>{participantLabel(row)} · {row.participantId}</option>)}</select></label><div className="race-wall-standing-columns"><span>POS</span><span>#</span><span>GAP</span><span>INT</span><span>LAP</span></div><div className="race-wall-standing-list">{latest.slice(0, 10).map((row) => <button data-standing-row={row.participantId ?? ''} type="button" className={`${row.participantId === selected ? 'selected ' : ''}${row.positionChange ? 'changed' : ''}`} key={row.participantId} onClick={() => setSelected(row.participantId)}><b>P{row.position ?? '—'}</b><strong>{participantLabel(row)}</strong><span>{typeof row.gapFirstSeconds === 'number' ? `+${row.gapFirstSeconds.toFixed(3)}` : '—'}</span><small>{typeof row.gapPreviousSeconds === 'number' ? `+${row.gapPreviousSeconds.toFixed(3)}` : '—'}</small><i>L{row.lapNumber ?? '—'} {row.positionChange ? `${row.positionChange > 0 ? '▲' : '▼'} ${Math.abs(row.positionChange)}` : ''}</i></button>)}</div></>}</article>
      <article className="race-wall-panel race-wall-selected-participant"><header><span>SELECTED PARTICIPANT</span><b>FACTUAL STATE</b></header>{selectedStanding ? <><strong>{participantLabel(selectedStanding)} · {selectedStanding.participantId}</strong><div><b>P{selectedStanding.position ?? '—'}</b><span>L{selectedStanding.lapNumber ?? '—'}</span></div><dl><dt>Gap to leader</dt><dd>{seconds(selectedStanding.gapFirstSeconds)}</dd><dt>Interval</dt><dd>{seconds(selectedStanding.gapPreviousSeconds)}</dd><dt>Status</dt><dd>{selectedStanding.status ?? '—'}</dd><dt>Position source</dt><dd>{selectedMarker?.positionSource ?? '—'}</dd></dl><p>{selectedMarker ? `Observed ${clock(selectedMarker.observedAt)}` : 'No replay marker in the selected window.'}</p></> : <p className="race-wall-local-note">SELECT A CAPTURED PARTICIPANT</p>}<StateChanges updates={updates} /></article>
    </section>
    {errors.analytics ? <p className="race-wall-local-note">TEMPORAL ANALYTICS TEMPORARILY UNAVAILABLE</p> : <section className="race-wall-chart-row"><WallTemporalChart title="POSITION OVER TIME" rows={series} metric="position" selected={selected} cursor={cursor} /><WallTemporalChart title={`GAP TO LEADER — ${selectedStanding ? participantLabel(selectedStanding) : 'SELECTED'}`} rows={series.filter((row) => row.participantId === selected)} metric="gap" selected={selected} cursor={cursor} /></section>}
  </div>
}

function ProbabilityLine({ points, thresholds, deterministicDelay }: { points: { delaySeconds: number; catchProbability: number }[]; thresholds: { p50: number | null; p80: number | null; p90: number | null }; deterministicDelay: number }) {
  const ordered = [...points].sort((a, b) => a.delaySeconds - b.delaySeconds)
  const min = ordered[0]?.delaySeconds ?? 0
  const max = ordered[ordered.length - 1]?.delaySeconds ?? 1
  const xFor = (delay: number) => 12 + ((delay - min) / Math.max(.001, max - min)) * 108
  const path = ordered.map((point, index) => `${index ? 'L' : 'M'} ${xFor(point.delaySeconds)} ${90 - point.catchProbability * 80}`).join(' ')
  const markers = [['P90', thresholds.p90], ['P80', thresholds.p80], ['P50', thresholds.p50], ['LIMIT', deterministicDelay]] as const
  return <svg className="race-wall-svg" viewBox="0 0 130 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Historical Monte Carlo catch probability"><path className="race-wall-gridline" d="M12 10H120M12 50H120M12 90H120" /><path className="race-wall-probability" d={path} />{markers.filter(([, value]) => value !== null && value >= min && value <= max).map(([label, value]) => <g className={label === 'LIMIT' ? 'race-wall-probability-marker limit' : 'race-wall-probability-marker'} key={label}><line x1={xFor(value as number)} x2={xFor(value as number)} y1="10" y2="90" /><text x={xFor(value as number) + 1} y="18">{label}</text></g>)}<text x="12" y="7">CATCH PROBABILITY %</text><text x="12" y="98">EARLIER START</text><text x="75" y="98">VIRTUAL MAX START OFFSET / DELAY (s)</text><text x="4" y="12">100</text><text x="5" y="52">50</text><text x="8" y="90">0</text></svg>
}

function CatchProgression({ drivers, raceLaps, playheadLap }: { drivers: CustomSimulationResult['drivers']; raceLaps: number; playheadLap: number }) {
  const catches = [...drivers].map((driver) => driver.catchLapExact).filter((lap): lap is number => lap !== null).sort((left, right) => left - right)
  const maxLap = Math.max(1, raceLaps)
  const xFor = (lap: number) => 52 + (Math.min(maxLap, Math.max(0, lap)) / maxLap) * 650
  const yFor = (count: number) => 84 - (count / Math.max(1, drivers.length)) * 70
  const points = [{ lap: 0, count: 0 }, ...catches.map((lap, index) => ({ lap, count: index + 1 }))]
  const path = points.map((point, index) => `${index ? 'L' : 'M'} ${xFor(point.lap)} ${yFor(point.count)}`).join(' ')
  return <svg className="race-wall-svg" viewBox="0 0 720 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Synthetic timing catch progression"><path className="race-wall-gridline" d="M52 14H702M52 49H702M52 84H702" /><path className="race-wall-catch-line" d={path} /><line className="race-wall-catch-limit" x1={xFor(catches[catches.length - 1] ?? 0)} x2={xFor(catches[catches.length - 1] ?? 0)} y1="14" y2="84" /><line data-synthetic-playhead="true" className="race-wall-playhead" x1={xFor(playheadLap)} x2={xFor(playheadLap)} y1="14" y2="84" /><text x="12" y="17">100</text><text x="18" y="52">50</text><text x="28" y="86">0</text><text x="52" y="96">L0</text><text x="680" y="96">L{maxLap}</text><text x="590" y="12">CAUGHT TARGETS</text></svg>
}

function SyntheticTrackPanel({ topology, entities, target, scenarioTime, startingDelaySeconds, virtualMaxPace }: { topology: TrackTopology | null; entities: Array<{ driverId: string; gridOffsetMeters?: number | null; paceSecondsPerLap?: number | null }>; target: string | null; scenarioTime: number; startingDelaySeconds: number; virtualMaxPace: number }) {
  const points = topology?.mainRoute.geometry ?? []
  const allPoints = [...points, ...(topology?.alternateRoutes.flatMap((route) => route.geometry) ?? [])]
  const latitudes = allPoints.map((point) => point.latitude); const longitudes = allPoints.map((point) => point.longitude)
  const minLat = latitudes.length ? Math.min(...latitudes) : 0; const maxLat = latitudes.length ? Math.max(...latitudes) : 1
  const minLng = longitudes.length ? Math.min(...longitudes) : 0; const maxLng = longitudes.length ? Math.max(...longitudes) : 1
  const project = (point: { latitude: number; longitude: number }) => ({ x: 7 + ((point.longitude - minLng) / Math.max(.000001, maxLng - minLng)) * 86, y: 93 - ((point.latitude - minLat) / Math.max(.000001, maxLat - minLat)) * 86 })
  const route = (routePoints: typeof points) => routePoints.map((point, index) => { const p = project(point); return `${index ? 'L' : 'M'} ${p.x} ${p.y}` }).join(' ')
  const atProgress = (progress: number) => {
    if (!points.length) return null
    const normalized = ((progress % 1) + 1) % 1
    const nextIndex = points.findIndex((point) => (point.normalizedDistance ?? 0) >= normalized)
    const next = points[nextIndex <= 0 ? 1 : nextIndex] ?? points[0]; const previous = points[nextIndex <= 0 ? 0 : nextIndex - 1] ?? points[0]
    const span = (next.normalizedDistance ?? 1) - (previous.normalizedDistance ?? 0) || 1
    const ratio = (normalized - (previous.normalizedDistance ?? 0)) / span
    return project({ latitude: previous.latitude + (next.latitude - previous.latitude) * ratio, longitude: previous.longitude + (next.longitude - previous.longitude) * ratio })
  }
  const length = topology?.mainRoute.lengthMeters ?? 2448
  const raceElapsed = Math.max(0, scenarioTime - startingDelaySeconds)
  return <article className="race-wall-panel race-wall-synthetic-track"><header><span>MAIN TRACK · MODELLED REPLAY</span><b>TOPOLOGY V2 · REVERSE</b></header>{topology ? <svg data-synthetic-entity-count={entities.length} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Modelled synthetic field on supplied Main track geometry"><path className="race-wall-synthetic-main-route" d={route(points)} />{topology.alternateRoutes.map((alternate) => <path key={alternate.routeId} className="race-wall-synthetic-alternate-route" d={route(alternate.geometry)} />)}{entities.map((entity, index) => { const progress = 1 - ((entity.gridOffsetMeters ?? 5 + index * 5) / length) + raceElapsed / Math.max(.001, entity.paceSecondsPerLap ?? virtualMaxPace); const point = atProgress(progress); return point ? <g key={entity.driverId} data-synthetic-entity={entity.driverId} className={`race-wall-synthetic-entity${entity.driverId === target ? ' next' : ''}`} transform={`translate(${point.x} ${point.y})`}><circle r=".65" /><title>{entity.driverId} · modelled fixed-pace replay position</title></g> : null })}{(() => { const point = atProgress(1 - ((entities.length * 5 + 14) / length) + raceElapsed / Math.max(.001, virtualMaxPace)); return point ? <g className="race-wall-synthetic-vm" transform={`translate(${point.x} ${point.y})`}><circle r="1.8" /><text x="2.6" y=".8">VM</text></g> : null })()}</svg> : <p className="race-wall-track-loading">LOADING GOVERNED MAIN-ROUTE GEOMETRY…</p>}<p>Supplied MAIN route; existing fixed nominal pace and illustrative 4-abreast grid animate the modelled replay. Not GPS telemetry or physical positions.</p></article>
}

function StateChanges({ updates, title = 'OBSERVED UPDATES' }: { updates: WallUpdate[]; title?: string }) {
  return <article className="race-wall-panel race-wall-state-changes"><header><span>{title}</span><b>STATE TRANSITIONS ONLY</b></header>{updates.length ? <ol>{updates.map((update, index) => <li className={index === 0 ? 'new' : ''} key={update.id}><time>{update.at}</time><span>{update.message}</span></li>)}</ol> : <p>WAITING FOR A SUPPORTED STATE CHANGE.</p>}</article>
}

function TrackMap({ geometry, markers, selected, onSelect }: { geometry: EventTrackGeometry | null; markers: TrackReplayRow[]; selected: string | null; onSelect: (id: string | null) => void }) { const points = [...(geometry?.points ?? []), ...markers.filter((row) => row.latitude !== null && row.longitude !== null).map((row) => ({ latitude: row.latitude as number, longitude: row.longitude as number }))]; const minLat = points.length ? Math.min(...points.map((point) => point.latitude)) : 0, maxLat = points.length ? Math.max(...points.map((point) => point.latitude)) : 1, minLng = points.length ? Math.min(...points.map((point) => point.longitude)) : 0, maxLng = points.length ? Math.max(...points.map((point) => point.longitude)) : 1; const project = (point: { latitude: number; longitude: number }) => ({ x: 6 + ((point.longitude - minLng) / Math.max(.000001, maxLng - minLng)) * 88, y: 94 - ((point.latitude - minLat) / Math.max(.000001, maxLat - minLat)) * 88 }); return <div className="race-wall-track-map"><svg data-track-geometry-points={geometry?.points.length ?? 0} viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Observed Jarama track replay">{geometry?.points.length ? <polyline className="race-wall-track-line" points={geometry.points.map((point) => { const p=project(point); return `${p.x},${p.y}` }).join(' ')} /> : null}{markers.map((row) => { const p = project({ latitude: row.latitude as number, longitude: row.longitude as number }); const key = row.participantId ?? row.sourceEntityId ?? 'unknown'; return <g data-replay-marker={key} className={`race-wall-map-marker ${row.participantId === selected ? 'selected' : row.isLeader ? 'leader' : row.sourceEntityId === 'SC' ? 'sc' : ''}`} key={key} transform={`translate(${p.x} ${p.y})`} onClick={() => row.participantId && onSelect(row.participantId)}><circle r={row.participantId === selected ? 2.7 : 1.6} /><title>{participantLabel(row)}</title></g> })}</svg><span>CAPTURED GPS-DERIVED GEOMETRY · {geometry?.pointCount ?? 0} REFERENCE POINTS</span></div> }

function WallTemporalChart({ title, rows, metric, selected, cursor }: { title: string; rows: StandingReplayRow[]; metric: 'position' | 'gap'; selected: string | null; cursor: number }) { const samples = rows.filter((row) => row.observedAt && (metric === 'position' ? row.position !== null : row.gapFirstSeconds !== null)); const times = samples.map((row) => Date.parse(row.observedAt as string)).filter(Number.isFinite); const minTime = Math.min(...times, 0), maxTime = Math.max(...times, 1); const values = samples.map((row) => metric === 'position' ? row.position as number : row.gapFirstSeconds as number); const minValue = Math.min(...values, 0), maxValue = Math.max(...values, 1); const paths = new Map<string, StandingReplayRow[]>(); samples.forEach((row) => { const id = row.participantId ?? 'unknown'; paths.set(id, [...(paths.get(id) ?? []), row]) }); const xy = (row: StandingReplayRow) => { const t = Date.parse(row.observedAt as string); const value = metric === 'position' ? row.position as number : row.gapFirstSeconds as number; return { x: 8 + ((t - minTime) / Math.max(1, maxTime - minTime)) * 84, y: 8 + ((value - minValue) / Math.max(.001, maxValue - minValue)) * 74 } }; const cursorX = 8 + ((cursor - minTime) / Math.max(1, maxTime - minTime)) * 84; const current = [...samples].filter((row) => row.participantId === selected && Date.parse(row.observedAt as string) <= cursor).sort((left, right) => Date.parse(right.observedAt as string) - Date.parse(left.observedAt as string))[0] ?? null; return <article className="race-wall-panel race-wall-temporal"><header><span>{title}</span><b>FACTUAL OBSERVATIONS</b></header>{samples.length ? <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label={title}><path className="race-wall-gridline" d="M8 8V82H92M8 45H92" />{[...paths.entries()].map(([id, points]) => <path key={id} className={id === selected ? 'selected' : ''} d={points.sort((a,b) => Date.parse(a.observedAt as string) - Date.parse(b.observedAt as string)).map((row,index) => { const p=xy(row); return `${index ? 'L' : 'M'} ${p.x} ${p.y}` }).join(' ')} />)}{cursor >= minTime && cursor <= maxTime ? <line data-chart-playhead="true" className="race-wall-playhead" x1={cursorX} x2={cursorX} y1="8" y2="82" /> : null}{current ? (() => { const point = xy(current); return <circle data-chart-current="true" className="race-wall-current-point" cx={point.x} cy={point.y} r="1.8" /> })() : null}<text x="8" y="96">{clock(new Date(minTime).toISOString())}</text><text x="78" y="96">{clock(new Date(maxTime).toISOString())}</text></svg> : <p>NO FACTUAL SERIES IN THE SELECTED WINDOW.</p>}</article> }
