import { CalendarClock, Flag, Gauge, Radio, Users } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import {
  fetchEventCards,
  fetchEventParticipants,
  fetchEventPredictionVsReality,
  fetchEventSession,
  fetchEventSessions,
  fetchEventStoryline,
} from '../api/raceIntelligence'
import type {
  CustomSimulationResult,
  EventParticipantCard,
  EventParticipantRaceSummary,
  EventPredictionVsReality,
  EventSessionSummary,
  EventStorylineEntry,
} from '../types/raceIntelligence'
import { InfoTooltip } from './InfoTooltip'
import { EventCaptureConsole } from './EventCaptureConsole'
import { EventReplayPanels } from './EventReplayPanels'
import { EventMoments } from './EventMoments'
import { LiveEventMoments } from './LiveEventMoments'
import { LiveSourcePanel } from './LiveEventStatePanel'
import { EventBaseballSource } from './EventBaseballSource'

const missing = '—'

function display(value: string | number | null | undefined): string {
  return value === null || value === undefined || value === '' ? missing : String(value)
}

function clock(value: number | null | undefined): string {
  if (value === null || value === undefined) return missing
  const seconds = Math.round(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function lapTime(value: number | null | undefined): string {
  return value === null || value === undefined ? missing : `${value.toFixed(3)} s`
}

function position(value: number | null | undefined): string {
  return value === null || value === undefined ? missing : `P${value}`
}

function eventMoment(lap: number | null, seconds: number | null): string {
  if (lap === null || lap === undefined || seconds === null || seconds === undefined) return missing
  return `L${lap} · ${clock(seconds)}`
}

function sessionStartedAt(value: string | null): string {
  if (!value) return missing
  const date = new Date(value)
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}

function timelineClass(storyType: string | null): string {
  const type = storyType ?? 'EVENT'
  if (type.includes('TIMING_CATCH')) return 'timing'
  if (type.includes('PASS')) return 'pass'
  if (type.includes('MEDIA')) return 'media'
  if (type.includes('JOKER')) return 'joker'
  if (type.includes('INCIDENT') || type.includes('PENALTY')) return 'alert'
  return 'session'
}

type SessionPayload = {
  summary: EventSessionSummary
  participants: EventParticipantRaceSummary[]
  storyline: EventStorylineEntry[]
  predictions: EventPredictionVsReality[]
  cards: EventParticipantCard[]
  optionalErrors: { storyline: boolean; predictions: boolean }
}

export function EventOperations({ modelledScenario }: { modelledScenario?: CustomSimulationResult | null } = {}) {
  const [sessions, setSessions] = useState<EventSessionSummary[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [payload, setPayload] = useState<SessionPayload | null>(null)
  const [sessionsLoading, setSessionsLoading] = useState(true)
  const [sessionLoading, setSessionLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [area, setArea] = useState<'monitor' | 'capture' | 'moments' | 'baseball' | 'live'>('monitor')

  useEffect(() => {
    const controller = new AbortController()
    setSessionsLoading(true)
    setError(null)
    fetchEventSessions(controller.signal).then((available) => {
      if (controller.signal.aborted) return
      setSessions(available)
      setSelectedSessionId((current) => current && available.some((session) => session.sessionId === current)
        ? current
        : available.find((session) => session.sessionId)?.sessionId ?? null)
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) setError(requestError instanceof Error ? requestError.message : 'Event sessions could not be loaded.')
    }).finally(() => {
      if (!controller.signal.aborted) setSessionsLoading(false)
    })
    return () => controller.abort()
  }, [])

  useEffect(() => {
    if (!selectedSessionId) {
      setPayload(null)
      return
    }
    const controller = new AbortController()
    setSessionLoading(true)
    setError(null)
    const required = Promise.all([
      fetchEventSession(selectedSessionId, controller.signal),
      fetchEventParticipants(selectedSessionId, controller.signal),
      fetchEventCards(selectedSessionId, controller.signal),
    ])
    const optional = Promise.allSettled([
      fetchEventStoryline(selectedSessionId, controller.signal),
      fetchEventPredictionVsReality(selectedSessionId, controller.signal),
    ])
    Promise.all([required, optional]).then(([[summary, participants, cards], [storylineResult, predictionsResult]]) => {
      if (controller.signal.aborted) return
      setPayload({
        summary,
        participants,
        cards,
        storyline: storylineResult.status === 'fulfilled' ? storylineResult.value : [],
        predictions: predictionsResult.status === 'fulfilled' ? predictionsResult.value : [],
        optionalErrors: {
          storyline: storylineResult.status === 'rejected',
          predictions: predictionsResult.status === 'rejected',
        },
      })
    }).catch((requestError: unknown) => {
      if (!controller.signal.aborted) {
        setPayload(null)
        setError(requestError instanceof Error ? requestError.message : 'The selected Event session could not be loaded.')
      }
    }).finally(() => {
      if (!controller.signal.aborted) setSessionLoading(false)
    })
    return () => controller.abort()
  }, [selectedSessionId])

  const selectedSession = useMemo(
    () => sessions.find((session) => session.sessionId === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  )
  const rehearsal = (payload?.summary.operationalContext ?? selectedSession?.operationalContext) === 'REHEARSAL'

  return <section className="event-operations" aria-labelledby="event-operations-title">
    <header className="event-hero">
      <div>
        <p className="eyebrow">EVENT</p>
        <h1 id="event-operations-title">Race Operations</h1>
        <p>Actual Event Capture and factual Event Intelligence.</p>
      </div>
      <div className="event-provenance"><Radio size={16} /><span>{rehearsal ? 'CAPTURED REHEARSAL' : 'ACTUAL EVENT'} <InfoTooltip label="Actual Event" definitionId="actual-event" /></span>{rehearsal ? <b>REHEARSAL DATA <InfoTooltip label="Rehearsal Data" definitionId="rehearsal-data" /></b> : null}</div>
    </header>

    <nav className="event-area-tabs" aria-label="Race Operations areas">
      <button type="button" className={area === 'live' ? 'active' : ''} aria-pressed={area === 'live'} onClick={() => setArea('live')}>LIVE HOT PATH</button>
      <button type="button" className={area === 'monitor' ? 'active' : ''} aria-pressed={area === 'monitor'} onClick={() => setArea('monitor')}>OVERVIEW / MONITOR</button>
      <button type="button" className={area === 'capture' ? 'active' : ''} aria-pressed={area === 'capture'} onClick={() => setArea('capture')}>EVENT CAPTURE</button>
      <button type="button" className={area === 'moments' ? 'active' : ''} aria-pressed={area === 'moments'} onClick={() => setArea('moments')}>EVENT MOMENTS</button>
      <button type="button" className={area === 'baseball' ? 'active' : ''} aria-pressed={area === 'baseball'} onClick={() => setArea('baseball')}>BASEBALL CARD DATA</button>
    </nav>

    {area === 'live' ? <LiveSourcePanel /> : area === 'capture' ? <EventCaptureConsole /> : area === 'baseball' ? <EventBaseballSource modelledScenario={modelledScenario} /> : area === 'moments' ? <><LiveEventMoments />{payload?.summary.sessionId && <details><summary>Serving archive · separate from current hot path</summary><EventMoments sessionId={payload.summary.sessionId} participantIds={payload.participants.map(p=>p.participantId).filter((p):p is string=>Boolean(p))}/></details>}</> : <>
    <section className="event-session-control panel" aria-label="Event session selection">
      <div>
        <p className="eyebrow">SESSION SELECTOR</p>
        <h2>Select a captured session</h2>
      </div>
      {sessionsLoading ? <p className="event-state" role="status">Loading event sessions...</p> : null}
      {!sessionsLoading && error && sessions.length === 0 ? <p className="event-error" role="alert">{error}</p> : null}
      {!sessionsLoading && !error && sessions.length === 0 ? <p className="event-state">No event sessions are available.</p> : null}
      {sessions.length > 0 ? <label>
        <span>SESSION</span>
        <select aria-label="Event session" value={selectedSessionId ?? ''} onChange={(event) => setSelectedSessionId(event.target.value)}>
          {sessions.map((session) => <option key={session.sessionId ?? 'unidentified'} value={session.sessionId ?? ''}>
            {[session.sessionName ?? session.sessionId, session.sessionType, session.status, sessionStartedAt(session.startedAt)].filter(Boolean).join(' | ')}
          </option>)}
        </select>
      </label> : null}
    </section>

    {sessionLoading ? <section className="event-loading" role="status"><div /><div /><div /></section> : null}
    {!sessionsLoading && error && sessions.length > 0 ? <section className="event-error panel" role="alert"><strong>Session data unavailable</strong><p>{error}</p></section> : null}
    {area === 'monitor' && payload ? <EventSessionContent payload={payload} rehearsal={rehearsal} /> : null}
    </>}
  </section>
}

function EventSessionContent({ payload, rehearsal }: { payload: SessionPayload; rehearsal: boolean }) {
  const { summary, participants, storyline, predictions, cards, optionalErrors } = payload
  const evidenceSubject = rehearsal ? 'this rehearsal' : 'this event session'
  const noLapEvidence = summary.lapObservationCount === null || summary.lapObservationCount === 0
  const noEventEvidence = summary.eventCount === null || summary.eventCount === 0
  return <>
    <section className="event-status-strip" aria-label="Selected Event session status">
      <span>{display(summary.sessionName)}</span><strong>{display(summary.status)} <InfoTooltip label="Session Status" definitionId="session-status" /></strong><span>{display(summary.sessionType)}</span><span>SOURCE {display(summary.source)}</span><span>{sessionStartedAt(summary.startedAt)}</span>
      {rehearsal ? <b>REHEARSAL DATA</b> : null}
    </section>

    {summary.sessionId ? <EventReplayPanels sessionId={summary.sessionId} rehearsal={rehearsal} /> : null}


    {!rehearsal ? <>
    <section className="event-section" aria-labelledby="event-overview-title">
      <div className="event-section-heading"><p className="eyebrow">SESSION OVERVIEW</p><h2 id="event-overview-title">Captured session summary</h2></div>
      <div className="event-kpi-grid">
        <Kpi icon={<Users size={16} />} label="Participants" value={display(summary.participantCount)} />
        <Kpi icon={<Gauge size={16} />} label="Lap observations" value={display(summary.lapObservationCount)} />
        <Kpi icon={<Flag size={16} />} label="Events" value={display(summary.eventCount)} />
        <Kpi icon={<Radio size={16} />} label="Media markers" value={display(summary.mediaMarkerCount)} />
        <Kpi icon={<CalendarClock size={16} />} label="Snapshots" value={display(summary.snapshotCount)} />
        <Kpi label="Duration" value={clock(summary.sessionDurationSeconds)} />
        <Kpi label="Fastest lap" value={lapTime(summary.fastestLapSeconds)} />
        <Kpi label="Final leader" value={display(summary.finalLeaderName)} detail={position(summary.finalLeaderPosition)} />
      </div>
      {noLapEvidence || noEventEvidence ? <div className="event-evidence-empty">
        {noLapEvidence ? <p>No validated lap observations are available for {evidenceSubject}.</p> : null}
        {noEventEvidence ? <p>No validated race events are available for {evidenceSubject}.</p> : null}
      </div> : null}
    </section>

    <section className="event-section panel" aria-labelledby="event-participants-title">
      <div className="event-section-heading"><p className="eyebrow">PARTICIPANTS</p><h2 id="event-participants-title">Race observations</h2></div>
      {participants.length === 0 ? <p className="event-state">No participant observations are available for this session.</p> : <div className="event-table-scroll"><table className="event-table"><thead><tr><th>Position</th><th>Driver</th><th>Kart</th><th>Type</th><th>Laps</th><th>Best Lap</th><th>Average Lap</th><th>Timing Catch <InfoTooltip label="Timing Catch" definitionId="timing-catch" /></th><th>Physical Pass <InfoTooltip label="Physical Pass" definitionId="physical-pass" /></th><th>Jokers</th><th>Incidents</th></tr></thead><tbody>
        {participants.map((participant) => <tr key={participant.participantId}><td>{position(participant.finalPosition)}</td><td><strong>{display(participant.displayName ?? participant.participantId)}</strong><small>{[participant.displayName ? participant.participantId : null, participant.externalParticipantNumber ? `AKS source #${participant.externalParticipantNumber}` : null].filter(Boolean).join(' | ') || null}</small></td><td>{display(participant.kartId)}</td><td>{display(participant.participantType)}</td><td>{display(participant.lapCount)}</td><td>{lapTime(participant.bestLapSeconds)}</td><td>{lapTime(participant.averageLapSeconds)}</td><td>{eventMoment(participant.timingCatchLap, participant.timingCatchTimeSeconds)}</td><td>{eventMoment(participant.physicalPassLap, participant.physicalPassTimeSeconds)}</td><td>{display(participant.jokerCount)}</td><td>{display(participant.incidentCount)}</td></tr>)}
      </tbody></table></div>}
    </section>

    <section className="event-section event-two-column">
      <div className="panel" aria-labelledby="event-timeline-title"><div className="event-section-heading"><p className="eyebrow">EVENT TIMELINE</p><h2 id="event-timeline-title">Factual stored events <InfoTooltip label="Storyline" definitionId="storyline" /></h2></div>
        {optionalErrors.storyline ? <p className="event-state">Storyline is temporarily unavailable; required session evidence remains available.</p> : storyline.length === 0 ? <p className="event-state">No stored storyline entries are available for this session.</p> : <ol className="event-timeline">{storyline.map((entry) => <li key={entry.storylineId ?? entry.sourceRecordId} className={timelineClass(entry.storyType)}><div><time>{clock(entry.raceTimeSeconds)}</time><span>{entry.lapNumber === null ? missing : `L${entry.lapNumber}`}</span></div><article><b>{display(entry.storyType)}</b><h3>{display(entry.title)}</h3><p>{display(entry.description)}</p><small>{[entry.storyCategory, entry.priority, entry.participantId, entry.targetParticipantId].filter(Boolean).join(' | ') || missing}</small></article></li>)}</ol>}
      </div>
      <div className="panel" aria-labelledby="event-prediction-title"><div className="event-section-heading"><p className="eyebrow">PREDICTION VS REALITY</p><h2 id="event-prediction-title">Captured snapshot comparison <InfoTooltip label="Prediction vs Reality" definitionId="prediction-vs-reality" /></h2></div>
        {optionalErrors.predictions ? <p className="event-state">Prediction comparison is temporarily unavailable; required session evidence remains available.</p> : predictions.length === 0 ? <p className="event-state">No captured prediction snapshots are available for this session.</p> : predictions.map((prediction) => <PredictionPanel key={prediction.scenarioSnapshotId} prediction={prediction} />)}
      </div>
    </section>

    <section className="event-section panel" aria-labelledby="event-cards-title"><div className="event-section-heading"><p className="eyebrow">PARTICIPANT CARDS</p><h2 id="event-cards-title">{rehearsal ? 'Captured rehearsal preview' : 'Actual Event preview'} <InfoTooltip label="Participant Card" definitionId="participant-card" /></h2></div>
      {cards.length === 0 ? <p className="event-state">No captured participant cards are available for this session.</p> : <div className="event-card-grid">{cards.map((card) => <EventCard key={card.participantId} card={card} rehearsal={rehearsal} />)}</div>}
    </section>
    </> : <section className="event-section panel event-optional-evidence" aria-labelledby="event-optional-evidence-title">
      <div className="event-section-heading"><h2 id="event-optional-evidence-title">Optional captured products</h2></div>
      <div>
        <p>{optionalErrors.storyline ? 'Storyline is temporarily unavailable.' : storyline.length === 0 ? 'No factual storyline entries captured.' : 'Factual storyline entries are available.'}</p>
        <p>{optionalErrors.predictions ? 'Prediction comparison is temporarily unavailable.' : predictions.length === 0 ? 'No prediction snapshots captured.' : 'Captured prediction snapshots are available.'}</p>
      </div>
    </section>}
  </>
}

function Kpi({ icon, label, value, detail }: { icon?: React.ReactNode; label: React.ReactNode; value: string; detail?: string }) {
  return <article><span>{icon}{label}</span><strong>{value}</strong>{detail && detail !== missing ? <small>{detail}</small> : null}</article>
}

function PredictionPanel({ prediction }: { prediction: EventPredictionVsReality }) {
  if (!prediction.comparisonAvailable) return <article className="event-prediction-unavailable"><small>{display(prediction.snapshotType)} | {display(prediction.modelVersion)} | {display(prediction.gitCommit)}</small><strong>Comparison not available for this snapshot <InfoTooltip label="Comparison Available" definitionId="comparison-available" /></strong><p>Unavailable prediction and reality values remain absent.</p></article>
  const rows = [
    ['VM finish', clock(prediction.predictedVmFinishSeconds), clock(prediction.actualVmFinishSeconds), display(prediction.finishTimeErrorSeconds)],
    ['VM rank', position(prediction.predictedVmRank), position(prediction.actualVmRank), display(prediction.rankError)],
    ['P1 lap', display(prediction.predictedP1Lap), display(prediction.actualP1Lap), display(prediction.p1LapError)],
    ['Full-field catch', eventMoment(prediction.predictedFullFieldCatchLap, prediction.predictedFullFieldCatchTimeSeconds), eventMoment(prediction.actualFullFieldCatchLap, prediction.actualFullFieldCatchTimeSeconds), display(prediction.fullFieldCatchLapError)],
    ['Timing caught', display(prediction.predictedTimingCaught), display(prediction.actualTimingCaught), missing],
    ['Cleared', display(prediction.predictedCleared), display(prediction.actualCleared), missing],
  ]
  return <article className="event-prediction"><small>{display(prediction.snapshotType)} | {display(prediction.modelVersion)} | {display(prediction.gitCommit)}</small><div className="event-prediction-grid"><span>METRIC</span><span>PREDICTED</span><span>ACTUAL</span><span>ERROR / DELTA</span>{rows.map(([label, predicted, actual, delta]) => <><b key={`${label}-label`}>{label}</b><strong key={`${label}-predicted`}>{predicted}</strong><strong key={`${label}-actual`}>{actual}</strong><strong key={`${label}-delta`}>{delta}</strong></>)}</div></article>
}

function EventCard({ card, rehearsal }: { card: EventParticipantCard; rehearsal: boolean }) {
  return <article className="event-card"><header><div><p>{display(card.participantType)}</p><h3>{display(card.displayName ?? card.participantId)}</h3><small>{display(card.participantId)} | {display(card.kartId)}</small></div><div><b>{rehearsal ? 'CAPTURED REHEARSAL' : 'ACTUAL EVENT'}</b>{rehearsal ? <b>REHEARSAL</b> : null}</div></header><div className="event-card-status"><span>{display(card.cardDataStatus)}</span><span>{rehearsal ? 'FACTUAL OBSERVATION' : display(card.dataProvenance)}</span></div><div className="event-card-metrics"><Metric label="Start" value={position(card.actualStartPosition)} /><Metric label="Final" value={position(card.actualFinalPosition)} /><Metric label="Change" value={card.positionChange === null ? missing : `${card.positionChange > 0 ? '+' : ''}${card.positionChange}`} /><Metric label="Best lap" value={lapTime(card.actualBestLapSeconds)} /><Metric label="Laps" value={display(card.actualCompletedLaps)} /><Metric label="Held Max off" value={card.heldMaxOffLaps === null ? missing : `${card.heldMaxOffLaps.toFixed(1)} laps`} /></div><div className="event-card-details"><p><span>Timing catch</span><b>{eventMoment(card.timingCatchLap, card.timingCatchTimeSeconds)}</b></p><p><span>Physical pass</span><b>{eventMoment(card.physicalPassLap, card.physicalPassTimeSeconds)}</b></p><p><span>Jokers</span><b>{display(card.jokerCount)}</b></p><p><span>Average lap</span><b>{lapTime(card.actualAverageLapSeconds)}</b></p></div>{card.highlightTitle || card.highlightText ? <footer><strong>{display(card.highlightTitle)}</strong><p>{display(card.highlightText)}</p></footer> : null}</article>
}

function Metric({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>
}
