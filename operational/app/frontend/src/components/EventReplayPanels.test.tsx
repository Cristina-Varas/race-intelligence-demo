import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { EventTrackGeometry, StandingReplayRow, TrackReplayRow } from '../types/raceIntelligence'

const api = vi.hoisted(() => ({ fetchEventStandings: vi.fn(), fetchEventStandingsSeries: vi.fn(), fetchEventObservedReplaySummary: vi.fn(), fetchEventTrackGeometry: vi.fn(), fetchEventTrackReplay: vi.fn() }))
vi.mock('../api/raceIntelligence', () => api)

import { buildObservedTrackTraces, buildReplayFrames, EventReplayPanels, fitWindowSpeed, isObservedGeometryRow, markerState, replayFrameIndexAt, replayPlaybackDurationMilliseconds, shapeObservedSeries, splitObservedSeriesAtGaps, standingAtOrBefore } from './EventReplayPanels'

const sessionId = 'REHEARSAL_AKS_4040'
const standings: StandingReplayRow[] = Array.from({ length: 36 }, (_, index) => ({
  sessionId, snapshotId: 'latest', sourceSnapshotKey: 'latest', participantId: `AKS_${index + 1}`,
  externalParticipantNumber: String(index + 1), observedAt: '2026-09-03T14:01:01.348Z', sourceTimestamp: null,
  recordedAt: '2026-09-03T14:01:01.348Z', ingestedAt: '2026-09-03T14:01:02.000Z',
  position: index + 1, lapNumber: 5, elapsedTimeSeconds: 585.873 + index, gapFirstSeconds: index === 0 ? 0 : index / 10,
  gapFirstLaps: 0, gapPreviousSeconds: index === 0 ? 0 : .1, gapPreviousLaps: 0, status: 'CLASSIFIED',
  positionChange: 0, atLoop: 'LOOP_1', source: 'AKS', operationalContext: 'REHEARSAL',
  evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0',
}))

const samples: TrackReplayRow[] = [
  {
    sessionId, sampleId: 'aks-1', sourceEntityId: 'AKS_10', participantId: 'AKS_10',
    externalParticipantNumber: '10', observedAt: '2026-09-03T14:00:02.000Z', sourceTimestamp: null,
    recordedAt: '2026-09-03T14:00:02.000Z', positionSource: 'GPS_CORRECTED', latitude: 40.1, longitude: -3.1,
    rawStatusBits: 1, unknownStatusBits: 0, isOfficialCar: false, isLeader: true, isLapped: false,
    isClassLeader: false, isStopped: false, isClassLapped: false, isInPit: false, isOutLap: false,
    isPositionUnknown: false, isRetired: false, isLate: false, isEntryListTarget: false, isNoGps: false,
    isChequered: false, source: 'AKS', operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION',
    eventContractVersion: '1.0',
  },
  {
    sessionId, sampleId: 'sc-1', sourceEntityId: 'SC', participantId: null, externalParticipantNumber: null,
    observedAt: '2026-09-03T14:00:03.000Z', sourceTimestamp: null, recordedAt: '2026-09-03T14:00:03.000Z',
    positionSource: 'GPS_CORRECTED', latitude: 40.2, longitude: -3.2, rawStatusBits: 0, unknownStatusBits: 0,
    isOfficialCar: true, isLeader: false, isLapped: false, isClassLeader: false, isStopped: true,
    isClassLapped: false, isInPit: false, isOutLap: false, isPositionUnknown: false, isRetired: false,
    isLate: false, isEntryListTarget: false, isNoGps: false, isChequered: false, source: 'AKS',
    operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0',
  },
]

const geometry: EventTrackGeometry = {
  source: 'GPS_CORRECTED', derivedFrom: 'FULL_SESSION_OBSERVED_POSITIONS', sourceEntityId: 'AKS_10', pointCount: 3,
  observedFrom: '2026-09-03T12:00:00.000Z', observedTo: '2026-09-03T14:01:01.348Z',
  points: [{ latitude: 40.1, longitude: -3.1 }, { latitude: 40.1001, longitude: -3.1001 }, { latitude: 40.1002, longitude: -3.1002 }],
}

