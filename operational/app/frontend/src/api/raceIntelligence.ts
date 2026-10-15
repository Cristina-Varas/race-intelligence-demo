import type {
  HealthStatus,
  HistoricalDriver,
  ProbabilityPoint,
  RaceIntelligenceData,
  ScenarioSummary,
  VirtualMaxProfile,
  CustomSimulationResult,
  SimulationRequest,
  TrackTopology,
  HistoricalReplay,
  JokerStrategyResult,
  JokerComparisonResult,
  EventParticipantCard,
  EventParticipantRaceSummary,
  EventPredictionVsReality,
  EventSessionSummary,
  EventStorylineEntry,
  EventWriteAcknowledgement,
  EventSessionCreateRequest,
  EventParticipantCreateRequest,
  EventLapCreateRequest,
  EventRaceEventCreateRequest,
  EventMediaMarkerCreateRequest,
  EventCaptureSessionState,
  EventObservedReplaySummary,
  EventTrackGeometry,
  StandingReplayRow,
  TrackReplayRow,
  EventMoment,
  EventMomentSnapshot,
  EventMomentCreateRequest,
  LiveEventState,
  BaseballCardDataResponse,
} from '../types/raceIntelligence'

export const API_BASE_URL = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8003').replace(/\/$/, '')
export const fetchLiveSource = () => request<{ sessionId: string; mode: string; status: string; speed: number | null }>('/api/event/live-source')
export interface FrozenMoment {
  moment_id: string; moment_type: string; captured_at: string; observed_at: string | null;
  primary_participant_id: string | null; primary_kart_number: string | number | null;
  secondary_kart_number: string | number | null; latest_observed_position: number | null;
  peak_observed_position: number | null; observed_lap: number | null; gap_to_leader: number | null;
  previous_gap: number | null; current_gap: number | null; interval: number | null; best_valid_lap: number | null;
  observed_leader_kart: string | number | null; capture_origin: 'AUTOMATIC' | 'OPERATOR'; operator_note: string | null;
}
export interface LiveMomentsData {
  moments: FrozenMoment[];
  candidates: { candidateId: string; momentType: string; snapshot: FrozenMoment }[];
  participants: { participantId: string; kartNumber: string | number }[];
  metadata: { sourceEpoch?: number; sourceState?: 'READY'|'REBUILDING'; source_mode: string; operational_context: string | null; captured_moment_count: number };
}
export const fetchLiveMoments = (session: string, signal?: AbortSignal) => request<LiveMomentsData>(`/api/event/sessions/${encodeURIComponent(session)}/live-moments`, signal)
export const captureLiveMoment = (session: string, payload: { momentType?: string; candidateId?: string; primaryParticipantId?: string; secondaryParticipantId?: string; note?: string }) => request<FrozenMoment>(`/api/event/sessions/${encodeURIComponent(session)}/live-moments`, undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
export const liveMomentsExportUrl = (session: string, format: 'xlsx' | 'csv') => `${API_BASE_URL}/api/event/sessions/${encodeURIComponent(session)}/live-moments/export.${format}`
const isDevelopment = import.meta.env.DEV

function isAbortedRequest(error: unknown) {
  if (error instanceof DOMException && error.name === 'AbortError') return true
  if (error instanceof Error && error.name === 'AbortError') return true
  return error instanceof Error && error.cause instanceof DOMException && error.cause.name === 'AbortError'
}

if (isDevelopment) console.info('[simulation] API base URL', API_BASE_URL)

async function request<T>(path: string, signal?: AbortSignal, options?: RequestInit): Promise<T> {
  const url = `${API_BASE_URL}${path}`
  let response: Response
  try {
    response = await fetch(url, { signal, ...options })
  } catch (error) {
    throw new Error(`Request to ${url} failed. Possible network, CORS, or backend issue.`, { cause: error })
  }
  if (!response.ok) {
    const detail = await response.json().catch(() => null) as { detail?: string } | null
    throw new Error(`${detail?.detail ?? `Race Intelligence API returned ${response.status}.`} Request: ${url}`)
  }
  return response.json() as Promise<T>
}

export function evaluateJoker(payload: { driverId: string; routeId: 'joker_1' | 'joker_2'; lap: number; jokerSpeedFactor: number; scenario: SimulationRequest }, signal?: AbortSignal) {
  return request<JokerStrategyResult>('/api/strategy/joker', signal, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}
export function compareJokers(payload: { driverId: string; options: { routeId: 'joker_1' | 'joker_2'; lap: number; jokerSpeedFactor: number }[]; scenario: SimulationRequest }) { return request<JokerComparisonResult>('/api/strategy/joker/compare', undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }) }

export async function runSimulation(payload: SimulationRequest, signal?: AbortSignal): Promise<CustomSimulationResult> {
  if (isDevelopment) console.info('[simulation] request starting', payload)
  try {
    const result = await request<CustomSimulationResult>('/api/simulation/run', signal, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    if (isDevelopment) console.info('[simulation] request success', result)
    return result
  } catch (error) {
    if (isDevelopment && isAbortedRequest(error)) console.debug('[simulation] request aborted')
    else if (isDevelopment) console.error('[simulation] request failed', error)
    throw error
  }
}

export async function fetchRaceIntelligence(signal?: AbortSignal): Promise<RaceIntelligenceData> {
  const [health, summary, curve, virtualMax, drivers] = await Promise.all([
    request<HealthStatus>('/health?check_database=true', signal),
    request<ScenarioSummary>('/api/scenario/summary', signal),
    request<ProbabilityPoint[]>('/api/scenario/probability-curve', signal),
    request<VirtualMaxProfile>('/api/scenario/virtual-max', signal),
    request<HistoricalDriver[]>('/api/historical/drivers', signal),
  ])
  return { health, summary, curve, virtualMax, drivers }
}

export async function fetchTrackReplay(signal?: AbortSignal): Promise<{ topology: TrackTopology; replay: HistoricalReplay }> {
  const [topology, replay] = await Promise.all([
    request<TrackTopology>('/api/track/topology', signal),
    request<HistoricalReplay>('/api/replay/historical', signal),
  ])
  return { topology, replay }
}

export function fetchTrackTopology(signal?: AbortSignal): Promise<TrackTopology> {
  return request<TrackTopology>('/api/track/topology', signal)
}

export function fetchEventSessions(signal?: AbortSignal): Promise<EventSessionSummary[]> {
  return request<EventSessionSummary[]>('/api/event/sessions', signal)
}

export function fetchEventSession(sessionId: string, signal?: AbortSignal): Promise<EventSessionSummary> {
  return request<EventSessionSummary>(`/api/event/sessions/${encodeURIComponent(sessionId)}`, signal)
}

export function fetchEventParticipants(sessionId: string, signal?: AbortSignal): Promise<EventParticipantRaceSummary[]> {
  return request<EventParticipantRaceSummary[]>(`/api/event/sessions/${encodeURIComponent(sessionId)}/participants`, signal)
}

export function fetchEventStoryline(sessionId: string, signal?: AbortSignal): Promise<EventStorylineEntry[]> {
  return request<EventStorylineEntry[]>(`/api/event/sessions/${encodeURIComponent(sessionId)}/storyline`, signal)
}

export function fetchEventPredictionVsReality(sessionId: string, signal?: AbortSignal): Promise<EventPredictionVsReality[]> {
  return request<EventPredictionVsReality[]>(`/api/event/sessions/${encodeURIComponent(sessionId)}/prediction-vs-reality`, signal)
}

export function fetchEventCards(sessionId: string, signal?: AbortSignal): Promise<EventParticipantCard[]> {
  return request<EventParticipantCard[]>(`/api/event/sessions/${encodeURIComponent(sessionId)}/cards`, signal)
}

export type EventMomentsQuery = { type?: string; participantId?: string; triggerMode?: string; priority?: string; fromTime?: string; toTime?: string; limit?: number; offset?: number }
export function fetchEventMoments(sessionId: string, query: EventMomentsQuery = {}, signal?: AbortSignal): Promise<EventMoment[]> {
  return request<EventMoment[]>(`/api/event/sessions/${encodeURIComponent(sessionId)}/moments${eventReplayQuery({
    moment_type: query.type, participant_id: query.participantId, trigger_mode: query.triggerMode, priority: query.priority,
    from_time: query.fromTime, to_time: query.toTime, limit: query.limit ?? 200, offset: query.offset ?? 0,
  })}`, signal)
}
export function fetchEventMomentSnapshots(sessionId: string, momentId: string, signal?: AbortSignal): Promise<EventMomentSnapshot[]> {
  return request<EventMomentSnapshot[]>(`/api/event/sessions/${encodeURIComponent(sessionId)}/moments/${encodeURIComponent(momentId)}/snapshots`, signal)
}
export function createEventMoment(sessionId: string, payload: EventMomentCreateRequest): Promise<EventMoment> {
  return request<EventMoment>(`/api/event/sessions/${encodeURIComponent(sessionId)}/moments`, undefined, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
}
export function eventSocialDataExportUrl(sessionId: string): string { return `${API_BASE_URL}/api/event/sessions/${encodeURIComponent(sessionId)}/social-data-export.xlsx` }
export function fetchBaseballCardData(sessionId: string, mode: 'event' | 'modelled', signal?: AbortSignal, source = 'auto'): Promise<BaseballCardDataResponse> {
  return request<BaseballCardDataResponse>(`/api/event/sessions/${encodeURIComponent(sessionId)}/baseball-card-data?mode=${mode}&source=${source}`, signal)
}
export function baseballCardDataExportUrl(sessionId: string, format: 'xlsx' | 'csv', mode: 'event' | 'modelled', source = 'auto'): string {
  if (mode === 'modelled') return `${API_BASE_URL}/api/event/modelled-card-data/export/${format}`
  return `${API_BASE_URL}/api/event/sessions/${encodeURIComponent(sessionId)}/baseball-card-data.${format}?mode=${mode}&source=${source}`
}

export function fetchEventObservedReplaySummary(sessionId: string, signal?: AbortSignal): Promise<EventObservedReplaySummary> {
  return request<EventObservedReplaySummary>(`/api/event/sessions/${encodeURIComponent(sessionId)}/observed-replay-summary`, signal)
}

export function fetchLiveEventState(sessionId: string, signal?: AbortSignal): Promise<LiveEventState> {
  return request<LiveEventState>(`/api/event/sessions/${encodeURIComponent(sessionId)}/live-state`, signal)
}

export function liveEventWebSocketUrl(sessionId: string): string {
  return `${API_BASE_URL.replace(/^http/, 'ws')}/api/event/sessions/${encodeURIComponent(sessionId)}/live`
}

/** Full-session observed GPS reference; intentionally independent from the bounded replay window. */
export function fetchEventTrackGeometry(sessionId: string, signal?: AbortSignal): Promise<EventTrackGeometry> {
  return request<EventTrackGeometry>(`/api/event/sessions/${encodeURIComponent(sessionId)}/track-geometry`, signal)
}


function eventReplayQuery(params: Record<string, string | number | undefined>): string {
  const query = new URLSearchParams()
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== '') query.set(key, String(value))
  })
  const encoded = query.toString()
  return encoded ? `?${encoded}` : ''
}

