import { Download, Expand, Flag, Plus, RefreshCw, ShieldCheck } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'

import { createEventMoment, eventSocialDataExportUrl, fetchEventMomentSnapshots, fetchEventMoments } from '../api/raceIntelligence'
import type { EventMoment, EventMomentSnapshot, EventMomentType } from '../types/raceIntelligence'

const TYPES: EventMomentType[] = ['PRE_RACE', 'START', 'MID_RACE', 'POSITION_CHANGE', 'GAP_CHANGE', 'LEADER_CHANGE', 'PREDICTION_CHANGE', 'TARGET_CHANGE', 'CONFIRMED_PASS', 'FASTEST_LAP', 'CHALLENGER_PERFORMANCE', 'KEY_MOMENT', 'CONTROL_ROOM_REACTION', 'END_OF_CAPTURE', 'FINISH', 'MANUAL_MARKER']
const OPERATOR_PRESETS: EventMomentType[] = ['PRE_RACE', 'START', 'KEY_MOMENT', 'CONFIRMED_PASS', 'CONTROL_ROOM_REACTION', 'END_OF_CAPTURE', 'FINISH', 'MANUAL_MARKER']

function utc(value: string | null | undefined) {
  if (!value) return 'Unavailable'
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : `${date.toISOString().replace('T', ' ').replace('.000Z', ' UTC').replace('Z', ' UTC')}`
}
function kart(value: string | null) { return value ? `KART ${value}` : 'KART unavailable' }
function value(change: EventMoment) { return change.deltaValue === null ? 'No structured delta' : `${change.deltaValue > 0 ? '+' : ''}${change.deltaValue}${change.unit ? ` ${change.unit}` : ''}` }

export function EventMoments({ sessionId, participantIds }: { sessionId: string; participantIds: string[] }) {
  const [moments, setMoments] = useState<EventMoment[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [type, setType] = useState('')
  const [mode, setMode] = useState('')
  const [priority, setPriority] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)
  const [snapshots, setSnapshots] = useState<Record<string, EventMomentSnapshot[]>>({})
  const [captureOpen, setCaptureOpen] = useState(false)

  const load = () => {
    setLoading(true); setError(null)
    fetchEventMoments(sessionId, { type: type || undefined, triggerMode: mode || undefined, priority: priority || undefined })
      .then(setMoments).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Event Moments could not be loaded.'))
      .finally(() => setLoading(false))
  }
  useEffect(load, [sessionId, type, mode, priority]) // filters form the one query shared with the operational table
  const types = useMemo(() => [...new Set(moments.map((moment) => moment.momentType))], [moments])
  const expand = (momentId: string) => {
    if (expanded === momentId) { setExpanded(null); return }
    setExpanded(momentId)
    if (!snapshots[momentId]) fetchEventMomentSnapshots(sessionId, momentId).then((items) => setSnapshots((current) => ({ ...current, [momentId]: items }))).catch(() => setSnapshots((current) => ({ ...current, [momentId]: [] })))
  }

  return <section className="event-moments" aria-labelledby="event-moments-title">
    <header className="event-moments-heading">
      <div><p className="eyebrow">EVENT MOMENTS</p><h2 id="event-moments-title">Editorially useful, evidence-bound moments</h2><p>Uses factual capture state and explicit operator markers. KART_NUMBER is the external creative-team join key.</p></div>
      <div className="event-moments-actions"><button type="button" onClick={load}><RefreshCw size={15} /> Refresh</button><a className="event-moments-export" href={eventSocialDataExportUrl(sessionId)}><Download size={15} /> Export XLSX</a><button type="button" className="capture-primary" onClick={() => setCaptureOpen((open) => !open)}><Plus size={15} /> Capture Moment</button></div>
    </header>
    <aside className="event-moment-governance"><ShieldCheck size={17} /><p><b>Observed is not modelled is not captured.</b> This workspace never stores names, photos, social handles or media assets. Confirmed passes need explicit factual or operator evidence.</p></aside>
    {captureOpen ? <OperatorMomentForm sessionId={sessionId} participants={participantIds} onCreated={(moment) => { setMoments((current) => [moment, ...current]); setCaptureOpen(false) }} /> : null}
    <div className="event-moment-filters" aria-label="Event Moment filters"><label>TYPE<select aria-label="Moment type filter" value={type} onChange={(event) => setType(event.target.value)}><option value="">All types</option>{(types.length ? types : TYPES).map((item) => <option key={item}>{item}</option>)}</select></label><label>MODE<select aria-label="Moment mode filter" value={mode} onChange={(event) => setMode(event.target.value)}><option value="">Automatic + operator</option><option>AUTOMATIC</option><option>OPERATOR</option></select></label><label>PRIORITY<select aria-label="Moment priority filter" value={priority} onChange={(event) => setPriority(event.target.value)}><option value="">All priorities</option><option>HIGH</option><option>MEDIUM</option><option>LOW</option></select></label><span>{moments.length} visible moments</span></div>
    {loading ? <p className="event-state" role="status">Loading Event Moments...</p> : null}
    {error ? <p className="event-error" role="alert">{error}</p> : null}
    {!loading && !error && moments.length === 0 ? <p className="event-state">No Event Moments have been captured for this session. Operator markers remain durable even when downstream serving is delayed.</p> : null}
    {moments.length ? <div className="event-table-scroll"><table className="event-table event-moment-table"><thead><tr><th>UTC timestamp</th><th>Moment</th><th>Participant / KART_NUMBER</th><th>Evidence</th><th>Priority</th><th>Change</th><th>State</th><th><span className="sr-only">Details</span></th></tr></thead><tbody>{moments.map((moment) => <Fragment key={moment.momentId}><tr><td><time>{utc(moment.observedAt)}</time></td><td><strong>{moment.momentType}</strong><small>{moment.title ?? moment.triggerRule ?? 'Structured operational moment'}</small></td><td><strong>{moment.primaryParticipantId ?? 'Session-level'}</strong><small>{kart(moment.externalParticipantNumber)}</small></td><td>{moment.evidenceDomain}<small>{moment.triggerMode}</small></td><td>{moment.socialPriority}</td><td>{value(moment)}</td><td>{moment.syncStatus ?? 'PENDING'}</td><td><button type="button" className="event-moment-expand" onClick={() => expand(moment.momentId)} aria-expanded={expanded === moment.momentId}><Expand size={15} /> Details</button></td></tr>{expanded === moment.momentId ? <tr className="event-moment-detail"><td colSpan={8}><MomentDetail moment={moment} snapshots={snapshots[moment.momentId]} /></td></tr> : null}</Fragment>)}</tbody></table></div> : null}
  </section>
}

