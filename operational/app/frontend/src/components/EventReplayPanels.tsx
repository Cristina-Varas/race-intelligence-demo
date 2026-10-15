import { ChevronLeft, ChevronRight, Pause, Play, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import { fetchEventObservedReplaySummary, fetchEventStandings, fetchEventStandingsSeries, fetchEventTrackGeometry, fetchEventTrackReplay } from '../api/raceIntelligence'
import type { EventObservedReplaySummary, EventTrackGeometry, StandingReplayRow, TrackReplayRow } from '../types/raceIntelligence'
import { eventUtcIsoAt, eventUtcMilliseconds } from '../utils/eventReplayTime'

const missing = '—'
const replaySources = ['GPS_CORRECTED', 'RGPS_RAW'] as const
const playbackSpeeds = [1, 2, 5, 10, 30, 60] as const
const replayWindows = [{ label: '30 sec', seconds: 30 }, { label: '60 sec', seconds: 60 }, { label: '5 min', seconds: 300 }, { label: '15 min', seconds: 900 }] as const
type ReplayWindowPreset = typeof replayWindows[number]['seconds'] | 'custom'
type ReplaySource = typeof replaySources[number]
type ObservedTrace = { entity: string; rows: TrackReplayRow[] }
type AnalyticsScope = 'full' | 'window'

function display(value: string | number | null | undefined) {
  return value === null || value === undefined || value === '' ? missing : String(value)
}

function clock(value: number | null | undefined) {
  if (value === null || value === undefined) return missing
  const seconds = Math.round(value)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function observedAt(value: string | null | undefined) {
  if (!value) return missing
  const milliseconds = eventUtcMilliseconds(value)
  return milliseconds === null ? value : new Date(milliseconds).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' })
}

function bounded(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value))
}

function replayResolutionSeconds(windowSeconds: number) {
  if (windowSeconds <= 60) return 1
  if (windowSeconds <= 300) return 3
  return 10
}

export function fitWindowSpeed(windowSeconds: number) {
  const target = Math.min(60, Math.max(1, windowSeconds / 30))
  return [1, 2, 5, 10, 30, 60].reduce((nearest, speed) =>
    Math.abs(speed - target) < Math.abs(nearest - target) ? speed : nearest,
  1)
}

function externalLabel(row: Pick<TrackReplayRow, 'sourceEntityId' | 'externalParticipantNumber'>) {
  return row.sourceEntityId === 'SC' ? 'SC' : row.externalParticipantNumber ? `#${row.externalParticipantNumber}` : (row.sourceEntityId ?? missing)
}

function detailLabel(row: Pick<TrackReplayRow, 'sourceEntityId' | 'participantId' | 'externalParticipantNumber'>) {
  return row.sourceEntityId === 'SC' ? 'SOURCE ENTITY SC' : externalLabel(row)
}

function flags(row: TrackReplayRow) {
  return [
    row.isLeader && 'Leader', row.isLapped && 'Lapped', row.isStopped && 'Stopped',
    row.isInPit && 'In Pit', row.isOutLap && 'Out Lap', row.isRetired && 'Retired',
    row.isLate && 'Late', row.isNoGps && 'No GPS', row.isChequered && 'Chequered',
  ].filter(Boolean) as string[]
}

function atMilliseconds(row: TrackReplayRow) {
  return eventUtcMilliseconds(row.observedAt)
}