export type EventStandingsQuery = {
  fromTime?: string
  toTime?: string
  atTime?: string
  participantId?: string
  snapshotId?: string
  limit?: number
}

export function fetchEventStandings(sessionId: string, query: EventStandingsQuery = {}, signal?: AbortSignal): Promise<StandingReplayRow[]> {
  return request<StandingReplayRow[]>(
    `/api/event/sessions/${encodeURIComponent(sessionId)}/standings${eventReplayQuery({
      from_time: query.fromTime, to_time: query.toTime, participant_id: query.participantId,
      snapshot_id: query.snapshotId, at_time: query.atTime, limit: query.limit,
    })}`,
    signal,
  )
}

export type EventStandingsSeriesQuery = {
  fromTime?: string
  toTime?: string
  participantId?: string
  topN?: number
  resolutionSeconds?: number
  limit?: number
}

export function fetchEventStandingsSeries(sessionId: string, query: EventStandingsSeriesQuery = {}, signal?: AbortSignal): Promise<StandingReplayRow[]> {
  return request<StandingReplayRow[]>(
    `/api/event/sessions/${encodeURIComponent(sessionId)}/standings-series${eventReplayQuery({
      from_time: query.fromTime, to_time: query.toTime, participant_id: query.participantId,
      top_n: query.topN ?? 5, resolution_seconds: query.resolutionSeconds ?? 30, limit: query.limit ?? 1500,
    })}`,
    signal,
  )
}

