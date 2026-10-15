import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventParticipantCard, EventParticipantRaceSummary, EventPredictionVsReality, EventSessionSummary, EventStorylineEntry } from '../types/raceIntelligence'

const api = vi.hoisted(() => ({
  fetchEventSessions: vi.fn(), fetchEventSession: vi.fn(), fetchEventParticipants: vi.fn(),
  fetchEventStoryline: vi.fn(), fetchEventPredictionVsReality: vi.fn(), fetchEventCards: vi.fn(),
  fetchEventStandings: vi.fn(), fetchEventStandingsSeries: vi.fn(), fetchEventObservedReplaySummary: vi.fn(), fetchEventTrackGeometry: vi.fn(), fetchEventTrackReplay: vi.fn(),
  createEventSession: vi.fn(), startEventSession: vi.fn(), completeEventSession: vi.fn(),
  createEventParticipant: vi.fn(), createEventLap: vi.fn(), createEventRaceEvent: vi.fn(), createEventMediaMarker: vi.fn(),
  fetchRecoverableEventCaptureSessions: vi.fn(),
  fetchEventMoments: vi.fn(), fetchEventMomentSnapshots: vi.fn(), createEventMoment: vi.fn(), eventSocialDataExportUrl: vi.fn(),
  fetchLiveMoments: vi.fn(), captureLiveMoment: vi.fn(), liveMomentsExportUrl: vi.fn(),
  fetchLiveEventState: vi.fn(), liveEventWebSocketUrl: vi.fn(), fetchLiveSource: vi.fn(),
  fetchBaseballCardData: vi.fn(), baseballCardDataExportUrl: vi.fn(),
}))

vi.mock('../api/raceIntelligence', () => api)

import { EventOperations } from './EventOperations'