function haversineMeters(left: TrackReplayRow, right: TrackReplayRow) {
  const radians = Math.PI / 180
  const latitude = ((right.latitude as number) - (left.latitude as number)) * radians
  const longitude = ((right.longitude as number) - (left.longitude as number)) * radians
  const leftLatitude = (left.latitude as number) * radians
  const rightLatitude = (right.latitude as number) * radians
  const a = Math.sin(latitude / 2) ** 2 + Math.cos(leftLatitude) * Math.cos(rightLatitude) * Math.sin(longitude / 2) ** 2
  return 6371000 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

export function isObservedGeometryRow(row: TrackReplayRow) {
  return row.positionSource === 'GPS_CORRECTED'
    && row.sourceEntityId !== 'SC'
    && row.latitude !== null
    && row.longitude !== null
    && Boolean(row.sourceEntityId)
}

/** Never joins entities. A new trace begins after a physically implausible GPS jump. */
export function buildObservedTrackTraces(rows: TrackReplayRow[]): ObservedTrace[] {
  const byEntity = new Map<string, TrackReplayRow[]>()
  rows.filter(isObservedGeometryRow).forEach((row) => {
    const entity = row.sourceEntityId as string
    byEntity.set(entity, [...(byEntity.get(entity) ?? []), row])
  })
  const traces: ObservedTrace[] = []
  byEntity.forEach((entityRows, entity) => {
    const ordered = [...entityRows].sort((a, b) => (atMilliseconds(a) ?? 0) - (atMilliseconds(b) ?? 0))
    let segment: TrackReplayRow[] = []
    ordered.forEach((row) => {
      const previous = segment[segment.length - 1]
      const elapsedSeconds = previous ? Math.max(0, ((atMilliseconds(row) ?? 0) - (atMilliseconds(previous) ?? 0)) / 1000) : 0
      const discontinuityMeters = Math.max(85, elapsedSeconds * 45)
      if (previous && haversineMeters(previous, row) > discontinuityMeters) {
        if (segment.length > 1) traces.push({ entity, rows: segment })
        segment = []
      }
      segment.push(row)
    })
    if (segment.length > 1) traces.push({ entity, rows: segment })
  })
  return traces
}

export function markerState(rows: TrackReplayRow[], at: number) {
  const latest = new Map<string, TrackReplayRow>()
  rows.forEach((row) => {
    const entity = row.sourceEntityId ?? row.participantId
    const timestamp = atMilliseconds(row)
    if (!entity || timestamp === null || timestamp > at) return
    latest.set(entity, row)
  })
  return [...latest.values()].filter((row) => row.latitude !== null && row.longitude !== null)
}

/**
 * Playback frames are time buckets, never individual raw rows. Window edges are
 * included so the playback cursor always has an explicit, bounded time domain.
 */
export function buildReplayFrames(rows: TrackReplayRow[], windowStart: number, windowEnd: number, resolutionSeconds: number) {
  if (!windowStart || !windowEnd || windowEnd < windowStart) return []
  const bucketMilliseconds = Math.max(1, resolutionSeconds) * 1000
  const frames = new Set<number>([windowStart, windowEnd])
  rows.forEach((row) => {
    const timestamp = atMilliseconds(row)
    if (timestamp === null || timestamp < windowStart || timestamp > windowEnd) return
    frames.add(bounded(Math.floor(timestamp / bucketMilliseconds) * bucketMilliseconds, windowStart, windowEnd))
  })
  return [...frames].sort((left, right) => left - right)
}

export function replayFrameIndexAt(frames: number[], timestamp: number) {
  const index = frames.findIndex((frame) => frame >= timestamp)
  return index === -1 ? Math.max(0, frames.length - 1) : index
}

/** Wall-clock delay needed to advance one factual frame at the chosen replay speed. */
export function replayFrameDelayMilliseconds(frames: number[], frameIndex: number, speed: number) {
  const current = frames[frameIndex]
  const next = frames[frameIndex + 1]
  if (current === undefined || next === undefined || speed <= 0) return 0
  return Math.max(16, (next - current) / speed)
}

export function replayPlaybackDurationMilliseconds(frames: number[], speed: number) {
  return frames.slice(1).reduce((duration, frame, index) => duration + replayFrameDelayMilliseconds(frames, index, speed), 0)
}

function markerClass(row: TrackReplayRow, selected: boolean) {
  return [
    'event-replay-marker', selected && 'selected', row.sourceEntityId === 'SC' && 'sc',
    row.isLeader && 'leader', row.isInPit && 'in-pit', row.isStopped && 'stopped',
    row.isRetired && 'retired', row.isChequered && 'chequered',
  ].filter(Boolean).join(' ')
}

type SeriesMetric = 'position' | 'gap'

function seriesIndex(participant: string) {
  const number = Number(participant.replace(/\D/g, ''))
  return Number.isFinite(number) && number > 0 ? (number - 1) % 5 : 0
}

export function shapeObservedSeries(rows: StandingReplayRow[]) {
  const byTimestamp = new Map<number, StandingReplayRow>()
  rows.forEach((row) => {
    const timestamp = eventUtcMilliseconds(row.observedAt)
    if (timestamp !== null) byTimestamp.set(timestamp, row)
  })
  return [...byTimestamp.entries()].sort(([left], [right]) => left - right).map(([, row]) => row)
}

export function splitObservedSeriesAtGaps(rows: StandingReplayRow[], maximumGapMilliseconds = 90_000) {
  return rows.reduce<StandingReplayRow[][]>((segments, row) => {
    const segment = segments[segments.length - 1]
    const previous = segment?.[segment.length - 1]
    if (!previous || (eventUtcMilliseconds(row.observedAt) as number) - (eventUtcMilliseconds(previous.observedAt) as number) <= maximumGapMilliseconds) segment ? segment.push(row) : segments.push([row])
    else segments.push([row])
    return segments
  }, [])
}

/** Latest factual observation at or before a replay cursor; never a future value. */
export function standingAtOrBefore(rows: StandingReplayRow[], cursor: number, participantId?: string) {
  return rows.filter((row) => (!participantId || row.participantId === participantId) && (eventUtcMilliseconds(row.observedAt) ?? Infinity) <= cursor)
    .sort((left, right) => (eventUtcMilliseconds(left.observedAt) ?? 0) - (eventUtcMilliseconds(right.observedAt) ?? 0)).at(-1)
}

function ObservedSeriesChart({ title, rows, metric, scope, selectedParticipant, compact, domainStart, domainEnd, replayCursor, selectedWindowStart, selectedWindowEnd, showWindowContext, onSelectParticipant }: { title: string; rows: StandingReplayRow[]; metric: SeriesMetric; scope: string; selectedParticipant?: string; compact?: boolean; domainStart: number; domainEnd: number; replayCursor: number; selectedWindowStart: number; selectedWindowEnd: number; showWindowContext: boolean; onSelectParticipant?: (participantId: string) => void }) {
  const [hovered, setHovered] = useState<StandingReplayRow | null>(null)
  const points = rows.filter((row) => atMilliseconds({ observedAt: row.observedAt } as TrackReplayRow) !== null && (metric === 'position' ? row.position !== null : row.gapFirstSeconds !== null))
  const byParticipant = useMemo(() => {
    const grouped = new Map<string, StandingReplayRow[]>()
    points.forEach((row) => {
      const key = row.participantId ?? 'UNKNOWN'
      grouped.set(key, [...(grouped.get(key) ?? []), row])
    })
    return [...grouped.entries()].map(([participant, participantRows]) => [participant, shapeObservedSeries(participantRows)] as const)
  }, [points])
  const timestamps = points.map((row) => eventUtcMilliseconds(row.observedAt) as number)
  const minTime = domainStart || (timestamps.length ? Math.min(...timestamps) : 0)
  const maxTime = domainEnd || (timestamps.length ? Math.max(...timestamps) : 1)
  const chartLeft = 20
  const chartRight = 148
  const chartLabelEdge = 174
  const maximumValue = metric === 'position'
    ? Math.max(8, ...points.map((row) => row.position ?? 1))
    : Math.max(1, Math.ceil(Math.max(...points.map((row) => row.gapFirstSeconds ?? 0))))
  const coordinate = (row: StandingReplayRow) => {
    const x = chartLeft + (((eventUtcMilliseconds(row.observedAt) as number) - minTime) / (maxTime - minTime || 1)) * (chartRight - chartLeft)
    const value = metric === 'position' ? row.position ?? 1 : row.gapFirstSeconds ?? 0
    const y = metric === 'position' ? 8 + ((value - 1) / Math.max(1, maximumValue - 1)) * 82 : 90 - (value / maximumValue) * 82
    return { x, y }
  }
  const xAt = (timestamp: number) => chartLeft + ((bounded(timestamp, minTime, maxTime) - minTime) / (maxTime - minTime || 1)) * (chartRight - chartLeft)
  const linePoints = (segment: StandingReplayRow[]) => metric === 'position'
    ? segment.flatMap((row, index) => {
      const point = coordinate(row)
      if (!index) return [`${point.x},${point.y}`]
      const previous = coordinate(segment[index - 1])
      return [`${point.x},${previous.y}`, `${point.x},${point.y}`]
    }).join(' ')
    : segment.map((row) => { const point = coordinate(row); return `${point.x},${point.y}` }).join(' ')
  const xTicks = minTime === maxTime ? [minTime] : Array.from({ length: 5 }, (_, index) => minTime + ((maxTime - minTime) * index / 4))
  const yTicks = metric === 'position'
    ? Array.from({ length: Math.min(maximumValue, 8) }, (_, index) => index + 1).concat(maximumValue > 8 ? [maximumValue] : [])
    : (() => { const step = maximumValue <= 2 ? .5 : maximumValue <= 5 ? 1 : Math.ceil(maximumValue / 4); const ticks = Array.from({ length: Math.floor(maximumValue / step) + 1 }, (_, index) => index * step); return ticks.at(-1) === maximumValue ? ticks : [...ticks, maximumValue] })()
  const labelRows = byParticipant.map(([participant, participantRows]) => ({ participant, row: participantRows.at(-1)! })).sort((left, right) => coordinate(left.row).y - coordinate(right.row).y)
  let lastLabelY = -Infinity
  const labels = labelRows.map(({ participant, row }) => {
    const point = coordinate(row)
    const y = Math.max(point.y, lastLabelY + 4)
    lastLabelY = y
    return { participant, row, x: Math.min(chartLabelEdge, point.x + 2), y }
  })
  const gapAxisLabel = (value: number) => value === 0 ? '0 s' : `${value.toFixed(maximumValue <= 2 ? 1 : Number.isInteger(value) ? 0 : 1)} s`
  const playheadX = xAt(replayCursor)
  const windowBandX = xAt(selectedWindowStart)
  const windowBandEnd = xAt(selectedWindowEnd)
  const currentValue = selectedParticipant ? standingAtOrBefore(points, replayCursor, selectedParticipant) : undefined
  return <article className={`event-temporal-chart ${compact ? 'compact' : ''}`}><header><span>FACTUAL STANDINGS SERIES · {scope}</span><h3>{title}</h3><small>{metric === 'position' ? `STEP-CHANGE · VISIBLE DOMAIN P1–P${maximumValue}` : 'SECONDS TO OBSERVED LEADER · MISSING EVIDENCE BREAKS THE LINE'}</small></header>{points.length ? <><svg viewBox="0 0 180 100" role="img" aria-label={title} preserveAspectRatio="xMidYMid meet">{showWindowContext ? <rect className="event-chart-window-band" x={windowBandX} y="8" width={Math.max(0, windowBandEnd - windowBandX)} height="82" /> : null}<g className="event-chart-grid">{xTicks.map((timestamp) => { const x = xAt(timestamp); return <g key={timestamp}><line x1={x} x2={x} y1="8" y2="90" /><text x={x} y="97" textAnchor="middle">{observedAt(eventUtcIsoAt(timestamp)).slice(0, 5)}</text></g> })}{yTicks.map((value) => { const y = metric === 'position' ? 8 + ((value - 1) / Math.max(1, maximumValue - 1)) * 82 : 90 - (value / maximumValue) * 82; return <g key={value}><line x1={chartLeft} x2={chartRight} y1={y} y2={y} /><text x="17" y={y + 1.5} textAnchor="end">{metric === 'position' ? `P${value}` : gapAxisLabel(value)}</text></g> })}</g>{byParticipant.map(([participant, participantRows]) => <g key={participant} className={`series-line series-${seriesIndex(participant)} ${participant === selectedParticipant ? 'selected' : selectedParticipant ? 'muted' : ''}`}>{splitObservedSeriesAtGaps(participantRows).map((segment, segmentIndex) => <polyline fill="none" key={segmentIndex} points={linePoints(segment)} />)}{participantRows.map((row) => { const point = coordinate(row); const isHovered = hovered?.participantId === row.participantId && hovered?.observedAt === row.observedAt; return <g key={`${row.snapshotId}-${row.observedAt}`}><circle className="series-hit-target" cx={point.x} cy={point.y} r="2.2" tabIndex={0} onClick={() => row.participantId && onSelectParticipant?.(row.participantId)} onMouseEnter={() => setHovered(row)} onMouseLeave={() => setHovered(null)} onFocus={() => setHovered(row)} onBlur={() => setHovered(null)}><title>{`${observedAt(row.observedAt)} · ${row.externalParticipantNumber ? `#${row.externalParticipantNumber}` : row.participantId ?? missing} · ${row.participantId ?? missing} · ${metric === 'position' ? `P${row.position}` : `${(row.gapFirstSeconds ?? 0).toFixed(3)} s`} · L${row.lapNumber ?? missing} · ${row.status ?? missing}`}</title></circle>{isHovered ? <circle className="series-hover-dot" cx={point.x} cy={point.y} r="1.25" /> : null}</g> })}</g>)}{currentValue ? (() => { const point = coordinate(currentValue); return <circle className="event-chart-current-value" cx={point.x} cy={point.y} r="1.45" /> })() : null}<line className="event-chart-playhead" x1={playheadX} x2={playheadX} y1="8" y2="90" />{labels.map(({ participant, row, x, y }) => <text key={participant} className={`series-direct-label series-${seriesIndex(participant)}`} x={x} y={Math.min(90, y)} role="button" tabIndex={0} onClick={() => onSelectParticipant?.(participant)} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectParticipant?.(participant) } }}>{row.externalParticipantNumber ? `#${row.externalParticipantNumber}` : participant}</text>)}</svg>{hovered ? <p className="event-series-tooltip" role="status">{observedAt(hovered.observedAt)} · {hovered.externalParticipantNumber ? `#${hovered.externalParticipantNumber}` : missing} · {hovered.participantId ?? missing} · {metric === 'position' ? `P${hovered.position}` : `${(hovered.gapFirstSeconds ?? 0).toFixed(3)} s`} · L{hovered.lapNumber ?? missing} · {hovered.status ?? missing}</p> : null}<div className="event-temporal-legend" aria-label={`${title} series identity`}>{byParticipant.map(([participant, participantRows]) => <span key={participant} className={`series-${seriesIndex(participant)}`}>{participantRows[0]?.externalParticipantNumber ? `#${participantRows[0].externalParticipantNumber}` : participant}</span>)}</div></> : <p>No factual standing samples in this range.</p>}</article>
}

export function EventReplayPanels({ sessionId, rehearsal }: { sessionId: string; rehearsal: boolean }) {
  const [standings, setStandings] = useState<StandingReplayRow[]>([])
  const [standingsError, setStandingsError] = useState<string | null>(null)
  const [standingsLoading, setStandingsLoading] = useState(true)
  const [observedSummary, setObservedSummary] = useState<EventObservedReplaySummary | null>(null)
  const [summaryError, setSummaryError] = useState<string | null>(null)
  const [trackGeometry, setTrackGeometry] = useState<EventTrackGeometry | null>(null)
  const [geometryError, setGeometryError] = useState<string | null>(null)
  const [trackRows, setTrackRows] = useState<TrackReplayRow[]>([])
  const [trackError, setTrackError] = useState<string | null>(null)
  const [trackLoading, setTrackLoading] = useState(true)
  const [source, setSource] = useState<ReplaySource>('GPS_CORRECTED')
  const [windowPreset, setWindowPreset] = useState<ReplayWindowPreset>(60)
  const [customWindowSeconds, setCustomWindowSeconds] = useState(120)
  const [windowStart, setWindowStart] = useState(0)
  const [replayMoved, setReplayMoved] = useState(false)
  const [replayStandings, setReplayStandings] = useState<StandingReplayRow[] | null>(null)
  const [series, setSeries] = useState<StandingReplayRow[]>([])
  const [analyticsScope, setAnalyticsScope] = useState<AnalyticsScope>('full')
  const [gapMode, setGapMode] = useState<'selected' | 'top5'>('selected')
  const [selectedParticipantId, setSelectedParticipantId] = useState<string | null>(null)
  const [displayMode, setDisplayMode] = useState<'all' | 'selected'>('all')
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState<number>(1)
  const [frameIndex, setFrameIndex] = useState(0)
  const [selectedEntity, setSelectedEntity] = useState<string | null>(null)
  const windowSeconds = windowPreset === 'custom' ? customWindowSeconds : windowPreset

  useEffect(() => {
    const controller = new AbortController()
    setStandingsLoading(true)
    setStandingsError(null)
    fetchEventStandings(sessionId, { limit: 500 }, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setStandings(rows) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setStandingsError(error instanceof Error ? error.message : 'Observed standings could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setStandingsLoading(false) })
    setSummaryError(null)
    fetchEventObservedReplaySummary(sessionId, controller.signal)
      .then((summary) => { if (!controller.signal.aborted) { setObservedSummary(summary); const end = eventUtcMilliseconds(summary.positionLastObservedAt) ?? 0; setWindowStart((current) => current || Math.max(0, end - windowSeconds * 1000)) } })
      .catch((error: unknown) => { if (!controller.signal.aborted) setSummaryError(error instanceof Error ? error.message : 'Observed session summary could not be loaded.') })
    setGeometryError(null)
    fetchEventTrackGeometry(sessionId, controller.signal)
      .then((geometry) => { if (!controller.signal.aborted) setTrackGeometry(geometry) })
      .catch((error: unknown) => { if (!controller.signal.aborted) setGeometryError(error instanceof Error ? error.message : 'Observed track reference could not be loaded.') })
    return () => controller.abort()
  }, [sessionId])

  // The only automatic choice is the initial factual participant. Once the
  // operator makes a selection it is intentionally never replaced by replay,
  // chart, cursor, or window effects.
  useEffect(() => {
    if (selectedParticipantId || !standings.length) return
    const initial = [...standings].sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) || (left.participantId ?? '').localeCompare(right.participantId ?? ''))[0]?.participantId
    if (initial) setSelectedParticipantId(initial)
  }, [standings, selectedParticipantId])

  const sessionStart = eventUtcMilliseconds(observedSummary?.positionFirstObservedAt) ?? 0
  const sessionEnd = eventUtcMilliseconds(observedSummary?.positionLastObservedAt) ?? 0
  const effectiveWindowStart = sessionEnd ? bounded(windowStart || Math.max(sessionStart, sessionEnd - windowSeconds * 1000), sessionStart, Math.max(sessionStart, sessionEnd - windowSeconds * 1000)) : 0
  const effectiveWindowEnd = sessionEnd ? Math.min(sessionEnd, effectiveWindowStart + windowSeconds * 1000) : 0
  const resolutionSeconds = replayResolutionSeconds(windowSeconds)

  useEffect(() => {
    const controller = new AbortController()
    setTrackLoading(true)
    setTrackError(null)
    setPlaying(false)
    setTrackRows([])
    setFrameIndex(0)
    fetchEventTrackReplay(sessionId, { positionSource: source, participantId: displayMode === 'selected' ? selectedParticipantId ?? undefined : undefined, fromTime: effectiveWindowStart ? eventUtcIsoAt(effectiveWindowStart) : undefined, toTime: effectiveWindowEnd ? eventUtcIsoAt(effectiveWindowEnd) : undefined, resolutionSeconds, limit: 5000 }, controller.signal)
      .then((rows) => {
        if (controller.signal.aborted) return
        // The bounded API owns factual window filtering. Clearing rows before the
        // request and honouring AbortController prevents stale-window reuse.
        setTrackRows(rows)
      })
      .catch((error: unknown) => { if (!controller.signal.aborted) setTrackError(error instanceof Error ? error.message : 'Observed positions could not be loaded.') })
      .finally(() => { if (!controller.signal.aborted) setTrackLoading(false) })
    return () => controller.abort()
  }, [sessionId, source, displayMode, selectedParticipantId, effectiveWindowStart, effectiveWindowEnd, resolutionSeconds])

  const replayFrames = useMemo(() => buildReplayFrames(trackRows, effectiveWindowStart, effectiveWindowEnd, resolutionSeconds), [trackRows, effectiveWindowStart, effectiveWindowEnd, resolutionSeconds])
  const replayCursor = replayFrames[frameIndex] ?? effectiveWindowStart

  useEffect(() => {
    if (!replayMoved || !replayCursor) return
    const controller = new AbortController()
    fetchEventStandings(sessionId, { atTime: eventUtcIsoAt(replayCursor), limit: 500 }, controller.signal)
      .then((rows) => { if (!controller.signal.aborted) setReplayStandings(rows) })
      .catch(() => { if (!controller.signal.aborted) setReplayStandings([]) })
    return () => controller.abort()
  }, [sessionId, replayCursor, replayMoved])

  const analyticsStart = analyticsScope === 'full' ? sessionStart : effectiveWindowStart
  const analyticsEnd = analyticsScope === 'full' ? sessionEnd : effectiveWindowEnd
  const analyticsResolutionSeconds = analyticsScope === 'full' ? 30 : Math.max(5, resolutionSeconds)

  useEffect(() => {
    if (!analyticsStart || !analyticsEnd) return
    const controller = new AbortController()
    const baseQuery = { fromTime: eventUtcIsoAt(analyticsStart), toTime: eventUtcIsoAt(analyticsEnd), topN: 5, resolutionSeconds: analyticsResolutionSeconds, limit: 1500 }
    const selectedQuery = selectedParticipantId ? fetchEventStandingsSeries(sessionId, { ...baseQuery, participantId: selectedParticipantId }, controller.signal) : Promise.resolve([])
    Promise.all([fetchEventStandingsSeries(sessionId, baseQuery, controller.signal), selectedQuery])
      .then(([comparison, selectedRows]) => {
        if (controller.signal.aborted) return
        const unique = new Map<string, StandingReplayRow>()
        ;[...comparison, ...selectedRows].forEach((row) => unique.set(`${row.participantId}-${row.snapshotId}-${row.observedAt}`, row))
        setSeries([...unique.values()])
      })
      .catch(() => { if (!controller.signal.aborted) setSeries([]) })
    return () => controller.abort()
  }, [sessionId, analyticsStart, analyticsEnd, analyticsResolutionSeconds, selectedParticipantId])

  const referenceCoordinates = trackGeometry?.points ?? []
  const projection = useMemo(() => {
    if (!referenceCoordinates.length) return null
    const meanLatitudeRadians = referenceCoordinates.reduce((sum, row) => sum + row.latitude, 0) / referenceCoordinates.length * Math.PI / 180
    const point = (row: { latitude: number; longitude: number }) => ({ x: row.longitude * Math.cos(meanLatitudeRadians), y: row.latitude })
    const projected = referenceCoordinates.map(point)
    return {
      minX: Math.min(...projected.map((row) => row.x)), maxX: Math.max(...projected.map((row) => row.x)),
      minY: Math.min(...projected.map((row) => row.y)), maxY: Math.max(...projected.map((row) => row.y)),
      point,
    }
  }, [referenceCoordinates])
  const project = (row: { latitude: number | null; longitude: number | null }) => {
    if (!projection || row.latitude === null || row.longitude === null) return { x: 50, y: 50 }
    const raw = projection.point({ latitude: row.latitude, longitude: row.longitude })
    const rangeX = projection.maxX - projection.minX || 1
    const rangeY = projection.maxY - projection.minY || 1
    const scale = 88 / Math.max(rangeX, rangeY)
    return { x: 50 + (raw.x - (projection.minX + projection.maxX) / 2) * scale, y: 50 - (raw.y - (projection.minY + projection.maxY) / 2) * scale }
  }
  const markers = useMemo(() => markerState(trackRows, replayCursor), [trackRows, replayCursor])
  const activeGapParticipant = selectedParticipantId
  const gapSeries = gapMode === 'selected' && activeGapParticipant ? series.filter((row) => row.participantId === activeGapParticipant) : series
  const participants = useMemo(() => [...standings].filter((row): row is StandingReplayRow & { participantId: string } => Boolean(row.participantId)).sort((left, right) => (left.position ?? Number.MAX_SAFE_INTEGER) - (right.position ?? Number.MAX_SAFE_INTEGER) || left.participantId.localeCompare(right.participantId)), [standings])
  const leader = markers.find((row) => row.isLeader) ?? markers[0] ?? null
  const selected = (selectedParticipantId ? markers.find((row) => row.participantId === selectedParticipantId) : null) ?? (selectedEntity ? markers.find((row) => (row.sourceEntityId ?? row.participantId) === selectedEntity) : null) ?? leader
  const displayedStandings = replayStandings ?? standings
  const selectedStanding = displayedStandings.find((row) => row.participantId === selectedParticipantId) ?? null
  const topFive = useMemo(() => new Set(displayedStandings.slice(0, 5).map((row) => row.participantId).filter((value): value is string => Boolean(value))), [displayedStandings])
  const operational = {
    active: markers.length,
    inPit: markers.filter((row) => row.isInPit).length,
    stopped: markers.filter((row) => row.isStopped).length,
    retired: markers.filter((row) => row.isRetired).length,
    scPresent: markers.some((row) => row.sourceEntityId === 'SC'),
  }
  const latestStandingLap = replayStandings ? (Math.max(...displayedStandings.map((row) => row.lapNumber ?? 0), 0) || null) : observedSummary?.latestStandingLap ?? (Math.max(...standings.map((row) => row.lapNumber ?? 0), 0) || null)
  const latestFieldSpread = replayStandings ? (Math.max(...displayedStandings.map((row) => row.gapFirstSeconds ?? 0), 0) || null) : observedSummary?.latestFieldSpreadSeconds ?? (Math.max(...standings.map((row) => row.gapFirstSeconds ?? 0), 0) || null)
  const cursorLeader = displayedStandings.find((row) => row.position === 1)?.externalParticipantNumber
  const observedLeader = replayStandings
    ? cursorLeader ? `#${cursorLeader}` : missing
    : observedSummary?.latestObservedLeaderExternalParticipantNumber
      ? `#${observedSummary.latestObservedLeaderExternalParticipantNumber}`
      : cursorLeader ? `#${cursorLeader}` : missing
  const scSourcePresent = observedSummary
    ? (observedSummary.scSourceSampleCount ?? 0) > 0
    : trackRows.some((row) => row.sourceEntityId === 'SC') ? true : null

  useEffect(() => {
    if (!playing || replayFrames.length < 2) return
    if (frameIndex >= replayFrames.length - 1) {
      setPlaying(false)
      return
    }
    const timer = window.setTimeout(() => setFrameIndex((current) => Math.min(current + 1, replayFrames.length - 1)), replayFrameDelayMilliseconds(replayFrames, frameIndex, speed))
    return () => window.clearTimeout(timer)
  }, [playing, replayFrames, frameIndex, speed])

  const showMarkerLabel = (row: TrackReplayRow) => {
    const entity = row.sourceEntityId ?? row.participantId
    return row.sourceEntityId === 'SC' || row.isLeader || row.isInPit || row.isStopped || row.isRetired || row.isChequered || row.participantId === selectedParticipantId || entity === selectedEntity || Boolean(row.participantId && topFive.has(row.participantId))
  }
  const selectParticipant = (participant: string) => {
    setSelectedParticipantId(participant)
    setSelectedEntity(participant)
  }
  const chartDomainStart = analyticsScope === 'full' ? sessionStart : effectiveWindowStart
  const chartDomainEnd = analyticsScope === 'full' ? sessionEnd : effectiveWindowEnd

  return <>
    <section className="event-section panel event-observed-summary" aria-labelledby="observed-summary-title">
      <div className="event-section-heading">
        <p className="eyebrow">REHEARSAL · AKS OBSERVED EVIDENCE</p>
        <h2 id="observed-summary-title">Observed session summary</h2>
        <p className="event-replay-description">Facts derived from governed standings and positional evidence. No final classification or lap-time result is inferred.</p>
      </div>
      {summaryError ? <p className="event-summary-note">Full-session counts are temporarily unavailable; loaded factual evidence remains visible.</p> : null}
      <div className="event-observed-summary-grid">
        <article><span>PARTICIPANTS</span><strong>{standings.length || missing}</strong><small>latest observed snapshot</small></article>
        <article><span>LATEST OBSERVED LAP</span><strong>{latestStandingLap === null ? missing : `L${latestStandingLap}`}</strong><small>AKS-reported observed lap</small></article>
        <article><span>OBSERVED LEADER</span><strong>{observedLeader}</strong><small>{display(observedSummary?.latestObservedLeaderParticipantId)}</small></article>
        <article><span>LATEST FIELD SPREAD</span><strong>{latestFieldSpread === null ? missing : `${latestFieldSpread.toFixed(3)} s`}</strong><small>gap to leader</small></article>
        <article><span>STANDINGS SNAPSHOTS</span><strong>{display(observedSummary?.standingSnapshotCount)}</strong><small>{display(observedSummary?.standingRowCount)} observed rows</small></article>
        <article><span>POSITION SAMPLES</span><strong>{display(observedSummary?.positionSampleCount)}</strong><small>GPS_CORRECTED {display(observedSummary?.gpsCorrectedSampleCount)} · RGPS_RAW {display(observedSummary?.rgpsRawSampleCount)}</small></article>
        <article><span>OBSERVED WINDOW</span><strong>{observedAt(observedSummary?.positionFirstObservedAt)} → {observedAt(observedSummary?.positionLastObservedAt)}</strong><small>captured positional evidence</small></article>
        <article><span>SC SOURCE</span><strong>{scSourcePresent === null ? missing : scSourcePresent ? 'PRESENT' : 'NOT PRESENT'}</strong><small>{observedSummary ? `${display(observedSummary.scSourceSampleCount)} source samples · evidence, not session state` : 'source entity evidence, not session state'}</small></article>
      </div>
    </section>
    <section className="event-section panel event-observed-standings" aria-labelledby="observed-standings-title">
      <div className="event-section-heading">
        <p className="eyebrow">REHEARSAL · SOURCE AKS · FACTUAL OBSERVATION</p>
        <h2 id="observed-standings-title">{replayMoved ? `Observed race state at ${observedAt(eventUtcIsoAt(replayCursor))}` : 'Latest observed race state'}</h2>
        <p className="event-replay-description">{replayMoved ? `Standings observed at ${displayedStandings[0] ? observedAt(displayedStandings[0].observedAt) : missing}; position sample at ${observedAt(eventUtcIsoAt(replayCursor))}.` : `Latest AKS standings snapshot at ${observedAt(observedSummary?.latestStandingObservedAt)}.`} This is an observed state, not a final classification.</p>
      </div>
      {standingsLoading ? <p className="event-state" role="status">Loading observed standings…</p> : null}
      {standingsError ? <p className="event-error" role="alert"><strong>Observed standings unavailable</strong><br />{standingsError}</p> : null}
      {!standingsLoading && !standingsError && standings.length === 0 ? <p className="event-state">No observed standings are available for this session.</p> : null}
      {displayedStandings.length > 0 ? <div className="event-table-scroll"><table className="event-table observed-standings-table"><thead><tr><th>Pos</th><th>#</th><th>Participant</th><th>Status</th><th>Observed lap</th><th>Gap to leader</th><th>Interval</th><th>Position change</th><th>Loop</th><th>Observed at</th></tr></thead><tbody>
        {displayedStandings.map((row, index) => {
          const entity = row.participantId
          const rowClasses = [row.position === 1 && 'leader', entity === selectedParticipantId && 'selected', row.status !== 'CLASSIFIED' && 'emphasized'].filter(Boolean).join(' ')
          return <tr key={`${row.snapshotId ?? 'snapshot'}-${entity ?? index}`} className={rowClasses} onClick={() => entity && selectParticipant(entity)}>
            <td>{row.position === null ? missing : `P${row.position}`}</td><td><strong>{row.externalParticipantNumber ? `#${row.externalParticipantNumber}` : missing}</strong></td><td>{display(entity)}</td><td>{display(row.status)}</td><td>{row.lapNumber === null ? missing : `L${row.lapNumber}`}</td><td>{row.gapFirstSeconds === null ? missing : `${row.gapFirstSeconds.toFixed(3)} s`}</td><td>{row.gapPreviousSeconds === null ? missing : `${row.gapPreviousSeconds.toFixed(3)} s`}</td><td>{row.positionChange === null ? missing : `${row.positionChange > 0 ? '+' : ''}${row.positionChange}`}</td><td>{display(row.atLoop)}</td><td>{observedAt(row.observedAt)}</td>
          </tr>
        })}
      </tbody></table></div> : null}
    </section>

    <section className="event-section panel event-observed-replay" aria-labelledby="observed-replay-title">
      <div className="event-section-heading">
        <p className="eyebrow">{rehearsal ? 'REHEARSAL' : 'CAPTURED SESSION'} · SOURCE AKS · FACTUAL OBSERVATION</p>
        <h2 id="observed-replay-title">Observed track reference — Jarama</h2>
        <p className="event-replay-description">Captured GPS-derived geometry from the Jarama rehearsal session. Not official circuit geometry. The stable reference is derived from full-session GPS_CORRECTED evidence; replay markers use a separate bounded window.</p>
      </div>
      <div className="event-operational-strip" aria-label="Operational replay summary">
        <article><span>OBSERVED</span><strong>{observedAt(eventUtcIsoAt(replayCursor))}</strong></article>
        <article><span>LEADER</span><strong>{leader ? externalLabel(leader) : missing}</strong></article>
        <article><span>ACTIVE</span><strong>{operational.active}</strong></article>
        <article><span>IN PIT</span><strong>{operational.inPit}</strong></article>
        <article><span>STOPPED</span><strong>{operational.stopped}</strong></article>
        <article><span>RETIRED</span><strong>{operational.retired}</strong></article>
        <article><span>SC</span><strong>{operational.scPresent ? 'PRESENT' : '—'}</strong></article>
        <article><span>SOURCE</span><strong>{source}</strong></article>
      </div>
      <div className="event-replay-controls">
        <label><span>WINDOW</span><select aria-label="Replay window" value={windowPreset} onChange={(event) => { const preset: ReplayWindowPreset = event.target.value === 'custom' ? 'custom' : Number(event.target.value) as Exclude<ReplayWindowPreset, 'custom'>; const seconds = preset === 'custom' ? customWindowSeconds : preset; setWindowPreset(preset); setWindowStart((current) => { if (!sessionEnd) return current; const currentEnd = Math.min(sessionEnd, (current || Math.max(sessionStart, sessionEnd - windowSeconds * 1000)) + windowSeconds * 1000); return bounded(currentEnd - seconds * 1000, sessionStart, Math.max(sessionStart, sessionEnd - seconds * 1000)) }); setReplayMoved(true) }}>{replayWindows.map((window) => <option key={window.seconds} value={window.seconds}>{window.label}</option>)}<option value="custom">Custom</option></select></label>
        {windowPreset === 'custom' ? <label><span>CUSTOM RANGE · SEC</span><input aria-label="Custom replay range seconds" type="number" min="5" max="900" step="5" value={customWindowSeconds} onChange={(event) => { const seconds = bounded(Number(event.target.value) || 5, 5, 900); setCustomWindowSeconds(seconds); setWindowStart((current) => { if (!sessionEnd) return current; const currentEnd = Math.min(sessionEnd, (current || Math.max(sessionStart, sessionEnd - windowSeconds * 1000)) + windowSeconds * 1000); return bounded(currentEnd - seconds * 1000, sessionStart, Math.max(sessionStart, sessionEnd - seconds * 1000)) }); setReplayMoved(true) }} /></label> : null}
        <label><span>POSITION SOURCE</span><select aria-label="Position source" value={source} onChange={(event) => setSource(event.target.value as ReplaySource)}>{replaySources.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        <label><span>DISPLAY</span><select aria-label="Replay display" value={displayMode} onChange={(event) => setDisplayMode(event.target.value as 'all' | 'selected')}><option value="all">All participants</option><option value="selected">Selected only</option></select></label>
        <label><span>PLAYBACK SPEED</span><select aria-label="Playback speed" value={speed} onChange={(event) => setSpeed(Number(event.target.value))}>{playbackSpeeds.map((value) => <option key={value} value={value}>{value}x</option>)}</select></label>
        <button type="button" className="event-replay-reset" aria-label="Previous replay window" onClick={() => { setReplayMoved(true); setWindowStart((current) => bounded((current || effectiveWindowStart) - windowSeconds * 1000, sessionStart, Math.max(sessionStart, sessionEnd - windowSeconds * 1000))) }} disabled={!sessionEnd}><ChevronLeft size={14} /> Window</button>
        <button type="button" className="event-replay-play" onClick={() => { setReplayMoved(true); setPlaying((value) => !value) }} disabled={replayFrames.length < 2}>{playing ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Play</>}</button>
        <button type="button" className="event-replay-reset" aria-label="Fit replay window" onClick={() => { setSpeed(fitWindowSpeed(windowSeconds)); setFrameIndex(0); setReplayMoved(true); setPlaying(true) }} disabled={replayFrames.length < 2}>FIT WINDOW</button>
        <button type="button" className="event-replay-reset" aria-label="Next replay window" onClick={() => { setReplayMoved(true); setWindowStart((current) => bounded((current || effectiveWindowStart) + windowSeconds * 1000, sessionStart, Math.max(sessionStart, sessionEnd - windowSeconds * 1000))) }} disabled={!sessionEnd}>Window <ChevronRight size={14} /></button>
        <button type="button" className="event-replay-reset" onClick={() => { setPlaying(false); setReplayMoved(false); setReplayStandings(null); const start = Math.max(sessionStart, sessionEnd - windowSeconds * 1000); setWindowStart(start); setFrameIndex(0) }} disabled={!trackRows.length}><RotateCcw size={14} /> Reset</button>
      </div>
      {trackLoading ? <p className="event-state" role="status">Loading a bounded observed position window…</p> : null}
      {trackError ? <p className="event-error" role="alert"><strong>Observed position replay unavailable</strong><br />{trackError}</p> : null}
      {!trackLoading && !trackError && !trackRows.length ? <p className="event-state">No observed position samples are available for this session and source.</p> : null}
      {trackRows.length > 0 || referenceCoordinates.length > 0 ? <>
        <div className="event-replay-time"><span>SELECTED WINDOW</span><strong>{observedAt(eventUtcIsoAt(effectiveWindowStart))} — {observedAt(eventUtcIsoAt(effectiveWindowEnd))}</strong><b>{observedAt(eventUtcIsoAt(replayCursor))}</b></div>
        <label className="event-replay-scrubber global"><span>GLOBAL SESSION TIMELINE</span><input aria-label="Global session timeline" type="range" min={sessionStart} max={Math.max(sessionStart, sessionEnd - windowSeconds * 1000)} step="1000" value={effectiveWindowStart} onChange={(event) => { setPlaying(false); setReplayMoved(true); setWindowStart(Number(event.target.value)) }} /><small>{observedAt(observedSummary?.positionFirstObservedAt)} → {observedAt(observedSummary?.positionLastObservedAt)}</small></label>
        {trackRows.length > 0 ? <label className="event-replay-scrubber"><span>REPLAY TIMELINE</span><input aria-label="Replay timeline" type="range" min={effectiveWindowStart} max={effectiveWindowEnd} step={Math.max(1000, resolutionSeconds * 1000)} value={replayCursor} onChange={(event) => { setPlaying(false); setReplayMoved(true); setFrameIndex(replayFrameIndexAt(replayFrames, Number(event.target.value))) }} /></label> : <p className="event-summary-note">No positional samples in this selected window. The Jarama observed track reference remains visible.</p>}
        <div className="event-replay-layout">
          <div className="event-replay-map" aria-label="Observed trajectory map">
            <svg viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Observed track reconstruction">
              <title>Observed track reconstruction</title>
              {referenceCoordinates.length > 1 ? <polyline className="event-replay-path" points={referenceCoordinates.map((row) => { const point = project(row); return `${point.x},${point.y}` }).join(' ')} /> : null}
              {markers.map((row) => {
                const point = project(row)
                const entity = row.sourceEntityId ?? row.participantId ?? 'unknown'
                const isSelected = selected?.sourceEntityId === row.sourceEntityId && selected?.participantId === row.participantId
                const inspect = () => row.participantId ? selectParticipant(row.participantId) : setSelectedEntity(entity)
                return <g key={entity} className={markerClass(row, isSelected)} onClick={inspect} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); inspect() } }} tabIndex={0} role="button" aria-label={`Inspect ${detailLabel(row)}`}>
                  {row.sourceEntityId === 'SC' ? <polygon points={`${point.x},${point.y - 2.2} ${point.x - 2},${point.y + 1.8} ${point.x + 2},${point.y + 1.8}`} /> : row.isStopped || row.isRetired ? <rect x={point.x - 1.7} y={point.y - 1.7} width="3.4" height="3.4" /> : <circle cx={point.x} cy={point.y} r="1.8" />}
                  {showMarkerLabel(row) ? <text x={point.x + 2.2} y={point.y - 2}>{externalLabel(row)}</text> : null}
                </g>
              })}
            </svg>
            <span>OBSERVED TRACK REFERENCE — JARAMA · GPS_CORRECTED · {trackGeometry?.pointCount ?? 0} display points</span>
            {geometryError ? <small className="event-summary-note">Track reference unavailable; bounded factual markers remain available.</small> : null}
            <div className="event-replay-legend" aria-label="Replay marker legend"><b><i className="leader" />Leader</b><b><i className="in-pit" />In Pit</b><b><i className="stopped" />Stopped / Retired</b><b><i className="sc" />SC</b></div>
          </div>
          <aside className="event-replay-detail" aria-live="polite">
            {selected ? <><p>{selected.sourceEntityId === 'SC' ? 'SOURCE ENTITY SC' : 'CAPTURED PARTICIPANT'}</p><h3>{detailLabel(selected)}</h3><small>{selected.sourceEntityId === 'SC' ? 'No participant identity' : display(selected.participantId)}</small><div>{flags(selected).length ? flags(selected).map((flag) => <b key={flag}>{flag}</b>) : <span>No factual status flags in this sample.</span>}</div><dl><dt>STANDING SNAPSHOT</dt><dd>{selectedStanding?.position === null || !selectedStanding ? missing : `P${selectedStanding.position}`}</dd><dt>Observed lap</dt><dd>{selectedStanding?.lapNumber === null || !selectedStanding ? missing : `L${selectedStanding.lapNumber}`}</dd><dt>Gap to leader</dt><dd>{selectedStanding?.gapFirstSeconds === null || !selectedStanding ? missing : `${selectedStanding.gapFirstSeconds.toFixed(3)} s`}</dd><dt>Interval</dt><dd>{selectedStanding?.gapPreviousSeconds === null || !selectedStanding ? missing : `${selectedStanding.gapPreviousSeconds.toFixed(3)} s`}</dd><dt>Standing status</dt><dd>{display(selectedStanding?.status)}</dd><dt>POSITION SAMPLE</dt><dd>{observedAt(selected.observedAt)}</dd><dt>Position source</dt><dd>{display(selected.positionSource)}</dd><dt>Latitude</dt><dd>{selected.latitude === null ? missing : selected.latitude.toFixed(6)}</dd><dt>Longitude</dt><dd>{selected.longitude === null ? missing : selected.longitude.toFixed(6)}</dd></dl></> : <><p>NO OBSERVED POSITION</p><h3>Captured positions</h3><span>No coordinate sample is available at this point in the loaded window.</span></>}
          </aside>
        </div>
      </> : null}
    </section>
    <section className="event-section panel event-temporal-analytics" aria-labelledby="event-temporal-title">
      <div className="event-section-heading">
        <p className="eyebrow">TEMPORAL ANALYTICS · {analyticsScope === 'full' ? 'FULL SESSION' : 'SELECTED WINDOW'}</p>
        <h2 id="event-temporal-title">Temporal analytics</h2>
        <p className="event-replay-description">Position uses factual step changes. The selected participant remains the focus across the map, observed state, detail and charts.</p>
        <div className="event-analytics-controls">
          <label><span>PARTICIPANT</span><select aria-label="Temporal analytics participant" value={selectedParticipantId ?? ''} onChange={(event) => event.target.value && selectParticipant(event.target.value)}>{participants.map((row) => <option key={row.participantId} value={row.participantId}>{`#${row.externalParticipantNumber ?? missing} · ${row.participantId}`}</option>)}</select></label>
          <div className="event-analytics-scope" role="group" aria-label="Temporal analytics scope"><span>RANGE</span><button type="button" className={analyticsScope === 'full' ? 'selected' : ''} onClick={() => setAnalyticsScope('full')}>FULL SESSION</button><button type="button" className={analyticsScope === 'window' ? 'selected' : ''} onClick={() => setAnalyticsScope('window')}>SELECTED WINDOW</button></div>
        </div>
      </div>
      {selectedStanding ? <div className="event-selected-participant-context" aria-label="Selected participant current factual state"><strong>{selectedStanding.externalParticipantNumber ? `#${selectedStanding.externalParticipantNumber}` : missing} · {selectedStanding.participantId}</strong><span>Observed position <b>{selectedStanding.position === null ? missing : `P${selectedStanding.position}`}</b></span><span>Observed lap <b>{selectedStanding.lapNumber === null ? missing : `L${selectedStanding.lapNumber}`}</b></span><span>Gap <b>{selectedStanding.gapFirstSeconds === null ? missing : `+${selectedStanding.gapFirstSeconds.toFixed(3)} s`}</b></span><span>Interval <b>{selectedStanding.gapPreviousSeconds === null ? missing : `+${selectedStanding.gapPreviousSeconds.toFixed(3)} s`}</b></span><span>Status <b>{display(selectedStanding.status)}</b></span></div> : null}
      <div className="event-temporal-grid event-temporal-grid-stacked">
        <ObservedSeriesChart title="Position over time" rows={series} metric="position" scope={analyticsScope === 'full' ? 'FULL SESSION' : 'SELECTED WINDOW'} selectedParticipant={selectedParticipantId ?? undefined} domainStart={chartDomainStart} domainEnd={chartDomainEnd} replayCursor={replayCursor} selectedWindowStart={effectiveWindowStart} selectedWindowEnd={effectiveWindowEnd} showWindowContext={analyticsScope === 'full'} onSelectParticipant={selectParticipant} />
        <div className="event-gap-chart"><div className="event-gap-mode" role="group" aria-label="Gap comparison mode"><button type="button" className={gapMode === 'selected' ? 'selected' : ''} onClick={() => setGapMode('selected')}>SELECTED</button><button type="button" className={gapMode === 'top5' ? 'selected' : ''} onClick={() => setGapMode('top5')}>TOP 5</button></div><ObservedSeriesChart title={`Gap to leader — ${selectedStanding?.externalParticipantNumber ? `#${selectedStanding.externalParticipantNumber}` : selectedParticipantId ?? missing}`} rows={gapSeries} metric="gap" scope={`${analyticsScope === 'full' ? 'FULL SESSION' : 'SELECTED WINDOW'} · ${gapMode === 'selected' ? 'SELECTED PARTICIPANT' : 'TOP 5'}`} selectedParticipant={activeGapParticipant ?? undefined} compact={gapMode === 'selected'} domainStart={chartDomainStart} domainEnd={chartDomainEnd} replayCursor={replayCursor} selectedWindowStart={effectiveWindowStart} selectedWindowEnd={effectiveWindowEnd} showWindowContext={analyticsScope === 'full'} onSelectParticipant={selectParticipant} /></div>
      </div>
    </section>
    {displayedStandings.length > 0 ? <section className="event-section panel event-observed-cards" aria-labelledby="observed-cards-title">
      <div className="event-section-heading"><h2 id="observed-cards-title">Participant state list</h2><p className="event-replay-description">Select a participant for factual standing and position detail. Unsupported race-result metrics are intentionally omitted.</p></div>
      <div className="event-participant-list">{displayedStandings.map((standing) => {
        const sample = markers.find((row) => row.participantId === standing.participantId)
        return <button type="button" key={standing.participantId} className={standing.participantId === selectedParticipantId ? 'selected' : ''} onClick={() => standing.participantId && selectParticipant(standing.participantId)}><strong>{standing.externalParticipantNumber ? '#' + standing.externalParticipantNumber : missing}</strong><span>{display(standing.participantId)}</span><b>{standing.position === null ? missing : 'P' + standing.position}</b><small>{display(standing.status)} · {sample ? display(sample.positionSource) : 'No sample'}</small></button>
      })}</div>
    </section> : null}
  </>
}
