import { CheckCircle2, CircleAlert, Clapperboard, Flag, FlagTriangleRight, Gauge, Play, Plus, Radio, Square, Users } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import {
  completeEventSession,
  createEventLap,
  createEventMediaMarker,
  createEventParticipant,
  createEventRaceEvent,
  createEventSession,
  fetchRecoverableEventCaptureSessions,
  startEventSession,
} from '../api/raceIntelligence'
import type { EventCaptureSessionState, EventWriteAcknowledgement } from '../types/raceIntelligence'
import { InfoTooltip } from './InfoTooltip'

type CaptureSession = { id: string; eventId: string; name: string; type: string; status: 'CREATED' | 'RECORDING' | 'COMPLETED'; operator: string; recovered?: boolean }
type CaptureParticipant = { id: string; name: string; kart: string; type: string }
type Activity = { id: string; at: string; label: string; detail: string; acknowledgement: EventWriteAcknowledgement }

const optionalNumber = (value: string) => value === '' ? undefined : Number(value)
const requestKey = () => globalThis.crypto?.randomUUID?.() ?? `capture-${Date.now()}-${Math.random().toString(36).slice(2)}`

function acknowledge(activity: Omit<Activity, 'id' | 'at'>, add: (item: Activity) => void) {
  add({ ...activity, id: activity.acknowledgement.id, at: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) })
}

