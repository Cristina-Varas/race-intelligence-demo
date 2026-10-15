import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { timedTerminalScenario } from '../testFixtures/timedTerminalScenario'
import { catchEvents, gridLabelPlacement, historicalMarker, illustrativeGridMarkers, pointOnTrack, reconstructedTimingOrder, syntheticGridDisplaySlot, syntheticReplayState, syntheticVirtualMaxGridSlot, topologyMainTrack, TrackReplay, virtualRaceDistance } from './TrackReplay'

const baselineSummary = { supportedFieldSize: 16, raceLaps: 30, simulations: 5000, deterministicMaxDelaySeconds: 5.85, probabilityAtZeroDelay: 0.5812, thresholds: { p50: 1.5, p80: -4.5, p90: -7.8 } }
const baselineVirtualMax = { scenarioDriverId: 'VIRTUAL_MAX', referenceDriverId: 13, referencePaceSeconds: 80.293, assumedAdvantageSecondsPerLap: 0.195, virtualMaxPaceSeconds: 80.098, scenarioType: 'SYNTHETIC' as const, label: 'WHAT-IF' as const, historicalStatus: 'NOT HISTORICAL' as const }
const V2_MAIN_LENGTH_METERS = 2448.0699568362184

function topologyFromLegacyFixture(track: { trackLengthMeters: number; closedLoop: boolean; geometry: { normalizedDistance: number; latitude: number; longitude: number }[] }) {
  const anchor = { latitude: track.geometry[0].latitude, longitude: track.geometry[0].longitude, normalizedProgress: 0, cumulativeDistanceMeters: 0, separationMeters: 0 }
  return { trackId: 'test-topology', metadata: { mainRouteLengthMeters: track.trackLengthMeters, direction: 'reverse' as const, directionSource: 'test', startAnchorSource: 'test', sectorGeometryAvailable: false }, mainRoute: { routeId: 'main' as const, routeType: 'MAIN' as const, closedLoop: track.closedLoop, lengthMeters: track.trackLengthMeters, geometry: track.geometry }, alternateRoutes: [], sectors: [], startAnchor: { latitude: anchor.latitude, longitude: anchor.longitude, source: 'test', mainRouteProjection: anchor } }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('TrackReplay', () => {
  it('renders the V2 main, joker, penalty and sector reference geometry while replay markers stay on main', async () => {
    const track = { trackLengthMeters: V2_MAIN_LENGTH_METERS, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', replayDirection: 'reverse' as const, replayStartAnchor: { sourceGeometryIndex: 0, sourceNormalizedDistance: 0, latitude: 52, longitude: -1, sourceCumulativeDistanceMeters: 0, label: 'illustrative_replay_start_anchor' as const }, geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const mainRoute = { routeId: 'main' as const, routeType: 'MAIN' as const, closedLoop: true, lengthMeters: V2_MAIN_LENGTH_METERS, geometry: track.geometry }
    const alternateRoutes = [
      { routeId: 'joker_1' as const, routeType: 'JOKER' as const, closedLoop: false, lengthMeters: 25, geometry: [{ latitude: 52.02, longitude: -1.02 }, { latitude: 52.04, longitude: -1.04 }] },
      { routeId: 'joker_2' as const, routeType: 'JOKER' as const, closedLoop: false, lengthMeters: 25, geometry: [{ latitude: 52.05, longitude: -1.05 }, { latitude: 52.06, longitude: -1.06 }] },
      { routeId: 'penalty_1' as const, routeType: 'PENALTY' as const, closedLoop: false, lengthMeters: 25, geometry: [{ latitude: 52.07, longitude: -1.07 }, { latitude: 52.08, longitude: -1.08 }] },
      { routeId: 'penalty_2' as const, routeType: 'PENALTY' as const, closedLoop: false, lengthMeters: 25, geometry: [{ latitude: 52.09, longitude: -1.09 }, { latitude: 52.095, longitude: -1.095 }] },
    ]
    const anchor = { latitude: 52, longitude: -1, normalizedProgress: 0, cumulativeDistanceMeters: 0, separationMeters: 0 }
    const topology = { trackId: 'topology-v2', metadata: { mainRouteLengthMeters: V2_MAIN_LENGTH_METERS, direction: 'reverse' as const, directionSource: 'existing', startAnchorSource: 'existing', sectorGeometryAvailable: true }, mainRoute, alternateRoutes, sectors: [1, 2, 3].map((sectorNumber) => ({ sectorId: `sector_${sectorNumber}`, sectorNumber, startAnchor: anchor, endAnchor: anchor, mainRouteStartProgress: 0, mainRouteEndProgress: .3, lengthMeters: 750 })), startAnchor: { latitude: 52, longitude: -1, source: 'existing', mainRouteProjection: anchor } }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 1, raceDurationSeconds: 80, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: V2_MAIN_LENGTH_METERS, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.endsWith('/api/track/topology') ? topology : url.endsWith('/api/track') ? track : replay })))
    render(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await screen.findByRole('img')
    const mainReference = document.querySelector('[data-route-id="main"]')
    const mainSurface = document.querySelector('[data-track-surface="main"]')
    expect(mainSurface).toBeTruthy()
    expect(mainSurface?.getAttribute('d')).toBe(mainReference?.getAttribute('d'))
    expect(document.querySelector('[data-route-id="main"]')).toBeTruthy()
    expect(document.querySelectorAll('[data-route-id^="joker_"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-route-id^="penalty_"]')).toHaveLength(2)
    expect(document.querySelectorAll('[data-sector-id]')).toHaveLength(3)
    expect(screen.getByLabelText('Track topology legend').textContent).toContain('MAIN')
    expect(topologyMainTrack(topology).trackLengthMeters).toBeCloseTo(V2_MAIN_LENGTH_METERS)
    expect(document.querySelector('[data-entity-type="historical"]')).toBeTruthy()
    expect(document.querySelector('[data-entity-type="virtual_max"]')).toBeTruthy()
  })

  it('renders observed markers, VM and the non-GPS methodology from compact API data', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }, { raceTimeSeconds: 80, lap: 2, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay })))
    render(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    expect(await screen.findByRole('img')).toBeTruthy()
    expect(screen.getByText('NOT GPS TELEMETRY')).toBeTruthy()
    expect(screen.getAllByText('#13')).toHaveLength(2)
    expect(screen.getByText('SYNTHETIC SCENARIO PROFILE')).toBeTruthy()
    expect(screen.getByText(/Virtual Max is a synthetic scenario profile in this governed baseline replay/i)).toBeTruthy()
    expect(screen.getByText('VM')).toBeTruthy()
    expect(document.querySelector('.vm-marker')).toBeTruthy()
    expect(document.querySelector('.vm-marker')?.getAttribute('data-entity-type')).toBe('virtual_max')
    expect(screen.getByLabelText(/DRIVER #13.*Current timing position.*Timing catch: Not yet/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'PLAY' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'PAUSE' })).toBeTruthy())
  })

  it('renders the 100-driver simulation projection with VM without changing historical replay', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', replayStartAnchor: { sourceGeometryIndex: 0, sourceNormalizedDistance: 0, latitude: 52, longitude: -1, sourceCumulativeDistanceMeters: 0, label: 'illustrative_replay_start_anchor' as const }, geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [] }
    const drivers = Array.from({ length: 100 }, (_, index) => ({ driverId: `SYN_${String(index + 1).padStart(3, '0')}`, lapTimeSeconds: 80 + index / 100, raceDurationSeconds: 160 + index / 50 }))
    const scenario = { fieldMode: 'synthetic_100', raceLaps: 2, virtualMaxPace: 79.8, virtualMaxAdvantageSecondsPerLap: .195, startingDelaySeconds: 1.5, syntheticReplay: { method: 'constant_pace_lap_interpolation', seed: 42, raceLaps: 2, drivers, caveat: 'No telemetry.' } } as never
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay })))
    render(<TrackReplay fieldMode="synthetic_100" customScenario={null} syntheticScenario={scenario} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    expect(await screen.findByRole('img')).toBeTruthy()
    expect(screen.getByText(/simulated field — not historical telemetry/i)).toBeTruthy()
    expect(document.querySelectorAll('[data-entity-type="synthetic"]')).toHaveLength(100)
    expect(document.querySelector('.vm-marker')).toBeTruthy()
    expect(document.querySelectorAll('.synthetic-order ol li')).toHaveLength(101)
    expect(document.querySelector('.synthetic-order .vm-table-row')?.textContent).toContain('VIRTUAL MAX')
    expect(screen.queryByText('#13')).toBeNull()
    expect(screen.getAllByText('WAITING TO START').length).toBeGreaterThan(0)
    expect(screen.queryByText('CLEAR TRACK')).toBeNull()
    fireEvent.change(screen.getByLabelText('Synthetic replay timeline'), { target: { value: '40' } })
    fireEvent.mouseEnter(Array.from(document.querySelectorAll('.synthetic-order li')).find((row) => row.textContent?.includes('SYN_001'))!)
    expect(document.querySelector('[data-synthetic-driver="SYN_001"]')?.getAttribute('class')).toContain('is-selected')
  })

  it('uses reconstructed timing before expiry and backend terminalState ordering at TIMED_RACE completion', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', replayStartAnchor: { sourceGeometryIndex: 0, sourceNormalizedDistance: 0, latitude: 52, longitude: -1, sourceCumulativeDistanceMeters: 0, label: 'illustrative_replay_start_anchor' as const }, geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: [], supportedDriverCount: 0, raceLaps: 1, raceDurationSeconds: 80, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'fixture', sourceSession: 'R1' }, drivers: [] }
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay })))
    render(<TrackReplay fieldMode="synthetic_100" customScenario={null} syntheticScenario={timedTerminalScenario()} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await screen.findByRole('img', { name: 'Synthetic 100 simulated positions on supplied circuit geometry' })
    const timeline = screen.getByLabelText('Synthetic replay timeline') as HTMLInputElement
    const order = screen.getByLabelText('Synthetic race order')
    fireEvent.change(timeline, { target: { value: '3600' } })
    await waitFor(() => expect(within(order).getAllByRole('listitem')[0].textContent).toContain('VIRTUAL MAX'))
    // The fixture's live progress has VM ahead here. At the terminal boundary,
    // authoritative backend classification must replace that local reconstruction.
    fireEvent.change(timeline, { target: { value: timeline.max } })
    await waitFor(() => {
      const rows = within(order).getAllByRole('listitem')
      expect(rows[0].textContent).toContain('SYN_A')
      expect(rows[1].textContent).toContain('VIRTUAL MAX')
    })
  })

  it('keeps the Synthetic 100 grid on the reverse main route and derives deterministic live ranking state', () => {
    const drivers = Array.from({ length: 100 }, (_, index) => ({ driverId: `SYN_${String(index + 1).padStart(3, '0')}`, entityType: 'synthetic' as const, gridPosition: index + 1, paceSecondsPerLap: 80 + index / 100, lapTimeSeconds: 80 + index / 100, raceDurationSeconds: 2400, gridOffsetMeters: 5 + index * 5, initialRaceDistanceMeters: -(5 + index * 5), routeId: 'main' as const, replayDirection: 'reverse' as const, timingCatchTimeSeconds: null }))
    const replay = { method: 'constant_pace_lap_interpolation' as const, seed: 42, populationId: 'bootstrap_bounded_v1:seed=42', scenarioId: 'test', raceLaps: 30, fieldSize: 100, grid: { kind: 'ILLUSTRATIVE_SYNTHETIC_STARTING_GRID' as const, ordering: 'nominal_pace_ascending' as const, frontOffsetMeters: 5, spacingMeters: 5, lastOffsetMeters: 500, totalLengthMeters: 495 }, entities: drivers, drivers, caveat: 'Synthetic only.' }
    const atStart = syntheticReplayState(replay, 0, V2_MAIN_LENGTH_METERS, 0, 80.098)
    const repeated = syntheticReplayState(replay, 0, V2_MAIN_LENGTH_METERS, 0, 80.098)
    const midRace = syntheticReplayState(replay, 1_000, V2_MAIN_LENGTH_METERS, 12, 80.098)
    const afterFinish = syntheticReplayState(replay, 100_000, V2_MAIN_LENGTH_METERS, 30, 80.098)
    expect(atStart).toHaveLength(100)
    expect(atStart.map((driver) => driver.raceDistance)).toEqual(repeated.map((driver) => driver.raceDistance))
    expect(new Set(atStart.map((driver) => driver.trackProgress)).size).toBe(100)
    expect(atStart.every((driver) => driver.routeId === 'main')).toBe(true)
    expect(atStart[0].raceDistance).toBeGreaterThan(atStart[99].raceDistance)
    expect(midRace.every((driver) => Number.isFinite(driver.gapToVirtualMaxMeters))).toBe(true)
    expect(afterFinish.every((driver) => driver.finished && driver.drivingDistance === 30)).toBe(true)
  })

  it('uses a display-only four-abreast synthetic formation with VM centered behind it', () => {
    const firstRow = [1, 2, 3, 4].map((position) => syntheticGridDisplaySlot(position))
    const secondRow = [5, 6, 7, 8].map((position) => syntheticGridDisplaySlot(position))
    const vm = syntheticVirtualMaxGridSlot()
    expect(firstRow.map((slot) => slot.row)).toEqual([0, 0, 0, 0])
    expect(firstRow.map((slot) => slot.lateralDisplayPixels)).toEqual([-10.5, -3.5, 3.5, 10.5])
    expect(secondRow.every((slot) => slot.longitudinalOffsetMeters > firstRow[0].longitudinalOffsetMeters)).toBe(true)
    expect(vm.row).toBe(25)
    expect(vm.lateralDisplayPixels).toBe(0)
    expect(vm.longitudinalOffsetMeters).toBeGreaterThan(syntheticGridDisplaySlot(100).longitudinalOffsetMeters)
  })

  it('retries a transient Track Replay load failure without requiring a page refresh', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('Request to http://127.0.0.1:8003/api/track failed.'))
      .mockRejectedValueOnce(new Error('Request to http://127.0.0.1:8003/api/replay/historical failed.'))
      .mockImplementation((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay }))
    vi.stubGlobal('fetch', fetchMock)
    render(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    expect(await screen.findByText(/track replay unavailable/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /retry track replay/i }))
    expect(await screen.findByRole('img')).toBeTruthy()
  })

  it('updates locally for timeline, speed, follow, and an active Custom scenario without a frame API call', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }, { raceTimeSeconds: 80, lap: 2, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    const fetchMock = vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay }))
    vi.stubGlobal('fetch', fetchMock)
    const view = render(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await screen.findByRole('img')
    const vmStartTransform = document.querySelector('.vm-marker')?.getAttribute('transform')
    fireEvent.change(screen.getByLabelText('Replay timeline'), { target: { value: '40' } })
    expect(screen.getByText(/40.0 s/)).toBeTruthy()
    expect(document.querySelector('.vm-marker')?.getAttribute('transform')).not.toBe(vmStartTransform)
    fireEvent.click(screen.getByRole('button', { name: '2x' }))
    expect(screen.getByRole('button', { name: '2x' }).className).toContain('active')
    fireEvent.click(screen.getByRole('button', { name: 'VIRTUAL MAX' }))
    expect(screen.getByRole('button', { name: 'VIRTUAL MAX' }).className).toContain('active')
    const baselineReference = screen.getByText('SYNTHETIC SCENARIO PROFILE').parentElement?.textContent
    view.rerender(<TrackReplay fieldMode="historical" customScenario={{ raceLaps: 2, virtualMaxAdvantageSecondsPerLap: 0.4, virtualMaxPace: 40, startingDelaySeconds: 0 } as never} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await waitFor(() => expect(screen.getAllByText('CUSTOM WHAT-IF').some((node) => node.parentElement?.textContent !== baselineReference)).toBe(true))
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(screen.queryByText(/^OVERTAKE$/)).toBeNull()
  })

  it('uses only a successful Custom result for replay state and caps the timeline at observed historical evidence', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }, { raceTimeSeconds: 80, lap: 2, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay })))
    const view = render(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await screen.findByRole('img')
    expect(screen.getByText(/ACTIVE REPLAY/i).parentElement?.textContent).toContain('BASELINE')
    expect(screen.getByLabelText('Replay timeline')).toHaveProperty('max', '160')
    const historicalStart = historicalMarker(replay.drivers[0], 0, 2)
    view.rerender(<TrackReplay fieldMode="historical" customScenario={{ raceLaps: 1, virtualMaxAdvantageSecondsPerLap: .35, virtualMaxPace: 79.5, startingDelaySeconds: 6 } as never} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    expect(screen.getByText(/ACTIVE REPLAY/i).parentElement?.textContent).toContain('CUSTOM WHAT-IF')
    expect(screen.getByText(/1 LAPS · \+0.350 S\/LAP · \+6.00 S START DELAY/)).toBeTruthy()
    expect(screen.getByLabelText('Replay timeline')).toHaveProperty('max', '80')
    expect(virtualRaceDistance(0, { label: 'CUSTOM WHAT-IF', requestedLaps: 1, advantage: .35, virtualMaxPace: 79.5, startingDelaySeconds: 6, custom: true }, 1)).toBe(0)
    expect(historicalMarker(replay.drivers[0], 0, 2)).toEqual(historicalStart)
    view.rerender(<TrackReplay fieldMode="historical" customScenario={{ raceLaps: 3, virtualMaxAdvantageSecondsPerLap: .1, virtualMaxPace: 80.2, startingDelaySeconds: -4 } as never} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    expect(screen.getByText(/3 LAPS · \+0.100 S\/LAP · -4.00 S START DELAY/)).toBeTruthy()
    expect(screen.getByText(/limited to 2 historically observed laps/i)).toBeTruthy()
    expect(virtualRaceDistance(0, { label: 'CUSTOM WHAT-IF', requestedLaps: 3, advantage: .1, virtualMaxPace: 80.2, startingDelaySeconds: -4, custom: true }, 2)).toBeGreaterThan(0)
    view.rerender(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    expect(screen.getByText(/ACTIVE REPLAY/i).parentElement?.textContent).toContain('BASELINE')
  })

  it('uses active frontend scenario inputs immediately rather than retaining a baseline replay delay', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'fixture', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }, { raceTimeSeconds: 80, lap: 2, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay })))
    render(<TrackReplay fieldMode="historical" activeScenario={{ label: 'CUSTOM WHAT-IF', requestedLaps: 2, advantage: .195, virtualMaxPace: 80.098, startingDelaySeconds: 1.5, custom: true }} customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await screen.findByRole('img')
    expect(screen.getByText(/ACTIVE REPLAY/i).parentElement?.textContent).toContain('CUSTOM WHAT-IF')
    expect(screen.getByText(/2 LAPS · \+0\.195 S\/LAP · \+1\.50 S START DELAY/)).toBeTruthy()
    expect(virtualRaceDistance(1.49, { label: 'CUSTOM WHAT-IF', requestedLaps: 2, advantage: .195, virtualMaxPace: 80.098, startingDelaySeconds: 1.5, custom: true }, 2)).toBe(0)
  })

  it('recalculates timing catches when the Virtual Max scenario changes', () => {
    const replay = { metadata: { supportedDriverIds: ['#13'], supportedDriverCount: 1, raceLaps: 2, raceDurationSeconds: 160, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers: [{ driverId: '#13', anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: 80, timingGapSeconds: 0 }, { raceTimeSeconds: 80, lap: 2, lapDurationSeconds: 80, timingGapSeconds: 0 }] }] }
    const slow = catchEvents(replay, { label: 'BASELINE', requestedLaps: 2, advantage: 0, virtualMaxPace: 80, startingDelaySeconds: 0, custom: false }, 2, 160)
    const fast = catchEvents(replay, { label: 'CUSTOM WHAT-IF', requestedLaps: 2, advantage: .35, virtualMaxPace: 70, startingDelaySeconds: 6, custom: true }, 2, 160)
    expect(slow).toHaveLength(0)
    expect(fast).toHaveLength(1)
    expect(fast[0].timeSeconds).toBeGreaterThan(6)
  })

  it('assigns a deterministic, distinct illustrative centerline grid to exactly the observed 16', async () => {
    const track = { trackLengthMeters: 2502.7, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', replayStartAnchor: { sourceGeometryIndex: 0, sourceNormalizedDistance: 0, latitude: 52, longitude: -1, sourceCumulativeDistanceMeters: 0, label: 'illustrative_replay_start_anchor' as const }, geometry: [{ normalizedDistance: 0, latitude: 52, longitude: -1 }, { normalizedDistance: .5, latitude: 52.1, longitude: -1.1 }, { normalizedDistance: 1, latitude: 52, longitude: -1 }] }
    const drivers = Array.from({ length: 16 }, (_, index) => ({ driverId: `#${index + 1}`, anchors: [{ raceTimeSeconds: 0, lap: 1, lapDurationSeconds: index === 0 ? 90 : index === 1 ? 60 : 80, timingGapSeconds: null }] }))
    const replay = { metadata: { supportedDriverIds: drivers.map((driver) => driver.driverId), supportedDriverCount: 16, raceLaps: 1, raceDurationSeconds: 80, reconstructionMethod: 'lap_interpolation' as const, trackLengthMeters: 2502.7, gpsTelemetry: false as const, trackOrigin: 'geometry_source_origin', sourceSession: 'R1' }, drivers }
    const first = illustrativeGridMarkers(replay, track.trackLengthMeters)
    const second = illustrativeGridMarkers(replay, track.trackLengthMeters)
    expect(first.size).toBe(16)
    expect([...first.values()].map((marker) => marker.progress)).toEqual([...second.values()].map((marker) => marker.progress))
    expect(new Set([...first.values()].map((marker) => marker.progress)).size).toBe(16)
    expect([...first.values()].every((marker) => marker.progress >= 0 && marker.progress < 1)).toBe(true)
    expect(first.has('VM')).toBe(false)
    vi.stubGlobal('fetch', vi.fn((url: string) => Promise.resolve({ ok: true, json: async () => url.includes('/api/track/topology') ? topologyFromLegacyFixture(track) : replay })))
    render(<TrackReplay fieldMode="historical" customScenario={null} baselineSummary={baselineSummary} baselineVirtualMax={baselineVirtualMax} />)
    await screen.findByRole('img')
    expect(screen.getByText('REPLAY START')).toBeTruthy()
    expect(screen.getByText(/illustrative starting grid/i)).toBeTruthy()
    expect(document.querySelectorAll('[data-grid-position]').length).toBe(16)
    expect(document.querySelector('.vm-marker')).toBeTruthy()
    expect(document.querySelector('[data-grid-position="1"] text')?.getAttribute('aria-hidden')).toBeNull()
    expect(document.querySelector('[data-grid-position="1"]')?.getAttribute('tabindex')).toBe('0')
    expect(screen.getByText('SYNTHETIC SCENARIO PROFILE')).toBeTruthy()
    expect(screen.getByRole('heading', { name: 'Illustrative replay grid' })).toBeTruthy()
    expect(document.querySelectorAll('.illustrative-grid-list li')).toHaveLength(17)
    expect(document.querySelector('.illustrative-grid-list li:last-child')?.textContent).toContain('VIRTUAL MAX')
    expect(document.querySelector('.illustrative-grid-list li:last-child')?.textContent).toContain('SYNTHETIC')
    expect(document.querySelectorAll('svg [data-grid-position] text')).toHaveLength(16)
    expect(new Set(Array.from({ length: 16 }, (_, index) => JSON.stringify(gridLabelPlacement(index + 1, true)))).size).toBe(16)
    fireEvent.mouseEnter(document.querySelector('.illustrative-grid-list li')!)
    expect(document.querySelector('[data-grid-position="1"]')?.getAttribute('class')).toContain('is-followed')
    fireEvent.focus(document.querySelector('.illustrative-grid-list li')!)
    expect(document.querySelector('[data-grid-position="1"]')?.getAttribute('class')).toContain('is-followed')
    fireEvent.change(screen.getByLabelText('Replay timeline'), { target: { value: '4' } })
    expect(screen.getByRole('heading', { name: 'Reconstructed timing order' })).toBeTruthy()
    expect(document.querySelectorAll('.timing-order ol li')).toHaveLength(17)
    expect(Array.from(document.querySelectorAll('.timing-order ol li')).some((row) => row.textContent?.includes('VIRTUAL MAX'))).toBe(true)
    fireEvent.mouseEnter(document.querySelector('.vm-table-row')!)
    expect(document.querySelector('.vm-marker')?.getAttribute('class')).toContain('is-followed')
  })

  it('orders the launch by grid then reconstructs timing order from race progression', () => {
    const grid = new Map([['#1', { gridPosition: 2, startOffsetMeters: 6.5, progress: .99 }], ['#2', { gridPosition: 1, startOffsetMeters: 4, progress: .995 }]])
    const markers = [{ driverId: '#1', progress: .2, raceDistance: 1.2, lap: 2, timingGapSeconds: 1.4 }, { driverId: '#2', progress: .3, raceDistance: 1.3, lap: 2, timingGapSeconds: 0 }]
    expect(reconstructedTimingOrder(markers, grid, 1.1, 80, 0, 160, []).map((row) => row.driverId)).toEqual(['#2', '#1'])
    const reconstructed = reconstructedTimingOrder(markers, grid, 1.1, 80, 4, 160, [])
    expect(reconstructed.map((row) => row.driverId)).toEqual(['#2', '#1'])
    expect(reconstructed[0].gapToLeaderSeconds).toBe(0)
    expect(reconstructed[0].gapToVirtualMaxSeconds).toBeCloseTo(16)
    expect(reconstructedTimingOrder(markers, grid, 1.1, 80, 4, 160, [{ driverId: '#1', timeSeconds: 3, lap: 1, progress: .1 }])[1].status).toBe('TIMING CATCH')
    const vm = { driverId: 'VM', progress: .25, raceDistance: 1.25, lap: 2, timingGapSeconds: null, synthetic: true }
    const withVm = reconstructedTimingOrder(markers, grid, 1.25, 80, 4, 160, [], vm)
    expect(withVm.map((row) => row.driverId)).toEqual(['#2', 'VIRTUAL MAX', '#1'])
    expect(withVm[1].gridPosition).toBeNull()
    expect(withVm[1].gapToVirtualMaxSeconds).toBeNull()
  })

  it('interpolates map coordinates by normalized cumulative track distance', () => {
    const track = { trackLengthMeters: 100, closedLoop: true, pointCount: 3, sourcePointCount: 2, startFinishSource: 'geometry_origin', replayStartAnchor: { sourceGeometryIndex: 0, sourceNormalizedDistance: 0, latitude: 0, longitude: 0, sourceCumulativeDistanceMeters: 0, label: 'illustrative_replay_start_anchor' as const }, geometry: [{ normalizedDistance: 0, latitude: 0, longitude: 0 }, { normalizedDistance: .25, latitude: 10, longitude: 0 }, { normalizedDistance: 1, latitude: 10, longitude: 30 }] }
    expect(pointOnTrack(track, .125)).toEqual({ latitude: 5, longitude: 0 })
    expect(pointOnTrack(track, .625)).toEqual({ latitude: 10, longitude: 15 })
  })
})