const rehearsalId = 'REHEARSAL_AKS_4040'
const session = {
  sessionId: rehearsalId, sessionName: 'AKS recording rehearsal', eventId: 'AKS_4040',
  sessionType: 'RACE', status: 'RECORDING', startedAt: null, endedAt: null,
  sessionDurationSeconds: null, participantCount: 36, lapObservationCount: null, distinctLapCount: null,
  eventCount: null, mediaMarkerCount: null, snapshotCount: null, fastestLapSeconds: null,
  fastestParticipantName: null, finalLeaderName: null, finalLeaderPosition: null,
  source: 'AKS', operationalContext: 'REHEARSAL', factualEvidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0',
} as EventSessionSummary
const participants = Array.from({ length: 36 }, (_, index) => ({ sessionId: rehearsalId, participantId: `AKS_${index + 1}`, displayName: null, externalParticipantNumber: String(index + 1), participantType: 'UNCLASSIFIED', finalPosition: null, lapCount: null, bestLapSeconds: null, averageLapSeconds: null, timingCatchLap: null, timingCatchTimeSeconds: null, physicalPassLap: null, physicalPassTimeSeconds: null, jokerCount: null, incidentCount: null, source: 'AKS', operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0' } as EventParticipantRaceSummary))
const storyline: EventStorylineEntry[] = []
const predictions: EventPredictionVsReality[] = []
const cards = participants.map((participant) => ({ sessionId: rehearsalId, participantId: participant.participantId, displayName: participant.displayName, externalParticipantNumber: participant.externalParticipantNumber, participantType: 'UNCLASSIFIED', actualStartPosition: null, actualFinalPosition: null, positionChange: null, actualBestLapSeconds: null, actualAverageLapSeconds: null, actualCompletedLaps: null, heldMaxOffLaps: null, heldMaxOffSeconds: null, timingCatchLap: null, timingCatchTimeSeconds: null, physicalPassLap: null, physicalPassTimeSeconds: null, jokerCount: null, dataProvenance: 'ACTUAL_EVENT', cardDataStatus: 'INSUFFICIENT_DATA', predictedCatchLap: null, predictedFinalPosition: null, predictionErrorSeconds: null, operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0' } as EventParticipantCard))

beforeEach(() => {
  api.fetchLiveSource.mockResolvedValue({sessionId:rehearsalId,mode:'LIVE',status:'RUNNING'})
  api.fetchEventSessions.mockResolvedValue([session])
  api.fetchEventSession.mockResolvedValue(session)
  api.fetchEventParticipants.mockResolvedValue(participants)
  api.fetchEventStoryline.mockResolvedValue(storyline)
  api.fetchEventPredictionVsReality.mockResolvedValue(predictions)
  api.fetchEventCards.mockResolvedValue(cards)
  api.fetchEventStandings.mockResolvedValue([])
  api.fetchEventObservedReplaySummary.mockResolvedValue({
    sessionId: rehearsalId, standingSnapshotCount: 5076, standingRowCount: 182736,
    latestStandingObservedAt: null, latestStandingLap: null, latestObservedLeaderParticipantId: null,
    latestObservedLeaderExternalParticipantNumber: null, latestFieldSpreadSeconds: null,
    positionSampleCount: 503535, gpsCorrectedSampleCount: 255330, rgpsRawSampleCount: 248205,
    scSourceSampleCount: 6708, positionFirstObservedAt: null, positionLastObservedAt: null,
  })
  api.fetchEventTrackGeometry.mockResolvedValue({ source: 'GPS_CORRECTED', derivedFrom: 'FULL_SESSION_OBSERVED_POSITIONS', sourceEntityId: 'AKS_1', pointCount: 0, observedFrom: null, observedTo: null, points: [] })
  api.fetchEventStandingsSeries.mockResolvedValue([])
  api.fetchEventTrackReplay.mockResolvedValue([])
  api.fetchRecoverableEventCaptureSessions.mockResolvedValue([])
  api.fetchEventMoments.mockResolvedValue([])
  api.fetchLiveMoments.mockResolvedValue({moments:[],candidates:[],participants:[],metadata:{source_mode:'LIVE'}})
  api.liveMomentsExportUrl.mockReturnValue('http://example.test/live-moments/export.xlsx')
  api.fetchEventMomentSnapshots.mockResolvedValue([])
  api.eventSocialDataExportUrl.mockReturnValue('http://example.test/social-data-export.xlsx')
  api.fetchLiveEventState.mockResolvedValue({ sessionId: rehearsalId, stateVersion: 0, updatedAt: null, lastMessageAt: null, connection: { status: 'CONNECTING', connectionId: 0, reconnectCount: 0, stale: false }, sessionState: {}, standings: [], participants: [], finishLine: [], positions: { GPS_CORRECTED: [] }, eventMomentCandidates: [] })
  api.liveEventWebSocketUrl.mockReturnValue('ws://example.test/live')
  api.fetchBaseballCardData.mockResolvedValue({ sessionId: rehearsalId, mode: 'event', metadata: { rowCount: 1 }, rows: [{
    'Card No': 1, 'Participant ID': 'AKS_23', 'Participant Name': null, 'Kart No': 23, 'Kart Display': 'KART 23',
    'Laps When Max Passed': null, 'Time Spent Ahead of Max': null, 'Field Performance Rank': null, 'Field Performance Display': null, 'Start Position': null, 'Peak Position': 8,
    'Final Position': null, 'Position Change': null, 'Start Display': null, 'Peak Display': 'P8', 'Final Display': null, 'Change Display': null,
    'Primary Result Label': 'FACTUAL EVENT', 'Primary Result Statement': null, 'Time Metric Label': null, 'Field Metric Label': null, Campaign: 'MAX VS 100', 'Campaign Subtitle': 'RACE INTELLIGENCE',
    'Photo Asset': null, status: 'PARTIAL', statusReasons: ['NO_FINAL_CLASSIFICATION'], evidenceDomain: 'FACTUAL_OBSERVATION', latestObservedPosition: 11,
  }] })
  api.baseballCardDataExportUrl.mockImplementation((_sessionId: string, format: string) => `http://example.test/card-data.${format}`)
})

afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('EventOperations', () => {
  it('renders the real AKS rehearsal with explicit provenance and unavailable factual evidence', async () => {
    render(<EventOperations />)
    expect(await screen.findByRole('heading', { name: 'Race Operations' })).toBeTruthy()
    await waitFor(() => expect(api.fetchEventSession).toHaveBeenCalledWith(rehearsalId, expect.anything()))
    expect((screen.getByLabelText('Event session') as HTMLSelectElement).value).toBe(rehearsalId)
    expect(await screen.findByText('Observed session summary')).toBeTruthy()
    expect(screen.getByText('Latest observed race state')).toBeTruthy()
    expect(screen.getByText('Observed track reference — Jarama')).toBeTruthy()
    expect(screen.getAllByText('REHEARSAL DATA').length).toBeGreaterThan(0)
    expect(screen.getAllByText('RECORDING').length).toBeGreaterThan(0)
    expect(screen.getByText('SOURCE AKS')).toBeTruthy()
    expect(screen.getByText('No factual storyline entries captured.')).toBeTruthy()
    expect(screen.getByText('No prediction snapshots captured.')).toBeTruthy()
    expect(screen.getAllByText('CAPTURED REHEARSAL').length).toBeGreaterThan(0)
    expect(screen.queryByText('ACTUAL EVENT')).toBeNull()
    expect(screen.queryByText(/synthetic percentile/i)).toBeNull()
  })

  it('opens an operational meaning tooltip with keyboard focus without changing the selected session', async () => {
    render(<EventOperations />)
    await screen.findByRole('heading', { name: 'Race Operations' })
    await waitFor(() => expect(api.fetchEventSession).toHaveBeenCalledWith(rehearsalId, expect.anything()))
    await screen.findByText('Observed session summary')
    const trigger = screen.getByRole('button', { name: 'About Session Status' })
    fireEvent.focus(trigger)
    expect(screen.getByRole('tooltip').textContent).toMatch(/captured lifecycle state/i)
    expect((screen.getByLabelText('Event session') as HTMLSelectElement).value).toBe(rehearsalId)
    fireEvent.blur(trigger)
    expect(screen.queryByRole('tooltip')).toBeNull()

    expect(screen.queryByRole('button', { name: 'About Timing Catch' })).toBeNull()

  })

  it('opens Event Moments as an identity-safe operational workspace', async () => {
    render(<EventOperations />)
    await screen.findByText('Observed session summary')
    fireEvent.click(screen.getByRole('button', { name: 'EVENT MOMENTS' }))
    expect(await screen.findByRole('heading', { name: 'Editorially useful, evidence-bound moments' })).toBeTruthy()
    expect(api.fetchEventMoments).toHaveBeenCalledWith(rehearsalId, { type: undefined, triggerMode: undefined, priority: undefined })
    expect(screen.getByText(/never stores names, photos, social handles/i)).toBeTruthy()
    expect(screen.getByRole('link', { name: /export xlsx/i }).getAttribute('href')).toContain('social-data-export.xlsx')
  })

  it('shows identity-safe Baseball Card Data for a rehearsal without a driver-name column', async () => {
    api.fetchLiveSource.mockResolvedValue({sessionId:'REHEARSAL_LIVE_CHECK',mode:'LIVE'})
    render(<EventOperations />)
    fireEvent.click(screen.getByRole('button', { name: 'BASEBALL CARD DATA' }))
    await screen.findByText('Baseball Card Data')
    expect(api.fetchBaseballCardData).toHaveBeenCalledWith('REHEARSAL_LIVE_CHECK', 'event', expect.anything(), 'live')
    expect(screen.getByText('KART 23')).toBeTruthy()
    expect(screen.queryByText('Participant Name')).toBeNull()
    expect(screen.getByRole('button', { name: 'DOWNLOAD XLSX' })).toBeTruthy()
    fireEvent.click(screen.getByText('KART 23'))
    expect(screen.getByLabelText('Card data preview').textContent).toContain('No approved final classification')
  })

  it('keeps required session evidence visible if an optional resource fails', async () => {
    api.fetchEventStoryline.mockRejectedValueOnce(new Error('Storyline view unavailable'))
    api.fetchEventPredictionVsReality.mockRejectedValueOnce(new Error('Prediction view unavailable'))
    render(<EventOperations />)
    expect(await screen.findByText('Observed session summary')).toBeTruthy()
    expect(screen.getAllByText('RECORDING').length).toBeGreaterThan(0)
    expect(screen.getByText('Storyline is temporarily unavailable.')).toBeTruthy()
    expect(screen.getByText('Prediction comparison is temporarily unavailable.')).toBeTruthy()
    expect(screen.queryByText('Session data unavailable')).toBeNull()
  })

  it('shows a clear API error instead of an empty operations dashboard', async () => {
    api.fetchEventSessions.mockRejectedValueOnce(new Error('Event service unavailable'))
    render(<EventOperations />)
    expect((await screen.findByRole('alert')).textContent).toContain('Event service unavailable')
    expect(screen.queryByText('No event sessions are available.')).toBeNull()
  })
})