export function EventCaptureConsole() {
  const [session, setSession] = useState<CaptureSession | null>(null)
  const [participants, setParticipants] = useState<CaptureParticipant[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [error, setError] = useState<string | null>(null)
  const [pending, setPending] = useState<string | null>(null)
  const [confirmComplete, setConfirmComplete] = useState(false)
  const idempotencyKeys = useRef(new Map<string, string>())
  const [recoverableSessions, setRecoverableSessions] = useState<EventCaptureSessionState[]>([])
  const [recoveryLoading, setRecoveryLoading] = useState(true)
  const [recoveryError, setRecoveryError] = useState<string | null>(null)

  useEffect(() => {
    const controller = new AbortController()
    fetchRecoverableEventCaptureSessions(controller.signal).then((available) => {
      if (!controller.signal.aborted) setRecoverableSessions(available)
    }).catch((reason: unknown) => {
      if (!controller.signal.aborted) setRecoveryError(reason instanceof Error ? reason.message : 'Recovery sessions could not be loaded.')
    }).finally(() => { if (!controller.signal.aborted) setRecoveryLoading(false) })
    return () => controller.abort()
  }, [])

  const isRecording = session?.status === 'RECORDING'
  const isCompleted = session?.status === 'COMPLETED'
  const addActivity = (item: Activity) => setActivities((current) => [item, ...current].slice(0, 8))
  const execute = async (label: string, action: (idempotencyKey: string) => Promise<EventWriteAcknowledgement>, detail: string, after?: (ack: EventWriteAcknowledgement) => void) => {
    setError(null); setPending(label)
    const keyId = `${label}:${detail}`
    const idempotencyKey = idempotencyKeys.current.get(keyId) ?? requestKey()
    idempotencyKeys.current.set(keyId, idempotencyKey)
    try {
      const acknowledgement = await action(idempotencyKey)
      idempotencyKeys.current.delete(keyId)
      acknowledge({ label, detail, acknowledgement }, addActivity)
      after?.(acknowledgement)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'The capture API did not accept this observation.')
    } finally { setPending(null) }
  }

  const participantOptions = useMemo(() => participants.map((participant) => <option key={participant.id} value={participant.id}>{participant.name || participant.id}{participant.kart ? ` · ${participant.kart}` : ''} · {participant.id}</option>), [participants])

  return <section className="event-capture-console" aria-labelledby="event-capture-title">
    <header className="event-capture-head">
      <div><p className="eyebrow">EVENT CAPTURE</p><h2 id="event-capture-title">Operator console</h2><p>Fast factual capture through the governed Event Capture API. Accepted records are append-only.</p></div>
      <div className="event-capture-provenance"><Radio size={16} /> OPERATOR SUBMITTED VIA RACE OPERATIONS API <InfoTooltip label="Provenance" definitionId="actual-event" /></div>
    </header>
    <p className="event-capture-rule"><strong>Timing Catch</strong> is a timing-derived condition. <strong>Physical Pass</strong> is a human-confirmed observed overtake; this console records only the latter.</p>
    {error ? <p className="event-error" role="alert"><CircleAlert size={16} /> <span><b>Capture was not accepted</b><br />{error}</span></p> : null}
    <p className="event-capture-announcement" aria-live="polite">{pending ? `${pending} is being submitted…` : activities[0] ? `${activities[0].label}: ${activities[0].acknowledgement.syncStatus}` : 'Ready for factual capture.'}</p>

    {!session ? <><RecoverySessions sessions={recoverableSessions} loading={recoveryLoading} error={recoveryError} onResume={(recovered) => {
      setSession({ id: recovered.sessionId, eventId: recovered.eventId ?? recovered.sessionId, name: recovered.sessionName ?? '', type: recovered.sessionType ?? 'RACE', status: recovered.status, operator: recovered.operator ?? '', recovered: true })
      setParticipants(recovered.participants.map((participant) => ({ id: participant.participantId, name: participant.displayName ?? '', kart: participant.kartId ?? '', type: participant.participantType ?? '' })))
      setActivities(recovered.recentCaptures.map((activity) => ({ id: activity.id, at: new Date(activity.recordedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }), label: activity.eventType ?? activity.operation, detail: [activity.participantId, activity.targetParticipantId && `→ ${activity.targetParticipantId}`, activity.title].filter(Boolean).join(' ') || activity.entityKind, acknowledgement: { id: activity.id, sessionId: recovered.sessionId, operation: activity.operation, syncStatus: activity.syncStatus, recordedAt: activity.recordedAt, message: '' } })))
    }} /><SessionCreate onCreate={(created) => setSession(created)} execute={execute} /></> : <>
      <section className="event-capture-session panel" aria-label="Capture session control">
        <div><p className="eyebrow">ACTIVE CAPTURE SESSION</p><h3>{session.name || session.id}</h3><p>{session.id} · {session.type} · {session.eventId}</p><small>{session.recovered ? 'Recovered from the Event Capture boundary. It will appear in serving views only after governed downstream processing.' : 'Created in this browser session. It will appear in serving views only after downstream processing.'}</small></div>
        <div className={`capture-status ${session.status.toLowerCase()}`}><span>LIFECYCLE</span><strong>{session.status}</strong>{session.type === 'REPLAY' ? <b>REHEARSAL / REPLAY CONTEXT</b> : null}</div>
        <div className="capture-session-actions">
          {session.status === 'CREATED' ? <button type="button" className="capture-primary" disabled={Boolean(pending)} onClick={() => execute('START RECORDING', () => startEventSession(session.id), session.id, () => setSession({ ...session, status: 'RECORDING' }))}><Play size={16} /> START RECORDING</button> : null}
          {session.status === 'RECORDING' && !confirmComplete ? <button type="button" className="capture-complete" disabled={Boolean(pending)} onClick={() => setConfirmComplete(true)}><Square size={15} /> COMPLETE SESSION</button> : null}
          {session.status === 'RECORDING' && confirmComplete ? <span className="capture-confirm"><b>Complete session?</b><button type="button" onClick={() => setConfirmComplete(false)}>Cancel</button><button type="button" disabled={Boolean(pending)} onClick={() => execute('COMPLETE SESSION', () => completeEventSession(session.id), session.id, () => setSession({ ...session, status: 'COMPLETED' }))}>Confirm complete</button></span> : null}
          {isCompleted ? <span className="capture-locked"><CheckCircle2 size={16} /> Capture locked — completed sessions cannot be reopened.</span> : null}
        </div>
      </section>

      <section className="capture-quick-grid" aria-label="Quick factual capture">
        <QuickAction icon={<FlagTriangleRight />} title="Physical pass" text="Human-confirmed overtake" disabled={!isRecording || Boolean(pending)} href="#capture-physical-pass" />
        <QuickAction icon={<CircleAlert />} title="Incident" text="Factual operator event" disabled={!isRecording || Boolean(pending)} href="#capture-incident" />
        <QuickAction icon={<Clapperboard />} title="Mark moment" text="Media/storytelling marker" disabled={!isRecording || Boolean(pending)} href="#capture-media" />
        <QuickAction icon={<Gauge />} title="Manual lap" text="Fallback only when needed" disabled={!isRecording || Boolean(pending)} href="#capture-lap" />
      </section>
      {!isRecording ? <p className="event-state">{isCompleted ? 'This completed session is read-only.' : 'Start recording before capturing factual observations.'}</p> : null}

      <section className="capture-grid">
        <ParticipantForm disabled={isCompleted || Boolean(pending)} session={session} execute={execute} onAdd={(participant) => setParticipants((current) => [...current, participant])} />
        <PhysicalPassForm disabled={!isRecording || Boolean(pending)} sessionId={session.id} options={participantOptions} participants={participants} execute={execute} />
        <IncidentForm disabled={!isRecording || Boolean(pending)} sessionId={session.id} options={participantOptions} execute={execute} />
        <MediaMarkerForm disabled={!isRecording || Boolean(pending)} sessionId={session.id} options={participantOptions} execute={execute} />
        <ManualLapForm disabled={!isRecording || Boolean(pending)} sessionId={session.id} options={participantOptions} execute={execute} />
      </section>
      <section className="capture-modelled-context panel"><p className="eyebrow">MODELLED CONTEXT</p><h3>Scenario snapshots remain separate</h3><p>The existing scenario-snapshot endpoint preserves model output, not a factual operator observation. It is deliberately not mixed into quick capture.</p></section>
      <ActivityFeed activities={activities} />
    </>}
  </section>
}

