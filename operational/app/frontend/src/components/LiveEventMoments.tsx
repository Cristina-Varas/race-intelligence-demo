import { useEffect, useState } from 'react'
import { captureLiveMoment, fetchLiveMoments, fetchLiveSource, liveMomentsExportUrl } from '../api/raceIntelligence'
import type { FrozenMoment, LiveMomentsData } from '../api/raceIntelligence'
import { useLiveEventSession } from '../hooks/useLiveEventSession'

const shown = (value: unknown) => value === null || value === undefined ? '—' : String(value)
const label = (moment: FrozenMoment) => moment.capture_origin === 'OPERATOR' ? 'OPERATOR · FACTUAL ASSERTION' : 'AUTO · FACTUAL'

export function LiveEventMoments() {
  const [source, setSource] = useState<{sessionId: string; mode: string} | null>(null)
  const [data, setData] = useState<LiveMomentsData | null>(null)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [type, setType] = useState('KEY_MOMENT'), [primary, setPrimary] = useState(''), [secondary, setSecondary] = useState(''), [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  const {state:liveState} = useLiveEventSession(source?.sessionId ?? null,!!source)
  const rebuilding = data?.metadata.sourceState==='REBUILDING' || (liveState?.sourceEpoch!==undefined && data?.metadata.sourceEpoch!==liveState.sourceEpoch)
  useEffect(() => { let active = true; fetchLiveSource().then(s => { if (active) setSource(s) }).catch(() => { if (active) setError('Current hot path unavailable. No serving data was substituted.') }); return () => { active = false } }, [])
  useEffect(() => {
    if (!source) return
    const controller = new AbortController(); let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      try { const next = await fetchLiveMoments(source.sessionId, controller.signal); if (!controller.signal.aborted) setData(next) }
      catch { if (!controller.signal.aborted) setError('Moment refresh failed; retained snapshots are unchanged.') }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 2000) }
    }
    void load(); return () => { controller.abort(); clearTimeout(timer) }
  }, [source])
  const capture = async (candidateId?: string) => {
    if (!source) return
    setBusy(true); setError('')
    try {
      const moment = await captureLiveMoment(source.sessionId, candidateId ? { candidateId } : { momentType: type, primaryParticipantId: primary || undefined, secondaryParticipantId: secondary || undefined, note: note || undefined })
      setSelected(moment.moment_id); setData(await fetchLiveMoments(source.sessionId)); setNote('')
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Capture failed') }
    finally { setBusy(false) }
  }
  const moment = data?.moments.find(m => m.moment_id === selected)
  return <section className="event-moments panel" aria-label="LIVE Event Moments">
    <header className="event-moments-heading"><div><p className="eyebrow">{source?.mode ?? 'CONNECTING'} · EVENT MOMENTS</p><h2>Capture the moment. Keep the evidence.</h2><p>Candidates change. Captured snapshots stay frozen. No names or photographs.</p></div>
      {source && <div className="event-moments-actions"><a href={liveMomentsExportUrl(source.sessionId, 'xlsx')}>Export {source.mode} XLSX</a><a href={liveMomentsExportUrl(source.sessionId, 'csv')}>Export {source.mode} CSV</a></div>}</header>
    <p>POSITION CHANGE is not a physical pass. PASS CONFIRMED is an explicit operator assertion.</p>
    {error && <p role="alert">{error}</p>}
    {rebuilding && <p role="status">REBUILDING LIVE EVENT EVIDENCE</p>}
    <h3>LIVE CANDIDATES</h3>
    <div className="event-table-scroll"><table className="event-table"><thead><tr><th>Time</th><th>Type</th><th>Kart</th><th>Position / lap / gap</th><th>Action</th></tr></thead><tbody>
      {!rebuilding && data?.candidates.map(c => <tr key={c.candidateId}><td>{shown(c.snapshot.observed_at)}</td><td>{c.momentType}</td><td>KART {shown(c.snapshot.primary_kart_number)}</td><td>P{shown(c.snapshot.latest_observed_position)} · L{shown(c.snapshot.observed_lap)} · {shown(c.snapshot.gap_to_leader)} s</td><td><button disabled={busy} onClick={() => void capture(c.candidateId)}>CAPTURE</button></td></tr>)}
    </tbody></table></div>
    {!data?.candidates.length && <p>No live candidates yet.</p>}
    <form className="event-moment-capture panel" onSubmit={e => { e.preventDefault(); void capture() }}>
      <h3>CAPTURE CURRENT MOMENT</h3>
      <label>Type<select aria-label="Capture type" value={type} onChange={e => setType(e.target.value)}>{['KEY_MOMENT','PASS_CONFIRMED','REACTION','NOTE'].map(t => <option key={t} value={t}>{t.replaceAll('_',' ')}</option>)}</select></label>
      <label>Kart<select aria-label="Primary kart" value={primary} onChange={e => setPrimary(e.target.value)}><option value="">Session-level</option>{data?.participants.map(p => <option key={p.participantId} value={p.participantId}>KART {p.kartNumber}</option>)}</select></label>
      <label>Second kart<select aria-label="Second kart" value={secondary} onChange={e => setSecondary(e.target.value)}><option value="">None</option>{data?.participants.filter(p => p.participantId !== primary).map(p => <option key={p.participantId} value={p.participantId}>KART {p.kartNumber}</option>)}</select></label>
      <label>Operator note — no names or personal information<textarea maxLength={300} value={note} onChange={e => setNote(e.target.value)} /></label>
      <button disabled={busy || rebuilding || !data || (type === 'PASS_CONFIRMED' && (!primary || !secondary || primary === secondary))}>CAPTURE CURRENT MOMENT</button>
    </form>
    <h3>CAPTURED MOMENTS · {data?.moments.length ?? 0}</h3>
    <div className="event-table-scroll"><table className="event-table"><thead><tr><th>Time</th><th>Type</th><th>Kart</th><th>Position</th><th>Lap</th><th>Gap</th><th>Origin</th><th>Snapshot</th></tr></thead><tbody>
      {data?.moments.map(m => <tr key={m.moment_id}><td>{m.observed_at ?? m.captured_at}</td><td>{m.moment_type.replaceAll('_',' ')}</td><td>KART {shown(m.primary_kart_number)}{m.secondary_kart_number && ` / KART ${m.secondary_kart_number}`}</td><td>{shown(m.latest_observed_position)}</td><td>{shown(m.observed_lap)}</td><td>{shown(m.gap_to_leader)} s</td><td>{label(m)}</td><td><button onClick={() => setSelected(m.moment_id)}>Frozen detail</button></td></tr>)}
    </tbody></table></div>
    {moment && <article className="event-moment-detail-grid" aria-label="Frozen event snapshot"><div><h3>FROZEN EVENT SNAPSHOT</h3><p>{moment.moment_type.replaceAll('_',' ')} · {label(moment)}</p><p>{moment.observed_at}</p><p>KART {shown(moment.primary_kart_number)}</p><p>{moment.operator_note}</p></div><dl>
      {[['Position', moment.latest_observed_position],['Peak',moment.peak_observed_position],['Lap',moment.observed_lap],['Gap',moment.gap_to_leader],['Interval',moment.interval],['Best valid lap',moment.best_valid_lap],['Leader kart',moment.observed_leader_kart]].map(([k,v]) => <div key={String(k)}><dt>{k}</dt><dd>{shown(v)}</dd></div>)}
    </dl></article>}
  </section>
}
