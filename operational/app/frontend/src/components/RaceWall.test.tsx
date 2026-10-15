import { StrictMode } from 'react'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { RaceIntelligenceData } from '../types/raceIntelligence'

const api = vi.hoisted(() => ({
  fetchEventSessions: vi.fn(), fetchEventObservedReplaySummary: vi.fn(), fetchEventStandings: vi.fn(), fetchEventStandingsSeries: vi.fn(), fetchEventTrackGeometry: vi.fn(), fetchEventTrackReplay: vi.fn(), fetchTrackTopology: vi.fn(), runSimulation: vi.fn(),
}))
const raceHook = vi.hoisted(() => ({ state: null as { data: RaceIntelligenceData | null; error: string | null; loading: boolean } | null }))

vi.mock('../api/raceIntelligence', () => api)
vi.mock('../hooks/useRaceIntelligence', () => ({ useRaceIntelligence: () => raceHook.state }))

import { RaceWall } from './RaceWall'

const data: RaceIntelligenceData = {
  health: { status: 'ok', databaseConfigured: true, databaseReachable: true },
  summary: { supportedFieldSize: 16, raceLaps: 30, simulations: 5000, deterministicMaxDelaySeconds: 5.85, probabilityAtZeroDelay: .5812, thresholds: { p50: 1.5, p80: -4.5, p90: -7.8 } },
  curve: [{ delaySeconds: -8, catchProbability: .9 }, { delaySeconds: 1.5, catchProbability: .5 }, { delaySeconds: 5.85, catchProbability: .1 }],
  virtualMax: { scenarioDriverId: 'VIRTUAL_MAX', referenceDriverId: 13, referencePaceSeconds: 80.293, assumedAdvantageSecondsPerLap: .195, virtualMaxPaceSeconds: 80.098, scenarioType: 'SYNTHETIC', label: 'WHAT-IF', historicalStatus: 'NOT HISTORICAL' },
  drivers: [{ driverId: 13, pooledValidLaps: 20, pooledMedianPace: 80.293, pooledMad: 1, supportStatus: 'sufficient' }, { driverId: 4, pooledValidLaps: 20, pooledMedianPace: 81.02, pooledMad: 1, supportStatus: 'sufficient' }],
}