function SessionCreate({ execute, onCreate }: { execute: EventCaptureConsoleProps['execute']; onCreate: (session: CaptureSession) => void }) {
  const [eventId, setEventId] = useState(''); const [sessionId, setSessionId] = useState(''); const [name, setName] = useState(''); const [type, setType] = useState<CaptureSession['type']>('RACE'); const [operator, setOperator] = useState(''); const [notes, setNotes] = useState('')
  return <form className="capture-create panel" onSubmit={(event) => { event.preventDefault(); const trimmedEvent = eventId.trim(); if (!trimmedEvent) return; execute('CREATE SESSION', (idempotencyKey) => createEventSession({ eventId: trimmedEvent, sessionId: sessionId.trim() || undefined, sessionType: type as 'PRACTICE' | 'QUALIFYING' | 'RACE' | 'REPLAY', sessionName: name.trim() || undefined, operator: operator.trim() || undefined, notes: notes.trim() || undefined, idempotencyKey }), trimmedEvent, (ack) => onCreate({ id: ack.sessionId, eventId: trimmedEvent, name: name.trim(), type, status: 'CREATED', operator: operator.trim() })) }}>
    <div><p className="eyebrow">SESSION CONTROL</p><h3>Create an event capture session</h3><p>Only backend-supported session fields are collected. The API applies its canonical source and server timestamps.</p></div>
    <label>EVENT ID*<input required value={eventId} onChange={(event) => setEventId(event.target.value)} /></label><label>SESSION ID / EXTERNAL REFERENCE<input value={sessionId} onChange={(event) => setSessionId(event.target.value)} /></label><label>SESSION NAME<input value={name} onChange={(event) => setName(event.target.value)} /></label><label>TYPE<select value={type} onChange={(event) => setType(event.target.value)}><option>PRACTICE</option><option>QUALIFYING</option><option>RACE</option><option>REPLAY</option></select></label><label>OPERATOR (SESSION ONLY)<input value={operator} onChange={(event) => setOperator(event.target.value)} /></label><label className="capture-wide">NOTES<textarea value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button className="capture-primary" type="submit"><Plus size={16} /> CREATE CAPTURE SESSION</button>
  </form>
}

