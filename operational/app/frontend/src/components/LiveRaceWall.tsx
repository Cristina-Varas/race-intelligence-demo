import { useEffect, useMemo, useState } from 'react'
import { useLiveEventSession } from '../hooks/useLiveEventSession'
import type { LiveEventStanding } from '../types/raceIntelligence'
import { wallClock, wallGap, wallLapTime, wallMoments, wallPositions, wallProjection, wallSeconds } from '../utils/liveWallPresentation'
import { LiveTrackReference, type TrackReference } from '../utils/liveTrackReference'
import './LiveRaceWall.css'

export function LiveRaceWall({ sessionId, mode }: { sessionId: string; mode?: string }) {
  const { state, error, selectedParticipantId, selectParticipant } = useLiveEventSession(sessionId, true)
  const referenceSession = `${sessionId}:${state?.sourceEpoch ?? 1}`
  const accumulator = useMemo(() => new LiveTrackReference(referenceSession), [referenceSession])
  const [referenceState, setReferenceState] = useState<{ sessionId: string; reference: TrackReference } | null>(null)
  const [threshold, setThreshold] = useState(.5)
  const [healthOpen, setHealthOpen] = useState(false)
  useEffect(() => {
    if (state?.sessionId === sessionId) setReferenceState({sessionId:referenceSession,reference:accumulator.observe(state.positions.GPS_CORRECTED)})
  }, [accumulator, referenceSession, sessionId, state?.positions, state?.sessionId])
  const rows = state?.standings ?? [], leader = rows.find(row => row.position === 1)
  const selectedId = selectedParticipantId ?? leader?.participantId ?? rows[0]?.participantId
  const selected = rows.find(row => row.participantId === selectedId)
  const latestLap = selectedId ? state?.latestLaps?.[selectedId] : null
  const positions = useMemo(() => wallPositions(state?.positions.GPS_CORRECTED ?? []), [state?.positions])
  const reference = referenceState?.sessionId === referenceSession ? referenceState.reference : null
  const route = reference?.points ?? []
  const project = wallProjection(reference?.bounds.length ? reference.bounds : positions)
  const connection = state?.connection
  const status = error === 'RECONNECTING' ? 'RECONNECTING' : connection?.status ?? 'WAITING'
  const stale = connection?.stale || status === 'STALE'
  const moments = wallMoments(state?.eventMomentCandidates ?? [], threshold)
  const topRows = rows.slice(0, 12), pinned = selected && !topRows.some(row => row.participantId === selectedId)
  const label = (id: string) => {
    const row = rows.find(item => item.participantId === id)
    return row?.externalParticipantNumber ? `KART ${row.externalParticipantNumber}` : 'KART —'
  }
  const selectRow = (row: LiveEventStanding) => row.participantId && selectParticipant(row.participantId)
  const tableRow = (row: LiveEventStanding) => <tr key={row.participantId} data-wall-standing={row.participantId} className={`${row.position === 1 ? 'leader' : ''} ${row.participantId === selectedId ? 'selected' : ''}`} onClick={() => selectRow(row)}><td>P{row.position ?? '—'}</td><td><button aria-label={`Select kart ${row.externalParticipantNumber}`} aria-pressed={row.participantId === selectedId} onClick={() => selectRow(row)}>#{row.externalParticipantNumber ?? '—'}</button></td><td>{row.lapNumber ?? '—'}</td><td>{wallGap(row)}</td></tr>
  return <section className="live-control-room" data-live-version={state?.stateVersion ?? 0}>
    <header className="lcr-source"><div><span className={`lcr-status ${status.toLowerCase()}`}>{status}</span><span>{state?.operationalContext ?? 'REHEARSAL'} · FACTUAL OBSERVATION · {state?.sourceMode ?? mode ?? 'SOURCE'}</span></div><span title={state?.updatedAt ?? undefined} data-live-time={state?.updatedAt}>LAST UPDATE {connection?.lastUpdateAgeSeconds == null ? '—' : `${connection.lastUpdateAgeSeconds.toFixed(1)} s AGO`}</span></header>
    <div className="lcr-summary"><div><span>LEADER</span><strong>#{leader?.externalParticipantNumber ?? '—'}</strong></div><div><span>LAP <small>LEADER</small></span><strong>{leader?.lapNumber ?? '—'}</strong></div><div><span>FIELD</span><strong>{rows.length || '—'}</strong></div><div><span>SELECTED</span><strong data-live-selected>#{selected?.externalParticipantNumber ?? '—'}</strong></div><div><span>SELECTED GAP</span><strong>{wallGap(selected)}</strong></div><div><span>STATUS</span><strong className={`lcr-status ${status.toLowerCase()}`}>{status}</strong></div></div>
    <div className="lcr-zones"><article className="lcr-map"><header><h2>TRACK MAP</h2><span>GPS CORRECTED</span></header>
      <div className="lcr-map-frame">{stale ? <b className="lcr-stale-overlay">STALE DATA · LAST KNOWN POSITIONS</b> : null}
      <svg viewBox="0 0 760 620" preserveAspectRatio="xMidYMid meet" aria-label="GPS-derived track reference and live karts">
        {route.length > 1 ? <><polyline className="lcr-track-underlay" points={route.map(p => { const {x,y}=project(p); return `${x},${y}` }).join(' ')} /><polyline data-track-reference className="lcr-track-line" points={route.map(p => { const {x,y}=project(p); return `${x},${y}` }).join(' ')} /></> : null}
        {positions.map(p => { const {x,y}=project(p); const isSelected = p.participantId === selectedId, isLeader = p.participantId === leader?.participantId, sc = p.sourceEntityId === 'SC'
          return <g key={p.sourceEntityId} data-live-marker={p.sourceEntityId} transform={`translate(${x} ${y})`} className={`lcr-marker ${isSelected ? 'selected' : ''} ${isLeader ? 'leader' : ''} ${sc ? 'sc' : ''}`} role={sc ? 'img' : 'button'} tabIndex={sc ? undefined : 0} aria-label={sc ? 'SC · non-participant' : `Select kart ${p.externalParticipantNumber}`} onClick={() => p.participantId && selectParticipant(p.participantId)} onKeyDown={e => { if ((e.key === 'Enter' || e.key === ' ') && p.participantId) { e.preventDefault(); selectParticipant(p.participantId) } }}>
            <title>{sc ? 'SC · non-participant' : `KART ${p.externalParticipantNumber} · ${p.participantId}`}</title>{sc ? <path d="M0 -7L7 0L0 7L-7 0Z" /> : <circle r={isSelected ? 8 : isLeader ? 6 : 3.8} />}
            <text className={isSelected || isLeader || sc ? 'always' : ''} x="12" y={isLeader && !isSelected ? -10 : 5}>{sc ? 'SC' : `#${p.externalParticipantNumber}`}</text>
          </g>
        })}
      </svg>{!reference?.ready ? <p className="lcr-reference-state">BUILDING TRACK REFERENCE · observed coverage only</p> : null}</div>
      <footer><span>{reference?.ready ? 'GPS-DERIVED TRACK REFERENCE' : 'Accumulating this session’s corrected GPS'} · not official geometry</span><div><b className="leader">● LEADER</b><b className="selected">● SELECTED</b><b>◆ SC · NON-PARTICIPANT</b></div></footer>
    </article>
    <article className="lcr-standings"><header><h2>LIVE STANDINGS</h2><span>OBSERVED · NOT FINAL</span></header><table><thead><tr><th>POS</th><th>KART</th><th>LAP</th><th>GAP</th></tr></thead><tbody>{topRows.map(tableRow)}</tbody></table>{pinned ? <div className="lcr-pinned"><span>YOUR SELECTED KART</span><table><tbody>{tableRow(selected)}</tbody></table></div> : null}<label className="lcr-select">SELECT ANY KART<select aria-label="Selected wall kart" value={selectedId ?? ''} onChange={e => selectParticipant(e.target.value)}><option value="" disabled>Choose kart</option>{rows.map(row => <option key={row.participantId} value={row.participantId ?? ''}>KART {row.externalParticipantNumber} · P{row.position ?? '—'}</option>)}</select></label></article>
    <aside className="lcr-right"><article className="lcr-kart"><header><h2>SELECTED KART</h2><span title={selectedId ?? undefined}>{selectedId ?? '—'}</span></header><h3>KART {selected?.externalParticipantNumber ?? '—'}</h3><dl><div><dt>POSITION</dt><dd>P{selected?.position ?? '—'}</dd></div><div><dt>LAP</dt><dd>L{selected?.lapNumber ?? '—'}</dd></div><div><dt>LAST LAP</dt><dd>{wallLapTime(latestLap?.lapTimeSeconds)}</dd></div><div><dt>GAP</dt><dd>{wallGap(selected)}</dd></div><div><dt>INTERVAL</dt><dd>{wallSeconds(selected?.gapPreviousSeconds)}</dd></div></dl>{latestLap?.lapValid === true ? <small className="lcr-valid">VALID LAP</small> : null}</article>
    <article className="lcr-moments"><header><h2>RECENT RACE MOMENTS</h2></header><ul>{moments.map(m => <li key={`${m.observedAt}-${m.index}`}><div><b>{m.momentType.replaceAll('_', ' ')}</b><time title={m.observedAt}>{wallClock(m.observedAt)} UTC</time></div><strong title={m.participantId}>{label(m.participantId)}</strong><span>{m.momentType === 'GAP_CHANGE' ? `${wallSeconds(m.previous)} → ${wallSeconds(m.current)}` : `P${m.previous} → P${m.current}`}</span></li>)}</ul>{!moments.length ? <p>No significant changes in the available observations.</p> : null}<small>Observed change candidates · not confirmed passes</small></article></aside></div>
    <footer className="lcr-health"><button aria-expanded={healthOpen} onClick={() => setHealthOpen(value => !value)}>SYSTEM HEALTH {healthOpen ? '−' : '+'}</button><span>SOURCE <b>AKS</b></span><span>CONNECTION <b>{status === 'LIVE' ? 'HEALTHY' : status}</b></span><span>RECONNECTS <b>{connection?.reconnectCount ?? 0}</b></span>{healthOpen ? <div className="lcr-diagnostics"><h3>SYSTEM HEALTH</h3><p>{sessionId} · connectionId {connection?.connectionId ?? 0} · stateVersion {state?.stateVersion ?? 0}</p><p>Source observation: {state?.updatedAt ?? '—'}</p><p>Track reference session: {referenceSession}</p>{(['connectedAt','disconnectedAt','reconnectStartedAt','reconnectedAt','subscriptionsRestoredAt'] as const).map(key => <p key={key}>{key}: {connection?.[key] ?? '—'}</p>)}<label>Presentation gap threshold (seconds)<input type="number" min="0" step="0.1" value={threshold} onChange={e => setThreshold(Math.max(0, Number(e.target.value)))} /></label><p>Filters this panel only; original Event Moment candidates are unchanged.</p></div> : null}</footer>
  </section>
}