export type EventTrackReplayQuery = {
  fromTime?: string
  toTime?: string
  participantId?: string
  sourceEntityId?: string
  positionSource?: 'GPS_CORRECTED' | 'RGPS_RAW'
  resolutionSeconds?: number
  limit?: number
}

export function fetchEventTrackReplay(sessionId: string, query: EventTrackReplayQuery = {}, signal?: AbortSignal): Promise<TrackReplayRow[]> {
  return request<TrackReplayRow[]>(
    `/api/event/sessions/${encodeURIComponent(sessionId)}/track-replay${eventReplayQuery({
      from_time: query.fromTime, to_time: query.toTime, participant_id: query.participantId,
      source_entity_id: query.sourceEntityId, position_source: query.positionSource ?? 'GPS_CORRECTED',
      resolution_seconds: query.resolutionSeconds,
      limit: query.limit ?? 1000,
    })}`,
    signal,
  )
}

export function fetchRecoverableEventCaptureSessions(signal?: AbortSignal): Promise<EventCaptureSessionState[]> {
  return request<EventCaptureSessionState[]>('/api/event/capture/sessions', signal)
}

export function fetchRecoverableEventCaptureSession(sessionId: string, signal?: AbortSignal): Promise<EventCaptureSessionState> {
  return request<EventCaptureSessionState>(`/api/event/capture/sessions/${encodeURIComponent(sessionId)}`, signal)
}