function RecoverySessions({ sessions, loading, error, onResume }: { sessions: EventCaptureSessionState[]; loading: boolean; error: string | null; onResume: (session: EventCaptureSessionState) => void }) {
  const [selectedId, setSelectedId] = useState('')
  const selected = sessions.find((session) => session.sessionId === selectedId) ?? null
  const active = sessions.filter((session) => session.status !== 'COMPLETED')
  if (loading) return <p className="event-state" role="status">Checking recoverable capture sessions…</p>
  if (error) return <p className="capture-recovery-error" role="alert">Capture recovery unavailable: {error}. Create a new session only if operationally appropriate.</p>
  if (sessions.length === 0) return null
  return <section className="capture-recovery panel" aria-labelledby="capture-recovery-title"><div><p className="eyebrow">SESSION RECOVERY</p><h3 id="capture-recovery-title">Resume accepted capture</h3><p>These states come from the Event Capture recovery boundary, not from delayed serving views.</p>{active.length === 1 ? <b>RECOMMENDED: {active[0].sessionId} · {active[0].status}</b> : null}</div><label>RECOVERABLE SESSION<select aria-label="Recoverable capture session" value={selectedId} onChange={(event) => setSelectedId(event.target.value)}><option value="">Select a capture session</option>{sessions.map((session) => <option key={session.sessionId} value={session.sessionId}>{session.sessionName ?? session.sessionId} · {session.sessionType ?? '—'} · {session.status}</option>)}</select></label><button type="button" disabled={!selected} onClick={() => selected && onResume(selected)}>{selected?.status === 'COMPLETED' ? 'VIEW COMPLETED SESSION' : 'RESUME SESSION'}</button></section>
}

type EventCaptureConsoleProps = { execute: (label: string, action: (idempotencyKey: string) => Promise<EventWriteAcknowledgement>, detail: string, after?: (ack: EventWriteAcknowledgement) => void) => Promise<void> }
function ParticipantForm({ disabled, session, execute, onAdd }: { disabled: boolean; session: CaptureSession; execute: EventCaptureConsoleProps['execute']; onAdd: (participant: CaptureParticipant) => void }) {
  const [id, setId] = useState(''); const [name, setName] = useState(''); const [kart, setKart] = useState(''); const [type, setType] = useState('CHALLENGER'); const [role, setRole] = useState('')
  return <form className="capture-panel panel" onSubmit={(event) => { event.preventDefault(); if (!id.trim()) return; const participant = { id: id.trim(), name: name.trim(), kart: kart.trim(), type }; execute('REGISTER PARTICIPANT', (idempotencyKey) => createEventParticipant(session.id, { participantId: participant.id, displayName: participant.name || undefined, kartId: participant.kart || undefined, participantType: type as 'MAX' | 'CHALLENGER' | 'ORACLE_DRIVER', specialRole: role.trim() || undefined, idempotencyKey }), participant.name || participant.id, () => { onAdd(participant); setId(''); setName(''); setKart(''); setRole('') }) }}>
    <p className="eyebrow"><Users size={13} /> PARTICIPANT REGISTRATION</p><h3>Register identity explicitly</h3><p>No identity is inferred from an AKS participant number.</p><label>PARTICIPANT ID*<input required disabled={disabled} value={id} onChange={(event) => setId(event.target.value)} /></label><label>DISPLAY NAME<input disabled={disabled} value={name} onChange={(event) => setName(event.target.value)} /></label><label>KART ID<input disabled={disabled} value={kart} onChange={(event) => setKart(event.target.value)} /></label><label>TYPE*<select disabled={disabled} value={type} onChange={(event) => setType(event.target.value)}><option>MAX</option><option>CHALLENGER</option><option>ORACLE_DRIVER</option></select></label><label>SPECIAL ROLE<input disabled={disabled} value={role} onChange={(event) => setRole(event.target.value)} /></label><button type="submit" disabled={disabled}>REGISTER PARTICIPANT</button>
  </form>
}