function MomentDetail({ moment, snapshots }: { moment: EventMoment; snapshots: EventMomentSnapshot[] | undefined }) {
  const primary = snapshots?.find((snapshot) => snapshot.participantId === moment.primaryParticipantId)
  return <div className="event-moment-detail-grid"><article><b>Moment evidence</b><p>{moment.description ?? moment.operatorNote ?? 'No free-text description was supplied.'}</p><small>Source snapshot: {moment.sourceSnapshotId ?? 'Unavailable'} · recorded {utc(moment.recordedAt)}</small></article><article><b>Frozen baseball-card state</b>{primary ? <dl><div><dt>Start</dt><dd>{primary.startPosition ? `P${primary.startPosition}` : 'Unavailable'}</dd></div><div><dt>Peak</dt><dd>{primary.peakPosition ? `P${primary.peakPosition}` : 'Unavailable'}</dd></div><div><dt>Current</dt><dd>{primary.position ? `P${primary.position}` : 'Unavailable'}</dd></div><div><dt>Gap to leader</dt><dd>{primary.gapFirstSeconds ?? 'Unavailable'}</dd></div></dl> : <p>There is no factual participant snapshot at or before this moment.</p>}<small>Creative identity assets must be joined externally using KART_NUMBER.</small></article></div>
}

function OperatorMomentForm({ sessionId, participants, onCreated }: { sessionId: string; participants: string[]; onCreated: (moment: EventMoment) => void }) {
  const [momentType, setMomentType] = useState<EventMomentType>('KEY_MOMENT'); const [primary, setPrimary] = useState(''); const [related, setRelated] = useState(''); const [note, setNote] = useState(''); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null)
  const needsRelated = momentType === 'CONFIRMED_PASS'
  return <form className="event-moment-capture panel" onSubmit={(event) => { event.preventDefault(); if (needsRelated && (!primary || !related || primary === related)) { setError('A confirmed pass requires different primary and related participants.'); return } setPending(true); setError(null); createEventMoment(sessionId, { momentType, primaryParticipantId: primary || undefined, relatedParticipantId: related || undefined, operatorNote: note || undefined, socialPriority: 'HIGH', idempotencyKey: `${momentType}:${primary}:${related}:${Date.now()}` }).then(onCreated).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Moment could not be captured.')).finally(() => setPending(false)) }}><div><p className="eyebrow"><Flag size={14} /> OPERATOR CAPTURE</p><h3>Capture an event moment</h3><p>Timestamp and state snapshot are generated server-side. This is a durable capture acknowledgement, not a browser-only note.</p></div><label>PRESET / TYPE<select value={momentType} onChange={(event) => setMomentType(event.target.value as EventMomentType)}>{OPERATOR_PRESETS.map((item) => <option key={item}>{item}</option>)}</select></label><label>PRIMARY PARTICIPANT<select value={primary} onChange={(event) => setPrimary(event.target.value)}><option value="">Session-level marker</option>{participants.map((participant) => <option key={participant}>{participant}</option>)}</select></label><label>RELATED PARTICIPANT{needsRelated ? '*' : ''}<select value={related} onChange={(event) => setRelated(event.target.value)}><option value="">{needsRelated ? 'Select participant' : 'Not applicable'}</option>{participants.filter((participant) => participant !== primary).map((participant) => <option key={participant}>{participant}</option>)}</select></label><label className="capture-wide">OPERATOR NOTE<textarea value={note} onChange={(event) => setNote(event.target.value)} placeholder="Factual context or approved reaction" /></label>{error ? <p className="capture-validation" role="alert">{error}</p> : null}<button type="submit" className="capture-primary" disabled={pending}>{pending ? 'CAPTURING...' : 'CAPTURE MOMENT'}</button></form>
}