function eventWrite<T>(path: string, payload?: T): Promise<EventWriteAcknowledgement> {
  return request<EventWriteAcknowledgement>(path, undefined, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: payload ? JSON.stringify(payload) : undefined,
  })
}

export function createEventSession(payload: EventSessionCreateRequest) { return eventWrite('/api/event/sessions', payload) }
export function startEventSession(sessionId: string) { return eventWrite(`/api/event/sessions/${encodeURIComponent(sessionId)}/start`) }
export function completeEventSession(sessionId: string) { return eventWrite(`/api/event/sessions/${encodeURIComponent(sessionId)}/complete`) }
export function createEventParticipant(sessionId: string, payload: EventParticipantCreateRequest) { return eventWrite(`/api/event/sessions/${encodeURIComponent(sessionId)}/participants`, payload) }
export function createEventLap(sessionId: string, payload: EventLapCreateRequest) { return eventWrite(`/api/event/sessions/${encodeURIComponent(sessionId)}/laps`, payload) }
export function createEventRaceEvent(sessionId: string, payload: EventRaceEventCreateRequest) { return eventWrite(`/api/event/sessions/${encodeURIComponent(sessionId)}/events`, payload) }
export function createEventMediaMarker(sessionId: string, payload: EventMediaMarkerCreateRequest) { return eventWrite(`/api/event/sessions/${encodeURIComponent(sessionId)}/media-markers`, payload) }