beforeEach(() => {
  api.fetchEventStandings.mockResolvedValue(standings)
  api.fetchEventObservedReplaySummary.mockResolvedValue({
    sessionId, standingSnapshotCount: 5076, standingRowCount: 182736,
    latestStandingObservedAt: '2026-09-03T14:01:01.348Z', latestStandingLap: 5,
    latestObservedLeaderParticipantId: 'AKS_1', latestObservedLeaderExternalParticipantNumber: '1',
    latestFieldSpreadSeconds: 3.5, positionSampleCount: 503535,
    gpsCorrectedSampleCount: 255330, rgpsRawSampleCount: 248205, scSourceSampleCount: 6708,
    positionFirstObservedAt: '2026-09-03T12:00:00.000Z', positionLastObservedAt: '2026-09-03T14:01:01.348Z',
  })
  api.fetchEventTrackGeometry.mockResolvedValue(geometry)
  api.fetchEventStandingsSeries.mockResolvedValue(standings)
  api.fetchEventTrackReplay.mockResolvedValue(samples)
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('EventReplayPanels', () => {
  it('never joins entities, excludes SC, and splits an implausible GPS discontinuity', () => {
    const rows: TrackReplayRow[] = [
      samples[0],
      { ...samples[0], sampleId: 'aks-2', observedAt: '2026-09-03T14:00:01.000Z', latitude: 40.1001, longitude: -3.1001 },
      { ...samples[0], sampleId: 'aks-jump', observedAt: '2026-09-03T14:00:02.000Z', latitude: 41, longitude: -4 },
      { ...samples[0], sampleId: 'aks-3', observedAt: '2026-09-03T14:00:03.000Z', latitude: 41.0001, longitude: -4.0001 },
      samples[1],
    ]
    expect(isObservedGeometryRow(samples[1])).toBe(false)
    const traces = buildObservedTrackTraces(rows)
    expect(traces).toHaveLength(2)
    expect(traces.every((trace) => trace.entity === 'AKS_10')).toBe(true)
    expect(traces.flatMap((trace) => trace.rows).some((row) => row.sourceEntityId === 'SC')).toBe(false)
  })

  it('builds playback frames by observed timestamp, keeping the latest sample per entity', () => {
    const rows = [
      samples[0],
      { ...samples[0], sampleId: 'aks-1-update', observedAt: '2026-09-03T14:00:03.000Z', latitude: 40.11 },
      samples[1],
    ]
    const beforeSecond = markerState(rows, Date.parse('2026-09-03T14:00:02.500Z'))
    const atSecond = markerState(rows, Date.parse('2026-09-03T14:00:03.000Z'))
    expect(beforeSecond).toHaveLength(1)
    expect(atSecond).toHaveLength(2)
    expect(atSecond.find((row) => row.sourceEntityId === 'AKS_10')?.sampleId).toBe('aks-1-update')
  })

  it('bounds replay frames to the selected window and covers a complete 15-minute range', () => {
    const start = Date.parse('2026-09-03T12:43:40.000Z')
    const end = start + 900_000
    const frames = buildReplayFrames([
      { ...samples[0], observedAt: '2026-09-03T12:43:42.000Z' },
      { ...samples[0], observedAt: '2026-09-03T12:51:10.000Z' },
      { ...samples[0], observedAt: '2026-09-03T12:58:35.000Z' },
    ], start, end, 10)
    expect(frames[0]).toBe(start)
    expect(frames.at(-1)).toBe(end)
    expect(frames.every((frame) => frame >= start && frame <= end)).toBe(true)
    expect(replayFrameIndexAt(frames, end + 60_000)).toBe(frames.length - 1)
    expect(replayPlaybackDurationMilliseconds(frames, fitWindowSpeed(900))).toBeCloseTo(30_000, -2)
  })

  it('shapes temporal observations deterministically without duplicate timestamps or invented joins', () => {
    const rows = [
      { ...standings[1], observedAt: '2026-09-03T12:00:00.000Z', position: 2 },
      { ...standings[1], observedAt: '2026-09-03T12:00:00.000Z', position: 3 },
      { ...standings[1], observedAt: '2026-09-03T12:00:30.000Z', position: 3 },
      { ...standings[1], observedAt: '2026-09-03T12:03:30.000Z', position: 4 },
    ]
    const shaped = shapeObservedSeries(rows)
    expect(shaped.map((row) => row.position)).toEqual([3, 3, 4])
    expect(splitObservedSeriesAtGaps(shaped)).toHaveLength(2)
    expect(standingAtOrBefore(shaped, Date.parse('2026-09-03T12:00:20.000Z'))?.position).toBe(3)
    expect(standingAtOrBefore(shaped, Date.parse('2026-09-03T11:59:59.000Z'))).toBeUndefined()
  })

  it('renders bounded factual standings, coordinate replay, and SC without inventing identity', async () => {
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    expect(await screen.findByText('Observed session summary')).toBeTruthy()
    expect(screen.getByText('Latest observed race state')).toBeTruthy()
    expect(screen.getByText('Observed track reference — Jarama')).toBeTruthy()
    await waitFor(() => expect(api.fetchEventStandings).toHaveBeenCalledWith(sessionId, { limit: 500 }, expect.anything()))
    await waitFor(() => expect(api.fetchEventTrackGeometry).toHaveBeenCalledWith(sessionId, expect.anything()))
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenCalledWith(sessionId, expect.objectContaining({ positionSource: 'GPS_CORRECTED', participantId: undefined, resolutionSeconds: 1, limit: 5000 }), expect.anything()))
    // A newly selected window starts at its factual lower bound. There need
    // not be a position sample exactly at that instant, so advance within the
    // window before asserting a live marker.
    expect(screen.getAllByRole('row')).toHaveLength(37)
    expect(screen.getAllByText('#10').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0.000 s').length).toBeGreaterThan(0)
    expect(screen.getByText(/Captured GPS-derived geometry from the Jarama rehearsal session/i)).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Observed track reconstruction' })).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Observed track reconstruction' }).getAttribute('preserveAspectRatio')).toBe('xMidYMid meet')
    expect(screen.getByLabelText('Operational replay summary')).toBeTruthy()
    expect(screen.getByText('LEADER')).toBeTruthy()
    expect(screen.getAllByText('AKS_10').length).toBeGreaterThan(0)
    expect(screen.queryByText('#10 AKS_10')).toBeNull()
    expect(screen.getByLabelText('Replay marker legend')).toBeTruthy()
    expect(screen.getByLabelText('Global session timeline')).toBeTruthy()
    expect(screen.getByLabelText('Replay window')).toBeTruthy()
    expect(screen.queryByLabelText('Custom replay range seconds')).toBeNull()
    expect(screen.getByRole('img', { name: 'Position over time' })).toBeTruthy()
    expect(screen.getByRole('img', { name: /Gap to leader — #1/ })).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Replay timeline'), { target: { value: String(Date.parse('2026-09-03T14:00:03.000Z')) } })
    await waitFor(() => expect(api.fetchEventStandings).toHaveBeenCalledWith(sessionId, expect.objectContaining({ atTime: expect.any(String), limit: 500 }), expect.anything()))
    expect(await screen.findByText('CAPTURED PARTICIPANT')).toBeTruthy()
    expect(screen.getByText(/Observed race state at/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Next replay window' }))
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ positionSource: 'GPS_CORRECTED' }), expect.anything()))
    fireEvent.click(screen.getByRole('button', { name: 'Inspect SOURCE ENTITY SC' }))
    expect(screen.getAllByText('SOURCE ENTITY SC').length).toBeGreaterThan(1)
    expect(screen.getByText('No participant identity')).toBeTruthy()
    expect(screen.getAllByText('SC').length).toBeGreaterThan(1)
    expect(screen.getByText('SC SOURCE')).toBeTruthy()
    expect(screen.getAllByText('PRESENT').length).toBeGreaterThan(0)
    expect(screen.getByText(/6708 source samples/i)).toBeTruthy()
    expect(screen.queryByText('SAFETY CAR ACTIVE')).toBeNull()
    expect(screen.getByText('Participant state list')).toBeTruthy()
    expect(screen.getByText('Position source')).toBeTruthy()
  }, 10000)

  it('keeps the full-session GPS reference stable while replay markers move in the bounded window', async () => {
    const { container } = render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await screen.findByRole('img', { name: 'Observed track reconstruction' })
    await screen.findByLabelText('Replay timeline')
    const path = container.querySelector('polyline.event-replay-path')
    const before = path?.getAttribute('points')
    fireEvent.change(screen.getByLabelText('Replay timeline'), { target: { value: String(Date.parse('2026-09-03T14:00:03.000Z')) } })
    expect(container.querySelector('polyline.event-replay-path')?.getAttribute('points')).toBe(before)
    expect(api.fetchEventTrackGeometry).toHaveBeenCalledTimes(1)
    expect(screen.getByText(/OBSERVED TRACK REFERENCE — JARAMA · GPS_CORRECTED · 3 display points/i)).toBeTruthy()
  })

  it('switches coordinate source and keeps map display filtering separate from selection', async () => {
    api.fetchEventStandings.mockRejectedValueOnce(new Error('Standings service unavailable'))
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    expect(await screen.findByText('Observed standings unavailable')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Position source'), { target: { value: 'RGPS_RAW' } })
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ positionSource: 'RGPS_RAW', participantId: undefined, resolutionSeconds: 1, limit: 5000 }), expect.anything()))
    fireEvent.change(screen.getByLabelText('Replay display'), { target: { value: 'selected' } })
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ positionSource: 'RGPS_RAW', participantId: undefined, resolutionSeconds: 1, limit: 5000 }), expect.anything()))
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(screen.getByLabelText('Replay timeline')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Playback speed'), { target: { value: '60' } })
    expect((screen.getByLabelText('Playback speed') as HTMLSelectElement).value).toBe('60')
  })

  it('shows the explicit empty-standings state without removing the replay controls', async () => {
    api.fetchEventStandings.mockResolvedValueOnce([])
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    expect(await screen.findByText('No observed standings are available for this session.')).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Play' })).toBeTruthy()
    expect(screen.getByLabelText('Position source')).toBeTruthy()
  })

  it('keeps the stable Jarama geometry visible when a bounded replay response is empty', async () => {
    api.fetchEventTrackReplay.mockResolvedValue([])
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    expect(await screen.findByRole('img', { name: 'Observed track reconstruction' })).toBeTruthy()
    expect(screen.getByText('No observed position samples are available for this session and source.')).toBeTruthy()
    expect(screen.getByText('No positional samples in this selected window. The Jarama observed track reference remains visible.')).toBeTruthy()
  })

  it('uses UTC for offset-free Event serving timestamps when constructing the initial bounded window', async () => {
    api.fetchEventObservedReplaySummary.mockResolvedValueOnce({
      sessionId, standingSnapshotCount: 5076, standingRowCount: 182736,
      latestStandingObservedAt: '2026-09-03T14:01:01.348000', latestStandingLap: 5,
      latestObservedLeaderParticipantId: 'AKS_1', latestObservedLeaderExternalParticipantNumber: '1', latestFieldSpreadSeconds: 3.5,
      positionSampleCount: 503535, gpsCorrectedSampleCount: 255330, rgpsRawSampleCount: 248205, scSourceSampleCount: 6708,
      positionFirstObservedAt: '2026-09-03T12:43:40.111000', positionLastObservedAt: '2026-09-03T14:01:01.348000',
    })
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T14:00:01.348Z', toTime: '2026-09-03T14:01:01.348Z',
    }), expect.anything()))
  })

  it('uses one window selector, exposes Custom only when selected, and changes replay resolution by duration', async () => {
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await screen.findByLabelText('Replay window')
    fireEvent.change(screen.getByLabelText('Replay window'), { target: { value: '900' } })
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ resolutionSeconds: 10, limit: 5000 }), expect.anything()))
    fireEvent.change(screen.getByLabelText('Replay window'), { target: { value: 'custom' } })
    expect(screen.getByLabelText('Custom replay range seconds')).toBeTruthy()
    expect(fitWindowSpeed(30)).toBe(1)
    expect(fitWindowSpeed(60)).toBe(2)
    expect(fitWindowSpeed(300)).toBe(10)
    expect(fitWindowSpeed(900)).toBe(30)
    fireEvent.click(screen.getByRole('button', { name: 'Fit replay window' }))
    expect((screen.getByLabelText('Playback speed') as HTMLSelectElement).value).toBe('5')
  })

  it('requests distinct bounded ranges and moves windows by the selected duration', async () => {
    render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await screen.findByLabelText('Replay window')
    fireEvent.change(screen.getByLabelText('Replay window'), { target: { value: '30' } })
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T14:00:31.348Z', toTime: '2026-09-03T14:01:01.348Z', resolutionSeconds: 1,
    }), expect.anything()))
    fireEvent.change(screen.getByLabelText('Replay window'), { target: { value: '900' } })
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T13:46:01.348Z', toTime: '2026-09-03T14:01:01.348Z', resolutionSeconds: 10,
    }), expect.anything()))
    const timeline = screen.getByLabelText('Replay timeline') as HTMLInputElement
    expect(timeline.min).toBe(String(Date.parse('2026-09-03T13:46:01.348Z')))
    expect(timeline.max).toBe(String(Date.parse('2026-09-03T14:01:01.348Z')))
    expect(timeline.value).toBe(timeline.min)
    fireEvent.click(screen.getByRole('button', { name: 'Fit replay window' }))
    expect((screen.getByLabelText('Playback speed') as HTMLSelectElement).value).toBe('30')
    fireEvent.click(screen.getByRole('button', { name: 'Previous replay window' }))
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T13:31:01.348Z', toTime: '2026-09-03T13:46:01.348Z', resolutionSeconds: 10,
    }), expect.anything()))
  })

  it('keeps temporal analytics explicitly scoped and renders line-only position and gap series', async () => {
    const { container } = render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await waitFor(() => expect(api.fetchEventStandingsSeries).toHaveBeenCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T12:00:00.000Z', toTime: '2026-09-03T14:01:01.348Z', resolutionSeconds: 30,
    }), expect.anything()))
    expect(screen.getAllByText('P1').length).toBeGreaterThan(0)
    expect(screen.getAllByText('0 s').length).toBeGreaterThan(0)
    const lines = container.querySelectorAll('.event-temporal-chart .series-line polyline')
    expect(lines.length).toBeGreaterThan(0)
    expect([...lines].every((line) => line.getAttribute('fill') === 'none')).toBe(true)
    expect(container.querySelectorAll('.event-temporal-chart .series-hit-target').length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.event-temporal-chart circle:not(.series-hit-target):not(.series-hover-dot)').length).toBe(0)
    expect(container.querySelectorAll('.event-temporal-chart .series-direct-label').length).toBeGreaterThan(0)
    expect([...container.querySelectorAll('.event-temporal-chart svg')].every((chart) => chart.getAttribute('preserveAspectRatio') === 'xMidYMid meet')).toBe(true)
    const gapChart = screen.getByRole('img', { name: /Gap to leader — #1/ }).closest('article')
    expect(gapChart?.querySelectorAll('.series-line').length).toBe(1)
    fireEvent.click(screen.getByRole('button', { name: 'TOP 5' }))
    expect(gapChart?.querySelectorAll('.series-line').length).toBeGreaterThan(1)
    fireEvent.click(screen.getByRole('button', { name: 'SELECTED WINDOW' }))
    await waitFor(() => expect(api.fetchEventStandingsSeries).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T14:00:01.348Z', toTime: '2026-09-03T14:01:01.348Z', resolutionSeconds: 5,
    }), expect.anything()))
  })

  it('uses one explicit participant selection across factual state, charts, and replay controls', async () => {
    const { container } = render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    const selector = await screen.findByLabelText('Temporal analytics participant') as HTMLSelectElement
    expect(selector.options).toHaveLength(36)
    expect(selector.options[0]?.textContent).toBe('#1 · AKS_1')
    expect(selector.options[9]?.textContent).toBe('#10 · AKS_10')

    fireEvent.change(selector, { target: { value: 'AKS_36' } })
    await waitFor(() => expect(screen.getByRole('img', { name: 'Gap to leader — #36' })).toBeTruthy())
    expect((screen.getByLabelText('Temporal analytics participant') as HTMLSelectElement).value).toBe('AKS_36')
    expect(screen.getAllByText('#36 · AKS_36').length).toBeGreaterThan(0)
    expect(container.querySelector('.observed-standings-table tr.leader')?.classList.contains('selected')).toBe(false)
    expect(container.querySelector('.observed-standings-table tr.selected')?.textContent).toContain('AKS_36')
    expect(container.querySelector('.event-participant-list button.selected')?.textContent).toContain('AKS_36')

    fireEvent.change(screen.getByLabelText('Replay window'), { target: { value: '30' } })
    fireEvent.click(screen.getByRole('button', { name: 'SELECTED WINDOW' }))
    expect((screen.getByLabelText('Temporal analytics participant') as HTMLSelectElement).value).toBe('AKS_36')
    expect(container.querySelector('.event-temporal-grid-stacked')).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Position over time' }).closest('.event-temporal-grid-stacked')).toBeTruthy()
  })

  it('selects the same participant from standings state and participant state list', async () => {
    const { container } = render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await screen.findByLabelText('Temporal analytics participant')

    fireEvent.click(screen.getByRole('row', { name: /P36 #36 AKS_36/ }))
    await waitFor(() => expect((screen.getByLabelText('Temporal analytics participant') as HTMLSelectElement).value).toBe('AKS_36'))
    expect(container.querySelector('.observed-standings-table tr.selected')?.textContent).toContain('AKS_36')

    fireEvent.click(screen.getByRole('button', { name: /#21AKS_21P21/ }))
    await waitFor(() => expect((screen.getByLabelText('Temporal analytics participant') as HTMLSelectElement).value).toBe('AKS_21'))
    expect(container.querySelector('.event-participant-list button.selected')?.textContent).toContain('AKS_21')
    expect(screen.getByRole('img', { name: 'Gap to leader — #21' })).toBeTruthy()
  })

  it('keeps full-session series stable while window context and replay playhead change', async () => {
    const { container } = render(<EventReplayPanels sessionId={sessionId} rehearsal />)
    await waitFor(() => expect((screen.getByLabelText('Temporal analytics participant') as HTMLSelectElement).value).toBe('AKS_1'))
    await waitFor(() => expect(api.fetchEventStandingsSeries.mock.calls.length).toBeGreaterThanOrEqual(3))
    const fullRequests = api.fetchEventStandingsSeries.mock.calls.length
    const before = container.querySelector('.event-chart-window-band')?.getAttribute('width')
    fireEvent.change(screen.getByLabelText('Replay window'), { target: { value: '30' } })
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({ resolutionSeconds: 1 }), expect.anything()))
    const playhead = container.querySelector('.event-chart-playhead')?.getAttribute('x1')
    expect(container.querySelectorAll('.event-chart-playhead').length).toBe(2)
    fireEvent.change(screen.getByLabelText('Global session timeline'), { target: { value: String(Date.parse('2026-09-03T14:00:03.000Z')) } })
    await waitFor(() => expect(container.querySelector('.event-chart-playhead')?.getAttribute('x1')).not.toBe(playhead))
    expect(api.fetchEventStandingsSeries).toHaveBeenCalledTimes(fullRequests)
    expect(container.querySelector('.event-chart-window-band')?.getAttribute('width')).not.toBe(before)
    fireEvent.click(screen.getByRole('button', { name: 'SELECTED WINDOW' }))
    await waitFor(() => expect(api.fetchEventStandingsSeries).toHaveBeenLastCalledWith(sessionId, expect.objectContaining({
      fromTime: '2026-09-03T14:00:03.000Z', toTime: '2026-09-03T14:00:33.000Z', resolutionSeconds: 5,
    }), expect.anything()))
    expect(container.querySelectorAll('.event-chart-window-band').length).toBe(0)
    expect(container.querySelectorAll('.event-chart-playhead').length).toBe(2)
  })
})
