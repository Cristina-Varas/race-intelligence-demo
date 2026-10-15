import { useEffect, useMemo, useRef, useState } from 'react'
import { fetchLiveSource } from '../api/raceIntelligence'
import { useLiveEventSession } from '../hooks/useLiveEventSession'
import './LiveEventStatePanel.css'
import { LiveRaceWall } from './LiveRaceWall'

const number = (value: number | null | undefined, digits = 3) => value == null ? '—' : value.toFixed(digits)
export function LiveSourcePanel({ wall = false }: { wall?: boolean }) {
  const [source, setSource] = useState<Awaited<ReturnType<typeof fetchLiveSource>> | null>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let active = true
    fetchLiveSource().then(value => { if (active) setSource(value) }).catch(() => { if (active) setError(true) })
    return () => { active = false }
  }, [])
  return source ? wall ? <LiveRaceWall sessionId={source.sessionId} mode={source.mode} /> : <LiveEventStatePanel sessionId={source.sessionId} mode={source.mode} speed={source.speed} /> : <p role="status">{error ? 'Operational source unavailable.' : 'Connecting to operational source…'}</p>
}
export function LiveEventStatePanel({ sessionId, wall = false, mode, speed }: { sessionId: string; wall?: boolean; mode?: string; speed?: number | null }) {
  const { state, error, selectedParticipantId, selectParticipant } = useLiveEventSession(sessionId, true)
  const connection = state?.connection, standings = state?.standings ?? []
  const selected = selectedParticipantId ?? standings[0]?.participantId ?? null
  const row = standings.find(item => item.participantId === selected)
  const lap = selected ? state?.latestLaps?.[selected] : null
  const points = state?.positions.GPS_CORRECTED.filter(p => p.latitude != null && p.longitude != null && Number.isFinite(p.latitude) && Number.isFinite(p.longitude)) ?? []
  // Observed coordinate extent only; no inferred official circuit/route.
  const extent = useRef<number[] | null>(null)
  const bounds = useMemo(() => {
    if (!points.length) return extent.current ?? [0, 1, 0, 1]
    const lat = points.map(p => p.latitude!), lon = points.map(p => p.longitude!)
    const next = [Math.min(...lat), Math.max(...lat), Math.min(...lon), Math.max(...lon)]
    const old = extent.current
    extent.current = old ? [Math.min(old[0], next[0]), Math.max(old[1], next[1]), Math.min(old[2], next[2]), Math.max(old[3], next[3])] : next
    return extent.current
  }, [state?.positions])
  const latScale = Math.cos((bounds[0] + bounds[1]) / 2 * Math.PI / 180)
  const scale = 480 / Math.max(.00001, bounds[1] - bounds[0], (bounds[3] - bounds[2]) * latScale)
  return <section className={`event-hot-path ${wall ? 'event-hot-path-wall' : ''}`} data-live-version={state?.stateVersion ?? 0}>
    <header className="hot-header"><div><p>{state?.operationalContext ?? 'REHEARSAL'} · FACTUAL OBSERVATION · {state?.sourceMode ?? mode ?? 'SOURCE'}</p><h2>AKS operational state</h2><small>{sessionId}{speed ? ` · ${speed}x replay` : ''}</small></div><div role="status"><b>{connection?.status ?? (error || 'AWAITING SOURCE')}</b><span>Last ingest {number(connection?.lastUpdateAgeSeconds, 1)} s ago</span><span data-live-time>{state?.updatedAt ?? 'Awaiting observed data'}</span></div></header>
    <div className="hot-kpis"><div><small>OBSERVED LEADER</small><strong>#{standings[0]?.externalParticipantNumber ?? '—'}</strong></div><div><small>OBSERVED FIELD</small><strong>{standings.length}</strong></div><div><small>SELECTED KART</small><strong data-live-selected>{row ? `#${row.externalParticipantNumber}` : '—'}</strong></div><div><small>OBSERVED LAP</small><strong>L{row?.lapNumber ?? '—'}</strong></div><div><small>GAP TO LEADER</small><strong>{number(row?.gapFirstSeconds)} s</strong></div><div><small>CONNECTION / VERSION</small><strong>{connection?.connectionId ?? 0} / {state?.stateVersion ?? 0}</strong></div></div>
    <div className="hot-grid"><article className="hot-map"><h3>GPS CORRECTED · OBSERVED POSITIONS</h3><svg viewBox="0 0 640 540" preserveAspectRatio="xMidYMid meet" aria-label="Live corrected GPS positions">{points.map(p => {
      const x = 320 + (p.longitude! - (bounds[2]+bounds[3])/2)*latScale*scale
      const y = 270 - (p.latitude! - (bounds[0]+bounds[1])/2)*scale
      return <g key={p.sourceEntityId} data-live-marker={p.sourceEntityId} transform={`translate(${x} ${y})`} className={p.participantId === selected ? 'selected' : p.sourceEntityId === 'SC' ? 'sc' : ''} role="button" tabIndex={0} aria-label={`Select ${p.sourceEntityId}`} onClick={() => p.participantId && selectParticipant(p.participantId)} onKeyDown={e => { if (e.key === 'Enter' && p.participantId) selectParticipant(p.participantId) }}><circle r={p.participantId === selected ? 8 : 4} /><text x="10" y="4">{p.sourceEntityId === 'SC' ? 'SC' : `#${p.externalParticipantNumber}`}</text></g>
    })}</svg><p>Recorded positions, not inferred passes. SC is not a participant. RGPS_RAW remains separate.</p></article>
    <article className="hot-standings"><h3>OBSERVED STANDINGS · NOT FINAL</h3><div className="hot-table-scroll"><table><thead><tr><th>POS</th><th>KART</th><th>LAP</th><th>GAP</th></tr></thead><tbody>{standings.map(item => <tr key={item.participantId} data-live-standing={item.participantId} className={item.participantId === selected ? 'selected' : ''}><td>P{item.position ?? '—'}</td><td><button aria-pressed={item.participantId === selected} onClick={() => item.participantId && selectParticipant(item.participantId)}>#{item.externalParticipantNumber}</button></td><td>{item.lapNumber ?? '—'}</td><td>{number(item.gapFirstSeconds)}</td></tr>)}</tbody></table></div></article>
    <aside className="hot-detail"><h3>SELECTED PARTICIPANT</h3><strong>{selected ?? '—'}</strong><dl><dt>Observed position</dt><dd>P{row?.position ?? '—'}</dd><dt>Interval</dt><dd>{number(row?.gapPreviousSeconds)} s</dd><dt>Latest lap record</dt><dd>L{lap?.lapNumber ?? '—'} · {number(lap?.lapTimeSeconds)} s</dd><dt>Explicit lap validity</dt><dd>{lap?.lapValid == null ? '—' : String(lap.lapValid)}</dd></dl><h3>SAFE MOMENT CANDIDATES</h3><ul>{state?.eventMomentCandidates?.slice(-5).reverse().map((item, i) => <li key={`${item.observedAt}-${i}`}><b>{item.momentType.replaceAll('_', ' ')}</b><span>{item.participantId} · {number(item.previous)} → {number(item.current)}</span></li>)}</ul><small>Candidates only. No physical pass or final-result inference.</small></aside></div>
    <footer className="hot-lifecycle">{(['connectedAt','disconnectedAt','reconnectStartedAt','reconnectedAt','subscriptionsRestoredAt'] as const).map(key => <span key={key}>{key}: {connection?.[key] ?? '—'}</span>)}</footer>
  </section>
}