function ParticipantSelect({ label, value, onChange, options, disabled }: { label: string; value: string; onChange: (value: string) => void; options: React.ReactNode; disabled: boolean }) { return <label>{label}<select required disabled={disabled} value={value} onChange={(event) => onChange(event.target.value)}><option value="">Select participant</option>{options}</select></label> }
function PhysicalPassForm({ disabled, sessionId, options, participants, execute }: { disabled: boolean; sessionId: string; options: React.ReactNode; participants: CaptureParticipant[]; execute: EventCaptureConsoleProps['execute'] }) {
  const [passer, setPasser] = useState(''); const [passed, setPassed] = useState(''); const [lap, setLap] = useState(''); const [note, setNote] = useState(''); const invalid = !passer || !passed || passer === passed
  return <form id="capture-physical-pass" className="capture-panel panel capture-priority" onSubmit={(event) => { event.preventDefault(); if (invalid) return; execute('PHYSICAL PASS', (idempotencyKey) => createEventRaceEvent(sessionId, { participantId: passer, targetParticipantId: passed, eventType: 'PASS', lapNumber: optionalNumber(lap), notes: note.trim() || undefined, recordedAt: new Date().toISOString(), idempotencyKey }), `${passer} → ${passed}`, () => { setPasser(''); setPassed(''); setLap(''); setNote('') }) }}>
    <p className="eyebrow"><FlagTriangleRight size={13} /> QUICK CAPTURE</p><h3>Physical pass <InfoTooltip label="Physical Pass" definitionId="physical-pass" /></h3><p>Observed human-confirmed overtake — never inferred from timing catch, GPS, or a rank change.</p><ParticipantSelect label="PASSING PARTICIPANT*" value={passer} onChange={setPasser} options={options} disabled={disabled} /><ParticipantSelect label="PASSED PARTICIPANT*" value={passed} onChange={setPassed} options={options} disabled={disabled} /><label>LAP IF KNOWN<input type="number" min="1" disabled={disabled} value={lap} onChange={(event) => setLap(event.target.value)} /></label><label>LOCATION / OPERATOR NOTE<input disabled={disabled} value={note} onChange={(event) => setNote(event.target.value)} /></label>{passer && passer === passed ? <p className="capture-validation" role="alert">Passing and passed participants must be different.</p> : null}<button type="submit" disabled={disabled || invalid}>CAPTURE PHYSICAL PASS</button>
  </form>
}

function IncidentForm({ disabled, sessionId, options, execute }: { disabled: boolean; sessionId: string; options: React.ReactNode; execute: EventCaptureConsoleProps['execute'] }) {
  const [participant, setParticipant] = useState(''); const [lap, setLap] = useState(''); const [note, setNote] = useState('')
  return <form id="capture-incident" className="capture-panel panel" onSubmit={(event) => { event.preventDefault(); execute('INCIDENT', (idempotencyKey) => createEventRaceEvent(sessionId, { participantId: participant || undefined, eventType: 'INCIDENT', lapNumber: optionalNumber(lap), notes: note.trim() || undefined, recordedAt: new Date().toISOString(), idempotencyKey }), participant || 'operator incident', () => { setParticipant(''); setLap(''); setNote('') }) }}><p className="eyebrow"><CircleAlert size={13} /> FACTUAL EVENT</p><h3>Incident</h3><p>Only approved event types are available. Pit, safety-car and red-flag classifications are not in the current contract.</p><ParticipantSelect label="PARTICIPANT IF KNOWN" value={participant} onChange={setParticipant} options={options} disabled={disabled} /><label>LAP IF KNOWN<input type="number" min="1" disabled={disabled} value={lap} onChange={(event) => setLap(event.target.value)} /></label><label>OPERATOR NOTE<input disabled={disabled} value={note} onChange={(event) => setNote(event.target.value)} /></label><button type="submit" disabled={disabled}>CAPTURE INCIDENT</button></form>
}