beforeEach(() => {
  window.history.replaceState({}, '', '/race-wall')
  raceHook.state = { data, error: null, loading: false }
  api.fetchEventSessions.mockResolvedValue([{ sessionId: 'REHEARSAL_AKS_4040', sessionName: 'Race 1', participantCount: 36, operationalContext: 'REHEARSAL', source: 'AKS' }])
  api.fetchEventObservedReplaySummary.mockResolvedValue({ latestObservedLeaderExternalParticipantNumber: '21', latestStandingLap: 5, latestFieldSpreadSeconds: 56.247, scSourceSampleCount: 1, positionFirstObservedAt: '2026-09-03T12:43:40.111000Z', positionLastObservedAt: '2026-09-03T14:00:44.680000Z' })
  api.fetchEventStandings.mockResolvedValue([{ participantId: 'AKS_21', externalParticipantNumber: '21', position: 1, lapNumber: 5, gapFirstSeconds: 0, status: 'CLASSIFIED' }])
  api.fetchEventStandingsSeries.mockResolvedValue([])
  api.fetchEventTrackGeometry.mockResolvedValue({ pointCount: 2, points: [{ latitude: 40.1, longitude: -3.5 }, { latitude: 40.2, longitude: -3.6 }] })
  api.fetchEventTrackReplay.mockResolvedValue([{ sourceEntityId: '21', participantId: 'AKS_21', externalParticipantNumber: '21', observedAt: '2026-09-03T14:00:44.680000Z', latitude: 40.1, longitude: -3.5, positionSource: 'GPS_CORRECTED', isLeader: true }])
  api.fetchTrackTopology.mockResolvedValue({ mainRoute: { lengthMeters: 2448, geometry: [{ latitude: 40.1, longitude: -3.5, normalizedDistance: 0 }, { latitude: 40.2, longitude: -3.6, normalizedDistance: 1 }] }, alternateRoutes: [], metadata: { direction: 'reverse' } })
  api.runSimulation.mockResolvedValue({ fieldSize: 100, raceLaps: 30, startingDelaySeconds: 1.5, drivers: [{ driverId: 'SYN_001', catchLapExact: 8, catchPossibleWithinRace: true }], syntheticReplay: { entities: Array.from({ length: 100 }, (_, index) => ({ driverId: `SYN_${String(index + 1).padStart(3, '0')}` })) }, timing: { fullFieldCatchLap: 8, fullFieldCatchTimeSeconds: 617.638 }, fullFieldCatchProbability: .0212, virtualMaxPace: 80.098, virtualMaxAdvantageSecondsPerLap: .195, pureTiming: { projectedFinishTimeSeconds: 2404.4 } })
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

describe('RaceWall', () => {
  it('renders Overview with separated evidence domains and a wall-safe presentation control', async () => {
    render(<RaceWall />)
    expect(screen.getByRole('main', { name: /race intelligence wall/i })).toBeTruthy()
    expect(screen.getAllByText('HISTORICAL EVIDENCE ≠ MODELLED SCENARIO ≠ EVENT OBSERVATION').length).toBeGreaterThan(0)
    expect(screen.getByText('HISTORICAL EVIDENCE')).toBeTruthy()
    expect(screen.getByText('MODELLED SCENARIO')).toBeTruthy()
    expect(screen.getByText('FACTUAL EVENT OBSERVATION')).toBeTruthy()
    expect(screen.getByRole('button', { name: /full screen/i })).toBeTruthy()
    expect(await screen.findByText(/36 PARTICIPANTS/i)).toBeTruthy()
  })

  it('changes mode and preserves the selected mode in the route query', async () => {
    const user = userEvent.setup()
    render(<RaceWall />)
    await user.click(screen.getByRole('button', { name: 'HISTORICAL · 16' }))
    expect(screen.getByRole('heading', { name: 'Observed 16' })).toBeTruthy()
    expect(screen.getByText('VIRTUAL MAX · WHAT-IF')).toBeTruthy()
    expect(screen.getByText('MONTE CARLO CATCH PROBABILITY')).toBeTruthy()
    expect(screen.getByText('P(CATCH ALL | 0 s)')).toBeTruthy()
    expect(window.location.search).toContain('mode=historical')
    expect(screen.queryByText('Max Verstappen')).toBeNull()
  })

  it('labels Synthetic 100 as a modelled scenario without factual evidence language', async () => {
    const user = userEvent.setup()
    render(<RaceWall />)
    await user.click(screen.getByRole('button', { name: 'SYNTHETIC · 100' }))
    expect(screen.getByRole('heading', { name: 'Synthetic 100' })).toBeTruthy()
    expect(screen.getAllByText('MODELLED SCENARIO').length).toBeGreaterThan(0)
    expect(screen.getByText(/not historical evidence or GPS telemetry/i)).toBeTruthy()
    await waitFor(() => expect(api.runSimulation).toHaveBeenCalledWith({ fieldMode: 'synthetic_100', raceLaps: 30, virtualMaxAdvantageSecondsPerLap: .195, startingDelaySeconds: 1.5, simulations: 5000 }, expect.any(AbortSignal)))
    await waitFor(() => expect(screen.getByLabelText('Modelled synthetic field on supplied Main track geometry').getAttribute('data-synthetic-entity-count')).toBe('100'))
    expect(document.querySelectorAll('[data-synthetic-entity]')).toHaveLength(100)
    expect(screen.getByText('SCENARIO STATE')).toBeTruthy()
    expect(screen.getByText('NEXT TARGET CONTEXT')).toBeTruthy()
    expect(screen.getByText('PROJECTED FINISH')).toBeTruthy()
    expect(await screen.findByLabelText('Modelled synthetic field on supplied Main track geometry')).toBeTruthy()
  })

  it('does not preserve an aborted Strict Mode request as a visible scenario failure', async () => {
    const user = userEvent.setup()
    let attempts = 0
    api.runSimulation.mockImplementation((_payload: unknown, signal?: AbortSignal) => new Promise((resolve, reject) => {
      attempts += 1
      if (attempts === 1) {
        signal?.addEventListener('abort', () => reject(new Error('request aborted', { cause: new DOMException('Aborted', 'AbortError') })))
        return
      }
      resolve({ fieldSize: 100, startingDelaySeconds: 1.5, drivers: [], syntheticReplay: { entities: Array.from({ length: 100 }, (_, index) => ({ driverId: `SYN_${index}` })) }, virtualMaxPace: 80.098, virtualMaxAdvantageSecondsPerLap: .195, pureTiming: { projectedFinishTimeSeconds: 2404.4 } })
    }))
    render(<StrictMode><RaceWall /></StrictMode>)
    await user.click(screen.getByRole('button', { name: 'SYNTHETIC · 100' }))
    await waitFor(() => expect(screen.getByLabelText('Modelled synthetic field on supplied Main track geometry').getAttribute('data-synthetic-entity-count')).toBe('100'))
    expect(screen.queryByText('SCENARIO TEMPORARILY UNAVAILABLE')).toBeNull()
  })

  it('uses the local modelled cursor for synthetic map, target and catch progression without refetching static inputs', async () => {
    const user = userEvent.setup()
    render(<RaceWall />)
    await user.click(screen.getByRole('button', { name: 'SYNTHETIC · 100' }))
    await screen.findByLabelText('Modelled synthetic field on supplied Main track geometry')
    const marker = document.querySelector('[data-synthetic-entity="SYN_001"]')
    const before = marker?.getAttribute('transform')
    fireEvent.change(screen.getByLabelText('Synthetic replay timeline'), { target: { value: '700' } })
    await waitFor(() => expect(screen.getByText('1 / 100')).toBeTruthy())
    expect(document.querySelector('[data-synthetic-playhead]')).toBeTruthy()
    expect(document.querySelector('[data-synthetic-entity="SYN_001"]')?.getAttribute('transform')).not.toBe(before)
    expect(api.runSimulation).toHaveBeenCalledTimes(1)
    expect(api.fetchTrackTopology).toHaveBeenCalledTimes(1)
  })

  it('uses bounded Event Operations contracts and keeps factual state visible when replay fails', async () => {
    const user = userEvent.setup()
    api.fetchEventTrackReplay.mockRejectedValueOnce(new Error('Replay service unavailable'))
    render(<RaceWall />)
    await user.click(screen.getByRole('button', { name: 'AKS EVENT' }))
    expect(await screen.findByRole('heading', { name: 'JARAMA · RACE 1' })).toBeTruthy()
    expect(screen.getByText('OBSERVED LEADER')).toBeTruthy()
    expect(screen.getAllByText('P1').length).toBeGreaterThan(0)
    expect(screen.getByText('REPLAY TEMPORARILY UNAVAILABLE')).toBeTruthy()
    await waitFor(() => expect(api.fetchEventTrackReplay).toHaveBeenCalledWith('REHEARSAL_AKS_4040', expect.objectContaining({ positionSource: 'GPS_CORRECTED', fromTime: expect.any(String), toTime: expect.any(String), resolutionSeconds: 1, limit: 5000 }), expect.any(AbortSignal)))
  })

  it('renders factual geometry and replay markers independently from the temporal series', async () => {
    const user = userEvent.setup()
    render(<RaceWall />)
    await user.click(screen.getByRole('button', { name: 'AKS EVENT' }))
    await waitFor(() => expect(screen.getByLabelText('Observed Jarama track replay').getAttribute('data-track-geometry-points')).toBe('2'))
    expect(document.querySelectorAll('[data-replay-marker]')).toHaveLength(1)
    expect(screen.getByText('SELECTED PARTICIPANT')).toBeTruthy()
    expect(screen.getAllByText('#21').length).toBeGreaterThan(0)
  })

  it('keeps Event Wall factual consumers on the nearest standings snapshot at or before the replay cursor without refetching', async () => {
    const user = userEvent.setup()
    const first = '2026-09-03T14:00:00.000Z'; const second = '2026-09-03T14:00:30.000Z'
    api.fetchEventStandingsSeries.mockResolvedValue([
      { participantId: 'AKS_21', externalParticipantNumber: '21', observedAt: first, snapshotId: 'first', position: 1, lapNumber: 4, gapFirstSeconds: 0, gapPreviousSeconds: 0, source: 'AKS', operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0' },
      { participantId: 'AKS_40', externalParticipantNumber: '40', observedAt: second, snapshotId: 'second', position: 1, lapNumber: 5, gapFirstSeconds: 0, gapPreviousSeconds: 0, source: 'AKS', operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0' },
      { participantId: 'AKS_21', externalParticipantNumber: '21', observedAt: second, snapshotId: 'second', position: 2, lapNumber: 5, gapFirstSeconds: .4, gapPreviousSeconds: .4, source: 'AKS', operationalContext: 'REHEARSAL', evidenceDomain: 'FACTUAL_OBSERVATION', eventContractVersion: '1.0' },
    ])
    api.fetchEventTrackReplay.mockResolvedValue([
      { sourceEntityId: '21', participantId: 'AKS_21', externalParticipantNumber: '21', observedAt: first, recordedAt: first, latitude: 40.1, longitude: -3.5, positionSource: 'GPS_CORRECTED', isLeader: true },
      { sourceEntityId: '21', participantId: 'AKS_21', externalParticipantNumber: '21', observedAt: second, recordedAt: second, latitude: 40.11, longitude: -3.51, positionSource: 'GPS_CORRECTED', isLeader: false },
    ])
    render(<RaceWall />)
    await user.click(screen.getByRole('button', { name: 'AKS EVENT' }))
    await waitFor(() => expect(document.querySelector('[data-standing-row="AKS_21"]')).toBeTruthy())
    expect(document.querySelector('[data-standing-row="AKS_40"]')).toBeNull()
    fireEvent.change(screen.getByLabelText('Replay timeline'), { target: { value: String(Date.parse(second)) } })
    await waitFor(() => expect(document.querySelector('[data-standing-row="AKS_40"]')).toBeTruthy())
    expect(screen.getAllByText('P2').length).toBeGreaterThan(0)
    expect(screen.getByText('LEADER #21 → #40')).toBeTruthy()
    expect(document.querySelectorAll('[data-chart-playhead="true"]')).toHaveLength(2)
    const trackCalls = api.fetchEventTrackReplay.mock.calls.length
    fireEvent.change(screen.getByLabelText('Event replay window'), { target: { value: '900' } })
    await waitFor(() => expect(api.fetchEventTrackReplay.mock.calls.length).toBeGreaterThan(trackCalls))
    expect(api.fetchEventTrackGeometry).toHaveBeenCalledTimes(1)
  })
})