function MediaMarkerForm({ disabled, sessionId, options, execute }: { disabled: boolean; sessionId: string; options: React.ReactNode; execute: EventCaptureConsoleProps['execute'] }) {
  const [title, setTitle] = useState('Marked moment'); const [participant, setParticipant] = useState(''); const [notes, setNotes] = useState('')
  return <form id="capture-media" className="capture-panel panel" onSubmit={(event) => { event.preventDefault(); execute('MEDIA MARKER', (idempotencyKey) => createEventMediaMarker(sessionId, { title: title.trim() || 'Marked moment', participantId: participant || undefined, markerType: 'GENERAL', priority: 'MEDIUM', notes: notes.trim() || undefined, idempotencyKey }), title.trim() || 'Marked moment', () => { setTitle('Marked moment'); setParticipant(''); setNotes('') }) }}><p className="eyebrow"><Clapperboard size={13} /> FAST MARKER</p><h3>Mark moment</h3><p>Captures server time. Race time and lap remain absent unless known — they are never fabricated.</p><label>TITLE*<input required disabled={disabled} value={title} onChange={(event) => setTitle(event.target.value)} /></label><ParticipantSelect label="PARTICIPANT (OPTIONAL)" value={participant} onChange={setParticipant} options={options} disabled={disabled} /><label>NOTE<input disabled={disabled} value={notes} onChange={(event) => setNotes(event.target.value)} /></label><button type="submit" disabled={disabled}><Clapperboard size={15} /> MARK NOW</button></form>
}

function ManualLapForm({ disabled, sessionId, options, execute }: { disabled: boolean; sessionId: string; options: React.ReactNode; execute: EventCaptureConsoleProps['execute'] }) {
  const [participant, setParticipant] = useState(''); const [lap, setLap] = useState(''); const [lapTime, setLapTime] = useState(''); const [position, setPosition] = useState(''); const [gap, setGap] = useState('')
  return <form id="capture-lap" className="capture-panel panel" onSubmit={(event) => { event.preventDefault(); if (!participant || !lap) return; execute('MANUAL LAP', (idempotencyKey) => createEventLap(sessionId, { participantId: participant, lapNumber: Number(lap), lapTimeSeconds: optionalNumber(lapTime), position: optionalNumber(position), gapToMaxSeconds: optionalNumber(gap), idempotencyKey }), `${participant} · L${lap}`, () => { setLap(''); setLapTime(''); setPosition(''); setGap('') }) }}><p className="eyebrow"><Gauge size={13} /> MANUAL LAP ENTRY</p><h3>Fallback timing evidence <InfoTooltip label="Manual Lap" definitionId="actual-event" /></h3><p>Use only when approved timing channels are unavailable. Missing timing, sector, position and gap values stay missing.</p><ParticipantSelect label="PARTICIPANT*" value={participant} onChange={setParticipant} options={options} disabled={disabled} /><label>LAP NUMBER*<input required type="number" min="1" disabled={disabled} value={lap} onChange={(event) => setLap(event.target.value)} /></label><label>LAP TIME SECONDS<input type="number" step="0.001" min="0" disabled={disabled} value={lapTime} onChange={(event) => setLapTime(event.target.value)} /></label><label>POSITION<input type="number" min="1" disabled={disabled} value={position} onChange={(event) => setPosition(event.target.value)} /></label><label>GAP TO MAX SECONDS<input type="number" step="0.001" disabled={disabled} value={gap} onChange={(event) => setGap(event.target.value)} /></label><button type="submit" disabled={disabled || !participant || !lap}>CAPTURE MANUAL LAP</button></form>
}

function QuickAction({ icon, title, text, disabled, href }: { icon: React.ReactNode; title: string; text: string; disabled: boolean; href: string }) { return <a className={`capture-quick ${disabled ? 'disabled' : ''}`} href={disabled ? undefined : href} aria-disabled={disabled}>{icon}<span><b>{title}</b><small>{text}</small></span></a> }
function ActivityFeed({ activities }: { activities: Activity[] }) { return <section className="capture-activity panel" aria-labelledby="capture-activity-title"><div><p className="eyebrow">RECENT CAPTURES</p><h3 id="capture-activity-title">This browser session only</h3><p>There is no journal read endpoint; this feed lists only records accepted while this console remains open.</p></div>{activities.length === 0 ? <p className="event-state">No capture acknowledgements yet.</p> : <ol>{activities.map((activity, index) => <li key={`${activity.id}-${activity.at}-${index}`}><time>{activity.at}</time><b>{activity.label}</b><span>{activity.detail}</span><strong className={activity.acknowledgement.syncStatus.toLowerCase()}>{activity.acknowledgement.syncStatus}</strong></li>)}</ol>}<small><b>PENDING</b> = captured locally, pending downstream sync. <b>SYNCED</b> = downstream persistence confirmed. No browser-side offline success is claimed.</small></section> }
