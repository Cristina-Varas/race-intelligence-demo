import { Pause, Play, Radio, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { fetchTrackReplay } from '../api/raceIntelligence'
import type { CustomSimulationResult, FieldMode, HistoricalReplay, ReplayAnchor, ScenarioSummary, TrackGeometry, TrackRoute, TrackTopology, VirtualMaxProfile } from '../types/raceIntelligence'
import { InfoTooltip } from './InfoTooltip'
import { DistanceToField } from './DistanceToField'
import { LapChartForecast } from './LapChartForecast'
import { RaceEvolutionChart } from './RaceEvolutionChart'
import { ParticipantRaceCard } from './ParticipantRaceCard'
import { CIRCLE_AHEAD_LIMIT, CIRCLE_BEHIND_LIMIT, type CircleLiveState } from './CircleOfDoom'
import { NextTargets } from './NextTargets'
import { getDistanceToField } from '../utils/distanceToField'
import { rankTimingEntries, syntheticProgressAtTime } from '../utils/lapChartForecast'
import { getNextTargets } from '../utils/nextTargets'

interface Props { fieldMode: FieldMode; activeScenario?: ReplayScenario; customScenario: CustomSimulationResult | null; syntheticScenario?: CustomSimulationResult | null; baselineSummary: ScenarioSummary; baselineVirtualMax: VirtualMaxProfile; onSyntheticLiveState?: (state: CircleLiveState | null) => void }
interface Marker { driverId: string; progress: number; raceDistance: number; lap: number; timingGapSeconds: number | null; routeId?: 'main'; synthetic?: boolean; gridPosition?: number; startOffsetMeters?: number }
export interface ReplayScenario { label: string; requestedLaps: number; advantage: number; virtualMaxPace: number; startingDelaySeconds: number; custom: boolean }
interface CatchEvent { driverId: string; timeSeconds: number; lap: number; progress: number }
type Projector = (longitude: number, latitude: number) => { x: number; y: number }
export interface SyntheticReplayState { driverId: string; entityType: 'synthetic'; gridPosition: number; paceSecondsPerLap: number; routeId: 'main'; raceDistance: number; drivingDistance: number; timingRaceDistance: number; cumulativeRaceProgressMeters: number; trackProgress: number; lap: number; finished: boolean; finishTimeSeconds: number; caughtByVirtualMax: boolean; timingCatchTimeSeconds: number | null; gapToVirtualMaxMeters: number; gapToVirtualMaxSeconds: number }
export interface TimingOrderRow { entityType: 'historical' | 'synthetic' | 'virtual_max'; driverId: string; gridPosition: number | null; lap: number; raceDistance: number; gapToLeaderSeconds: number | null; gapToVirtualMaxSeconds: number | null; status: 'GRID LAUNCH' | 'RUNNING' | 'TIMING CATCH' | 'FINISHED' | 'SYNTHETIC REFERENCE' }

export const ILLUSTRATIVE_GRID_ROW_SPACING_METERS = 11
export const ILLUSTRATIVE_GRID_ROW_STAGGER_METERS = 2.5
export const ILLUSTRATIVE_GRID_FRONT_OFFSET_METERS = 4
export const ILLUSTRATIVE_GRID_TRANSITION_SECONDS = 3
export const SYNTHETIC_GRID_COLUMNS = 4
export const SYNTHETIC_GRID_ROW_SPACING_METERS = 12
export const SYNTHETIC_GRID_FRONT_OFFSET_METERS = 8
export const SYNTHETIC_GRID_LATERAL_DISPLAY_PIXELS = 7
export const SYNTHETIC_VM_BACK_OFFSET_METERS = 14
export const SYNTHETIC_GRID_CONVERGENCE_SECONDS = 4

export function syntheticGridDisplaySlot(gridPosition: number, fieldSize = 100) {
  const index = gridPosition - 1
  const row = Math.floor(index / SYNTHETIC_GRID_COLUMNS)
  const column = index % SYNTHETIC_GRID_COLUMNS
  const lateralMultiplier = column - (SYNTHETIC_GRID_COLUMNS - 1) / 2
  return {
    row,
    column,
    longitudinalOffsetMeters: SYNTHETIC_GRID_FRONT_OFFSET_METERS + row * SYNTHETIC_GRID_ROW_SPACING_METERS,
    lateralDisplayPixels: lateralMultiplier * SYNTHETIC_GRID_LATERAL_DISPLAY_PIXELS,
    isVirtualMax: false as const,
    totalRows: Math.ceil(fieldSize / SYNTHETIC_GRID_COLUMNS),
  }
}

export function syntheticVirtualMaxGridSlot(fieldSize = 100) {
  const totalRows = Math.ceil(fieldSize / SYNTHETIC_GRID_COLUMNS)
  return {
    row: totalRows,
    column: null,
    longitudinalOffsetMeters: SYNTHETIC_GRID_FRONT_OFFSET_METERS + (totalRows - 1) * SYNTHETIC_GRID_ROW_SPACING_METERS + SYNTHETIC_VM_BACK_OFFSET_METERS,
    lateralDisplayPixels: 0,
    isVirtualMax: true as const,
    totalRows,
  }
}

export function gridLabelPlacement(gridPosition: number, launching: boolean): { dx: number; dy: number; anchor: 'end' | 'start' } {
  if (!launching) return { dx: gridPosition % 2 === 0 ? -18 : 8, dy: 4, anchor: gridPosition % 2 === 0 ? 'end' : 'start' }
  const row = Math.floor((gridPosition - 1) / 2)
  const left = gridPosition % 2 === 0
  return { dx: left ? -34 : 34, dy: (row - 3.5) * 15, anchor: left ? 'end' : 'start' }
}

function anchorsThroughLap(anchors: ReplayAnchor[], replayLaps: number) { return anchors.filter((anchor) => anchor.lap <= replayLaps) }

export function historicalMarker(driver: HistoricalReplay['drivers'][number], time: number, replayLaps: number): Marker | null {
  const anchors = anchorsThroughLap(driver.anchors, replayLaps)
  if (!anchors.length) return null
  const finalAnchor = anchors[anchors.length - 1]
  if (time > finalAnchor.raceTimeSeconds + finalAnchor.lapDurationSeconds) return null
  const anchor = [...anchors].reverse().find((item) => item.raceTimeSeconds <= time) ?? anchors[0]
  const elapsed = Math.max(0, Math.min(anchor.lapDurationSeconds, time - anchor.raceTimeSeconds))
  const progress = anchor.lapDurationSeconds ? elapsed / anchor.lapDurationSeconds : 0
  return { driverId: driver.driverId, routeId: 'main', progress, raceDistance: (anchor.lap - 1) + progress, lap: anchor.lap, timingGapSeconds: anchor.timingGapSeconds }
}

export function illustrativeGridMarkers(replay: HistoricalReplay, trackLengthMeters: number): Map<string, Pick<Marker, 'gridPosition' | 'startOffsetMeters' | 'progress'>> {
  return new Map(replay.drivers.map((driver, index) => {
    const startOffsetMeters = ILLUSTRATIVE_GRID_FRONT_OFFSET_METERS + Math.floor(index / 2) * ILLUSTRATIVE_GRID_ROW_SPACING_METERS + (index % 2) * ILLUSTRATIVE_GRID_ROW_STAGGER_METERS
    return [driver.driverId, { gridPosition: index + 1, startOffsetMeters, progress: (1 - startOffsetMeters / trackLengthMeters) % 1 }]
  }))
}

function visualHistoricalMarker(driver: HistoricalReplay['drivers'][number], time: number, replayLaps: number, grid: Map<string, Pick<Marker, 'gridPosition' | 'startOffsetMeters' | 'progress'>>): Marker | null {
  const historical = historicalMarker(driver, time, replayLaps)
  const gridMarker = grid.get(driver.driverId)
  if (!historical || !gridMarker || time >= ILLUSTRATIVE_GRID_TRANSITION_SECONDS) return historical
  const targetProgress = historical.progress < gridMarker.progress ? historical.progress + 1 : historical.progress
  const blend = time / ILLUSTRATIVE_GRID_TRANSITION_SECONDS
  return { ...historical, ...gridMarker, progress: (gridMarker.progress + (targetProgress - gridMarker.progress) * blend) % 1 }
}

export function replayDuration(replay: HistoricalReplay, replayLaps: number) {
  return Math.max(...replay.drivers.flatMap((driver) => anchorsThroughLap(driver.anchors, replayLaps).map((anchor) => anchor.raceTimeSeconds + anchor.lapDurationSeconds)), 0)
}

function createProjector(track: TrackGeometry, extraPoints: { longitude: number; latitude: number }[] = []): Projector {
  const renderPoints = [...track.geometry, ...extraPoints]
  const longitudes = renderPoints.map((point) => point.longitude)
  const latitudes = renderPoints.map((point) => point.latitude)
  const meanLatitude = latitudes.reduce((total, value) => total + value, 0) / latitudes.length * Math.PI / 180
  const xValues = longitudes.map((value) => value * Math.cos(meanLatitude))
  const minX = Math.min(...xValues); const maxX = Math.max(...xValues); const minY = Math.min(...latitudes); const maxY = Math.max(...latitudes)
  const padding = 52
  return (longitude: number, latitude: number) => ({ x: padding + ((longitude * Math.cos(meanLatitude) - minX) / (maxX - minX)) * (1000 - padding * 2), y: padding + ((maxY - latitude) / (maxY - minY)) * (600 - padding * 2) })
}

export function topologyMainTrack(topology: TrackTopology): TrackGeometry {
  return {
    trackLengthMeters: topology.mainRoute.lengthMeters, closedLoop: topology.mainRoute.closedLoop,
    pointCount: topology.mainRoute.geometry.length, replayDirection: topology.metadata.direction,
    sourcePointCount: topology.mainRoute.geometry.length - 1, startFinishSource: topology.metadata.startAnchorSource,
    replayStartAnchor: { sourceGeometryIndex: 0, sourceNormalizedDistance: topology.startAnchor.mainRouteProjection.normalizedProgress, latitude: topology.startAnchor.latitude, longitude: topology.startAnchor.longitude, sourceCumulativeDistanceMeters: topology.startAnchor.mainRouteProjection.cumulativeDistanceMeters, label: 'illustrative_replay_start_anchor' },
    geometry: topology.mainRoute.geometry.map((point) => ({ latitude: point.latitude, longitude: point.longitude, normalizedDistance: point.normalizedDistance ?? 0 })),
  }
}

function routePath(route: Pick<TrackRoute, 'geometry'>, projector: Projector) {
  return route.geometry.map((point, index) => { const p = projector(point.longitude, point.latitude); return `${index ? 'L' : 'M'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}` }).join(' ')
}

function TopologyLayer({ topology, projector }: { topology: TrackTopology; projector: Projector }) {
  return <>
    <path className="track-route-surface track-route-main-surface" data-track-surface="main" d={routePath(topology.mainRoute, projector)} />
    <path className="track-path track-route-main" data-route-id="main" d={routePath(topology.mainRoute, projector)} />
    {topology.alternateRoutes.map((route) => <path key={route.routeId} className={`track-route track-route-${route.routeType.toLowerCase()}`} data-route-id={route.routeId} d={routePath(route, projector)} />)}
    {topology.sectors.map((sector) => { const point = projector(sector.startAnchor.longitude, sector.startAnchor.latitude); return <g key={sector.sectorId} className="track-sector-marker" data-sector-id={sector.sectorId} transform={`translate(${point.x} ${point.y})`}><circle r="7" /><text x="10" y="4">S{sector.sectorNumber}</text></g> })}
  </>
}

function TopologyLegend({ topology }: { topology: TrackTopology }) {
  return <div className="track-topology-legend" aria-label="Track topology legend"><span className="main">MAIN</span><span className="joker">JOKER</span><span className="penalty">PENALTY</span><span className="sector">SECTOR</span></div>
}

export function pointOnTrack(track: TrackGeometry, progress: number) {
  const points = track.geometry
  const normalized = ((progress % 1) + 1) % 1
  const nextIndex = points.findIndex((point) => point.normalizedDistance >= normalized)
  const next = points[nextIndex <= 0 ? 1 : nextIndex]
  const previous = points[nextIndex <= 0 ? 0 : nextIndex - 1]
  const span = next.normalizedDistance - previous.normalizedDistance
  const ratio = span <= 0 ? 0 : (normalized - previous.normalizedDistance) / span
  return { longitude: previous.longitude + (next.longitude - previous.longitude) * ratio, latitude: previous.latitude + (next.latitude - previous.latitude) * ratio }
}

function offsetScreenPointOnTrack(track: TrackGeometry, progress: number, lateralDisplayPixels: number, projector: Projector) {
  const point = pointOnTrack(track, progress)
  const before = pointOnTrack(track, progress - .0005)
  const after = pointOnTrack(track, progress + .0005)
  const screen = projector(point.longitude, point.latitude)
  const start = projector(before.longitude, before.latitude)
  const end = projector(after.longitude, after.latitude)
  const length = Math.hypot(end.x - start.x, end.y - start.y) || 1
  return { x: screen.x - ((end.y - start.y) / length) * lateralDisplayPixels, y: screen.y + ((end.x - start.x) / length) * lateralDisplayPixels }
}

export function virtualRaceDistance(time: number, scenario: ReplayScenario, replayLaps: number) {
  return Math.min(replayLaps, Math.max(0, (time - scenario.startingDelaySeconds) / scenario.virtualMaxPace))
}

/** Deterministic spatial state for the already-generated synthetic population. */
export function syntheticReplayState(
  replay: NonNullable<CustomSimulationResult['syntheticReplay']>, time: number, trackLengthMeters: number,
  virtualMaxDistance: number, virtualMaxPace: number, virtualMaxStartDelaySeconds = 0,
): SyntheticReplayState[] {
  const entities = replay.entities ?? replay.drivers ?? []
  return entities.map((driver, index) => {
    // Fallbacks keep older successful in-memory responses renderable after a hot reload.
    const gridPosition = driver.gridPosition ?? index + 1
    const gridOffsetMeters = driver.gridOffsetMeters ?? 5 + index * 5
    const paceSecondsPerLap = driver.paceSecondsPerLap ?? driver.lapTimeSeconds
    const drivingDistance = syntheticProgressAtTime(driver, time, replay.raceLaps)
    const raceDistance = Math.min(replay.raceLaps, drivingDistance - gridOffsetMeters / trackLengthMeters)
    // Grid offsets are illustrative spatial state, never evidence of an
    // immediate timing catch. Catch state starts only once a delayed VM can
    // actually drive; a negative-delay VM can already have timing progress at
    // race-clock zero under the existing head-start convention.
    const paceGain = paceSecondsPerLap - virtualMaxPace
    // This is the same constant-pace timing condition used by caughtByVirtualMax.
    // It is carried on the authoritative replay entity so presentation consumers
    // do not independently reconstruct catch order.
    const timingCatchTimeSeconds = driver.timingCatchTimeSeconds ?? (paceGain > 0
      ? Math.max(virtualMaxStartDelaySeconds < 0 ? 0 : Number.EPSILON, (virtualMaxStartDelaySeconds * paceSecondsPerLap) / paceGain)
      : virtualMaxStartDelaySeconds < 0 ? 0 : null
    )
    const caughtByVirtualMax = timingCatchTimeSeconds !== null && (virtualMaxStartDelaySeconds < 0 || time > virtualMaxStartDelaySeconds) && time >= timingCatchTimeSeconds
    return {
      driverId: driver.driverId,
      entityType: 'synthetic',
      gridPosition,
      paceSecondsPerLap,
      routeId: 'main', timingRaceDistance: drivingDistance,
      raceDistance,
      drivingDistance,
      cumulativeRaceProgressMeters: raceDistance * trackLengthMeters,
      trackProgress: ((raceDistance % 1) + 1) % 1,
      lap: Math.min(replay.raceLaps, Math.floor(drivingDistance) + 1),
      finished: drivingDistance >= replay.raceLaps, timingCatchTimeSeconds,
      finishTimeSeconds: driver.raceDurationSeconds ?? driver.lapTimes?.reduce((total, lapTime) => total + lapTime, 0) ?? paceSecondsPerLap * replay.raceLaps,
      caughtByVirtualMax,
      gapToVirtualMaxMeters: (raceDistance - virtualMaxDistance) * trackLengthMeters,
      gapToVirtualMaxSeconds: (raceDistance - virtualMaxDistance) * virtualMaxPace,
    }
  })
}

export function catchEvents(replay: HistoricalReplay, scenario: ReplayScenario, replayLaps: number, duration: number): CatchEvent[] {
  const events: CatchEvent[] = []
  for (const driver of replay.drivers) {
    let previousGap: number | null = null
    for (let time = 0; time <= duration; time += 0.25) {
      const historical = historicalMarker(driver, time, replayLaps)
      if (!historical) break
      const gap = virtualRaceDistance(time, scenario, replayLaps) - historical.raceDistance
      if (time > Math.max(0, scenario.startingDelaySeconds) && previousGap !== null && previousGap < 0 && gap >= 0) {
        const fraction = previousGap / (previousGap - gap)
        const catchTime = time - 0.25 + fraction * 0.25
        const caught = historicalMarker(driver, catchTime, replayLaps)
        if (caught) events.push({ driverId: driver.driverId, timeSeconds: catchTime, lap: caught.lap, progress: caught.progress })
        break
      }
      previousGap = gap
    }
  }
  return events.sort((left, right) => left.timeSeconds - right.timeSeconds)
}

export function reconstructedTimingOrder(
  markers: Marker[], grid: Map<string, Pick<Marker, 'gridPosition' | 'startOffsetMeters' | 'progress'>>,
  vmDistance: number,
  vmPace: number,
  time: number,
  duration: number,
  events: CatchEvent[],
  virtualMax?: Marker,
): TimingOrderRow[] {
  const launching = time < ILLUSTRATIVE_GRID_TRANSITION_SECONDS
  const rows: TimingOrderRow[] = markers.map((marker) => {
    const gridPosition = grid.get(marker.driverId)?.gridPosition ?? 0
    const caught = events.some((event) => event.driverId === marker.driverId && time >= event.timeSeconds)
    return {
      entityType: 'historical' as const,
      driverId: marker.driverId,
      gridPosition,
      lap: marker.lap,
      raceDistance: marker.raceDistance,
      gapToLeaderSeconds: marker.timingGapSeconds,
      gapToVirtualMaxSeconds: (marker.raceDistance - vmDistance) * vmPace,
      status: time >= duration ? 'FINISHED' as const : caught ? 'TIMING CATCH' as const : launching ? 'GRID LAUNCH' as const : 'RUNNING' as const,
    }
  })
  if (virtualMax) rows.push({
    entityType: 'virtual_max',
    driverId: 'VIRTUAL MAX',
    gridPosition: null,
    lap: virtualMax.lap,
    raceDistance: virtualMax.raceDistance,
    gapToLeaderSeconds: null,
    gapToVirtualMaxSeconds: null,
    status: 'SYNTHETIC REFERENCE',
  })
  return launching
    ? rows.sort((left, right) => (left.gridPosition ?? Number.MAX_SAFE_INTEGER) - (right.gridPosition ?? Number.MAX_SAFE_INTEGER))
    : rows.sort((left, right) => right.raceDistance - left.raceDistance)
}

function SyntheticSpatialReplay({ track, topology, scenario, onLiveState }: { track: TrackGeometry; topology: TrackTopology; scenario: CustomSimulationResult; onLiveState?: (state: CircleLiveState) => void }) {
  const replay = scenario.syntheticReplay!
  const [time, setTime] = useState(0); const [playing, setPlaying] = useState(false); const [speed, setSpeed] = useState(1)
  const [selected, setSelected] = useState<string | null>(null); const [follow, setFollow] = useState<'field' | 'selected' | 'vm'>('field')
  const frame = useRef<number | null>(null); const last = useRef<number | null>(null)
  const replayEntities = replay.entities ?? replay.drivers ?? []
  const trafficAdjustedActive = scenario.raceModel?.mode === 'TRAFFIC_ADJUSTED'
  const trafficSummary = scenario.trafficAdjusted ?? null
  const duration = Math.max(...replayEntities.map((driver, index) => (driver.raceDurationSeconds ?? driver.lapTimeSeconds * replay.raceLaps) + ((driver.gridOffsetMeters ?? 5 + index * 5) / track.trackLengthMeters) * driver.lapTimeSeconds))
  useEffect(() => { if (!playing) { last.current = null; return }; const tick = (now: number) => { const previous = last.current ?? now; last.current = now; setTime((value) => Math.min(duration, value + ((now - previous) / 1000) * speed * 8)); frame.current = requestAnimationFrame(tick) }; frame.current = requestAnimationFrame(tick); return () => { if (frame.current) cancelAnimationFrame(frame.current) } }, [duration, playing, speed])
  useEffect(() => { if (time >= duration) setPlaying(false) }, [duration, time])
  const topologyPoints = useMemo(() => topology.alternateRoutes.flatMap((route) => route.geometry), [topology])
  const projector = useMemo(() => createProjector(track, topologyPoints), [topologyPoints, track])
  const vmDistance = virtualRaceDistance(time, { label: 'SYNTHETIC 100', requestedLaps: replay.raceLaps, advantage: scenario.virtualMaxAdvantageSecondsPerLap, virtualMaxPace: scenario.virtualMaxPace, startingDelaySeconds: scenario.startingDelaySeconds, custom: true }, replay.raceLaps)
  const field = useMemo(() => syntheticReplayState(replay, time, track.trackLengthMeters, vmDistance, scenario.virtualMaxPace, scenario.startingDelaySeconds), [replay, scenario.startingDelaySeconds, scenario.virtualMaxPace, time, track.trackLengthMeters, vmDistance])
  const order = useMemo(() => {
    if (scenario.terminalState?.raceFormat === 'TIMED_RACE' && time >= duration - .1) {
      return [...scenario.terminalState.entities].sort((left, right) => left.finalRank - right.finalRank).map((terminal) => terminal.entityId === 'VIRTUAL MAX'
        ? { driverId: 'VIRTUAL MAX', raceDistance: vmDistance, trackProgress: vmDistance % 1, lap: terminal.completedLaps, entityType: 'virtual_max' as const }
        : field.find((driver) => driver.driverId === terminal.entityId)!)
    }
    const ranks = rankTimingEntries([...field.map((driver) => ({ driverId: driver.driverId, timingProgress: driver.timingRaceDistance, finishTimeSeconds: driver.finishTimeSeconds, entityType: 'synthetic' as const })), { driverId: 'VIRTUAL MAX', timingProgress: vmDistance, finishTimeSeconds: scenario.startingDelaySeconds + replay.raceLaps * scenario.virtualMaxPace, entityType: 'virtual_max' as const }], replay.raceLaps)
    return ranks.map((rank) => rank.entityType === 'virtual_max' ? { driverId: 'VIRTUAL MAX', raceDistance: vmDistance, trackProgress: vmDistance % 1, lap: Math.min(replay.raceLaps, Math.floor(vmDistance) + 1), entityType: 'virtual_max' as const } : field.find((driver) => driver.driverId === rank.driverId)!)
  }, [duration, field, replay.raceLaps, scenario.terminalState, scenario.virtualMaxPace, scenario.startingDelaySeconds, time, vmDistance])
  const gridBlend = Math.max(0, 1 - time / SYNTHETIC_GRID_CONVERGENCE_SECONDS)
  const targets = useMemo(() => getNextTargets({ entities: field, virtualMaxRaceDistance: vmDistance, replayTime: time }), [field, time, vmDistance])
  const distanceToField = useMemo(() => getDistanceToField(field, vmDistance), [field, vmDistance])
  // Preserve the existing authoritative reconstructed timing order for VM rank.
  const referenceVmRank = order.findIndex((row) => row.entityType === 'virtual_max') + 1
  const atTerminalReplay = time >= duration - .1
  const trafficTerminalRank = trafficSummary?.rankTrajectory.at(-1)?.rank ?? null
  const trafficTerminalActive = trafficAdjustedActive && atTerminalReplay
  // The spatial replay is deliberately a Pure Timing reference. At completion,
  // the Traffic Adjusted backend trajectory owns its final classification.
  const vmRank = trafficTerminalActive && trafficTerminalRank !== null ? trafficTerminalRank : referenceVmRank
  const currentlyAheadCount = Math.max(0, vmRank - 1)
  const caughtCount = targets.caughtCount
  const uncaughtTargetCount = targets.uncaughtTargetCount
  const activeTimingCaughtCount = trafficTerminalActive ? trafficSummary?.timingCatchCount ?? caughtCount : caughtCount
  const activeUncaughtTargetCount = Math.max(0, field.length - activeTimingCaughtCount)
  const nextTarget = targets.nextTarget
  const waitingToStart = scenario.startingDelaySeconds > 0 && time < scenario.startingDelaySeconds
  const replayModelLabel = trafficAdjustedActive ? 'PURE TIMING REFERENCE REPLAY' : 'PURE TIMING ACTIVE REPLAY'
  const activeFinalLabel = trafficTerminalActive ? 'ACTIVE TRAFFIC-ADJUSTED FINAL CLASSIFICATION' : null
  const referenceAheadLabel = trafficAdjustedActive ? 'REFERENCE CURRENTLY AHEAD' : 'CURRENTLY AHEAD'
  useEffect(() => { const ahead = targets.targets.slice(0, CIRCLE_AHEAD_LIMIT).map(driver => ({ driverId: driver.driverId, progress: driver.trackProgress, lap: driver.lap, gapToVirtualMaxMeters: driver.gapToVirtualMaxMeters, status: 'AHEAD' as const, isNextTarget: driver.driverId === nextTarget?.driverId })); const behind = field.filter(driver => !driver.caughtByVirtualMax && driver.raceDistance < vmDistance).sort((a, b) => b.raceDistance - a.raceDistance).slice(0, CIRCLE_BEHIND_LIMIT).map(driver => ({ driverId: driver.driverId, progress: driver.trackProgress, lap: driver.lap, gapToVirtualMaxMeters: driver.gapToVirtualMaxMeters, status: 'BEHIND' as const, isNextTarget: false })); const nearby = [...ahead, ...behind]; const selectedDriver = selected && selected !== 'VIRTUAL MAX' ? field.find(driver => driver.driverId === selected) : null; if (selectedDriver && !nearby.some(driver => driver.driverId === selectedDriver.driverId)) nearby.push({ driverId: selectedDriver.driverId, progress: selectedDriver.trackProgress, lap: selectedDriver.lap, gapToVirtualMaxMeters: selectedDriver.gapToVirtualMaxMeters, status: selectedDriver.raceDistance >= vmDistance ? 'AHEAD' as const : 'BEHIND' as const, isNextTarget: false }); onLiveState?.({ vmProgress: vmDistance % 1, vmRank, lap: Math.min(replay.raceLaps, Math.floor(vmDistance) + 1), raceLaps: replay.raceLaps, nextTargetId: nextTarget?.driverId ?? null, nextTargetGapMeters: nextTarget?.gapToVirtualMaxMeters ?? null, selectedDriverId: selected, nearby, modelLabel: replayModelLabel }) }, [field, nextTarget, onLiveState, replay.raceLaps, replayModelLabel, selected, targets.targets, vmDistance, vmRank])
  const finishedCount = field.filter((driver) => driver.finished).length
  const renderSynthetic = (driver: SyntheticReplayState) => { const slot = syntheticGridDisplaySlot(driver.gridPosition, field.length); const formationProgress = 1 - slot.longitudinalOffsetMeters / track.trackLengthMeters; const formation = offsetScreenPointOnTrack(track, formationProgress, slot.lateralDisplayPixels, projector); const race = offsetScreenPointOnTrack(track, driver.trackProgress, 0, projector); const p = { x: formation.x * gridBlend + race.x * (1 - gridBlend), y: formation.y * gridBlend + race.y * (1 - gridBlend) }; const isSelected = selected === driver.driverId; const rank = order.findIndex((candidate) => candidate.driverId === driver.driverId) + 1; const status = driver.finished ? 'FINISHED' : driver.caughtByVirtualMax ? 'TIMING CATCH' : 'AHEAD'; const telemetry = `${driver.driverId} — Synthetic stress-test driver, not historical evidence. Position P${rank} / 101. Grid P${driver.gridPosition}, row ${slot.row + 1}, slot ${slot.column + 1}. Lap ${driver.lap} / ${replay.raceLaps}. Pace ${driver.paceSecondsPerLap.toFixed(2)} s/lap. Reconstructed gap to VM ${driver.gapToVirtualMaxMeters >= 0 ? '+' : ''}${driver.gapToVirtualMaxMeters.toFixed(1)} m. Status ${status}.`; return <g key={driver.driverId} data-entity-type="synthetic" data-synthetic-driver={driver.driverId} data-route-id={driver.routeId} tabIndex={0} aria-label={telemetry} onMouseEnter={() => setSelected(driver.driverId)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(driver.driverId)} onBlur={() => setSelected(null)} onClick={() => setSelected(driver.driverId)} className={`synthetic-marker${isSelected ? ' is-selected' : ''}`} transform={`translate(${p.x} ${p.y})`}><title>{telemetry}</title><circle r={isSelected ? 5 : 2.5} />{isSelected ? <text x="8" y="4">{driver.driverId}</text> : null}</g> }
  const vmSlot = syntheticVirtualMaxGridSlot(field.length); const vmFormation = offsetScreenPointOnTrack(track, 1 - vmSlot.longitudinalOffsetMeters / track.trackLengthMeters, 0, projector); const vmRace = offsetScreenPointOnTrack(track, vmDistance % 1, 0, projector); const vmScreen = { x: vmFormation.x * gridBlend + vmRace.x * (1 - gridBlend), y: vmFormation.y * gridBlend + vmRace.y * (1 - gridBlend) }
  return <section className="track-replay panel" aria-labelledby="synthetic-replay-title">
    <div className="panel-heading"><div><p className="eyebrow">Synthetic 100</p><h2 id="synthetic-replay-title">Simulated field replay</h2></div><span className="unit-label synthetic-unit">SIMULATED FIELD — NOT HISTORICAL TELEMETRY · {replayModelLabel}</span></div>
    <div className="track-meta"><span>TRACK LENGTH <strong>{(track.trackLengthMeters / 1000).toFixed(3)} KM</strong></span><span>RACE DIRECTION <strong>{(track.replayDirection ?? 'reverse').toUpperCase()}</strong></span><span>100 SEEDED DRIVERS · SEED <strong>{replay.seed}</strong></span><span>METHOD <strong>PACE-LAP INTERPOLATION</strong></span></div><TopologyLegend topology={topology} />
    <div className="synthetic-replay-kpis"><div><span>{activeFinalLabel ?? (trafficAdjustedActive ? 'PURE TIMING REFERENCE RANK' : 'VM CURRENT RANK')}</span><strong>P{vmRank} / 101</strong></div><div><span>{trafficTerminalActive ? 'ACTIVE TIMING CAUGHT' : 'TIMING CAUGHT'}</span><strong>{activeTimingCaughtCount} / 100</strong></div><div><span>{trafficTerminalActive ? 'ACTIVE UNCAUGHT TARGETS' : 'UNCAUGHT TARGETS'}</span><strong>{activeUncaughtTargetCount}</strong></div><div><span>{trafficTerminalActive ? 'ACTIVE CURRENTLY AHEAD' : referenceAheadLabel}</span><strong>{currentlyAheadCount}</strong></div><div><span>NEXT TARGET</span><strong>{waitingToStart ? 'WAITING TO START' : nextTarget ? `${nextTarget.driverId} · +${nextTarget.gapToVirtualMaxMeters.toFixed(0)} M` : uncaughtTargetCount === 0 ? 'ALL TIMING TARGETS CAUGHT' : 'NO ACTIVE POSITIVE GAP'}</strong></div>{trafficTerminalActive && trafficSummary ? <><div><span>CLEARED</span><strong>{trafficSummary.clearedCount ?? 0} / 100</strong></div><div><span>STILL TO CLEAR</span><strong>{trafficSummary.stillToClearCount ?? 0}</strong></div></> : null}</div>
    <p className="track-footnote"><strong>4-ABREAST ILLUSTRATIVE SYNTHETIC STARTING GRID.</strong> 25 rows of four, ordered by nominal pace; 12 m between rows and display-only lateral slots. Virtual Max starts centered behind row 25. The formation converges to the authoritative Main route after {SYNTHETIC_GRID_CONVERGENCE_SECONDS} seconds. Synthetic field generated from observed pace distributions, not historical race evidence.</p>
    <div className="track-replay-layout"><div className="track-canvas"><svg viewBox="0 0 1000 600" role="img" aria-label="Synthetic 100 simulated positions on supplied circuit geometry"><TopologyLayer topology={topology} projector={projector} />{field.map(renderSynthetic)}<g className={`track-marker vm-marker${selected === 'VIRTUAL MAX' || follow === 'vm' ? ' is-followed' : ''}`} data-entity-type="virtual_max" tabIndex={0} aria-label={`Virtual Max — synthetic scenario profile. Lap ${Math.min(replay.raceLaps, Math.floor(vmDistance) + 1)} / ${replay.raceLaps}.`} onMouseEnter={() => setSelected('VIRTUAL MAX')} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected('VIRTUAL MAX')} onBlur={() => setSelected(null)} transform={`translate(${vmScreen.x} ${vmScreen.y})`}><title>Virtual Max · synthetic scenario profile</title><rect className="vm-diamond" x="-6" y="-6" width="12" height="12" transform="rotate(45)" /><text x="13" y="4">VM</text></g></svg></div>
      <aside className="timing-order synthetic-order" aria-label="Synthetic race order"><p className="eyebrow">{replayModelLabel}</p><h3>Reconstructed timing order</h3><p>Simulated field — not historical evidence. Ranking and gaps use cumulative Main-route replay distance; this is not Traffic-Adjusted final classification.</p><div className="timing-order-head synthetic-order-head"><span>POS</span><span>DRIVER</span><span>GRID</span><span>LAP</span><span>GAP LEADER</span><span>GAP VM</span><span>STATUS</span></div><ol>{order.map((row, index) => { const vm = row.entityType === 'virtual_max'; const driver = vm ? null : row as SyntheticReplayState; const status = driver?.finished ? 'FINISHED' : driver?.caughtByVirtualMax ? 'TIMING CATCH' : 'AHEAD'; const leaderGap = (order[0].raceDistance - row.raceDistance) * track.trackLengthMeters; return <li key={row.driverId} tabIndex={0} onMouseEnter={() => setSelected(vm ? 'VIRTUAL MAX' : row.driverId)} onMouseLeave={() => setSelected(null)} onFocus={() => setSelected(vm ? 'VIRTUAL MAX' : row.driverId)} onBlur={() => setSelected(null)} onClick={() => setSelected(vm ? 'VIRTUAL MAX' : row.driverId)} className={`${vm ? 'vm-table-row' : ''}${selected === row.driverId ? ' is-highlighted' : ''}`}><span>P{index + 1}</span><strong>{vm ? 'VIRTUAL MAX' : row.driverId}</strong><span>{vm ? 'BACK' : `P${driver!.gridPosition}`}</span><span>{row.lap}</span><span>{leaderGap < .05 ? 'LEADER' : `+${leaderGap.toFixed(0)} m`}</span><span>{vm ? 'REFERENCE' : `${driver!.gapToVirtualMaxMeters >= 0 ? '+' : ''}${driver!.gapToVirtualMaxMeters.toFixed(0)} m`}</span><em>{vm ? 'SYNTHETIC VM' : status}</em></li> })}</ol></aside></div>
    <NextTargets state={targets} vmRank={referenceVmRank} currentlyAheadCount={Math.max(0, referenceVmRank - 1)} currentlyAheadLabel={referenceAheadLabel} modelLabel={replayModelLabel} replayTime={time} raceLaps={replay.raceLaps} virtualMaxLap={Math.min(replay.raceLaps, Math.floor(vmDistance) + 1)} startingDelaySeconds={scenario.startingDelaySeconds} selectedDriverId={selected} onSelect={setSelected} />
    <DistanceToField state={distanceToField} vmRank={referenceVmRank} caughtCount={caughtCount} uncaughtTargetCount={uncaughtTargetCount} currentlyAheadCount={Math.max(0, referenceVmRank - 1)} currentlyAheadLabel={referenceAheadLabel} modelLabel={replayModelLabel} selectedDriverId={selected} startingDelaySeconds={scenario.startingDelaySeconds} replayTime={time} onSelect={setSelected} />
    <LapChartForecast scenario={scenario} currentReplayProgress={vmDistance} currentVmRank={vmRank} selectedDriverId={selected} nextTargetId={targets.nextTarget?.driverId ?? null} onSelect={setSelected} />
    <RaceEvolutionChart scenario={scenario} currentReplayProgress={vmDistance} selectedDriverId={selected} nextTargetId={targets.nextTarget?.driverId ?? null} nearbyIds={[...targets.targets.slice(0, CIRCLE_AHEAD_LIMIT), ...field.filter((driver) => !driver.caughtByVirtualMax && driver.raceDistance < vmDistance).sort((a, b) => b.raceDistance - a.raceDistance).slice(0, CIRCLE_BEHIND_LIMIT)].map((driver) => driver.driverId)} onSelect={setSelected} />
    <ParticipantRaceCard scenario={scenario} selectedDriverId={selected} onSelect={setSelected} />
    <div className="replay-controls"><button type="button" className="run-scenario-button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}{playing ? 'PAUSE' : 'PLAY'}</button><button type="button" className="reset-button" onClick={() => setTime(0)}><RotateCcw size={14} /> Reset</button><label>RACE TIME <strong>{time.toFixed(1)} s</strong><input aria-label="Synthetic replay timeline" type="range" min="0" max={duration} step="0.1" value={time} onChange={(event) => setTime(Number(event.target.value))} /></label><div className="speed-controls">{[0.5, 1, 2, 4].map((value) => <button type="button" className={speed === value ? 'active' : ''} key={value} onClick={() => setSpeed(value)}>{value}x</button>)}</div><span className="track-follow">FOLLOW <button type="button" className={follow === 'field' ? 'active' : ''} onClick={() => setFollow('field')}>FIELD</button><button type="button" disabled={!selected || selected === 'VIRTUAL MAX'} className={follow === 'selected' ? 'active' : ''} onClick={() => setFollow('selected')}>SELECTED</button><button type="button" className={follow === 'vm' ? 'active' : ''} onClick={() => setFollow('vm')}>VIRTUAL MAX</button></span></div>
  </section>
}

export function TrackReplay({ fieldMode, activeScenario, customScenario, syntheticScenario = null, baselineSummary, baselineVirtualMax, onSyntheticLiveState }: Props) {
  const [data, setData] = useState<{ topology: TrackTopology; replay: HistoricalReplay } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestVersion, setRequestVersion] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [time, setTime] = useState(0)
  const [follow, setFollow] = useState<'field' | 'vm'>('field')
  const [highlightedDriver, setHighlightedDriver] = useState<string | null>(null)
  const frame = useRef<number | null>(null); const last = useRef<number | null>(null); const previousScenarioKey = useRef<string | null>(null)

  useEffect(() => { const controller = new AbortController(); setError(null); fetchTrackReplay(controller.signal).then((result) => { setData(result); setError(null) }).catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : 'Track replay is unavailable.') }); return () => controller.abort() }, [requestVersion])
  const scenario: ReplayScenario = activeScenario ?? (customScenario ? { label: 'CUSTOM WHAT-IF', requestedLaps: customScenario.raceLaps, advantage: customScenario.virtualMaxAdvantageSecondsPerLap, virtualMaxPace: customScenario.virtualMaxPace, startingDelaySeconds: customScenario.startingDelaySeconds, custom: true } : { label: 'GOVERNED BASELINE', requestedLaps: baselineSummary.raceLaps, advantage: baselineVirtualMax.assumedAdvantageSecondsPerLap, virtualMaxPace: baselineVirtualMax.virtualMaxPaceSeconds, startingDelaySeconds: baselineSummary.thresholds.p50 ?? 0, custom: false })
  const historicalLapLimit = data?.replay.metadata.raceLaps ?? 0
  const visibleLaps = Math.min(scenario.requestedLaps, historicalLapLimit)
  const duration = data && visibleLaps ? replayDuration(data.replay, visibleLaps) : 1
  const scenarioKey = `${scenario.requestedLaps}:${scenario.advantage}:${scenario.virtualMaxPace}:${scenario.startingDelaySeconds}:${visibleLaps}`
  useEffect(() => {
    if (previousScenarioKey.current !== null && previousScenarioKey.current !== scenarioKey) { setPlaying(false); setTime(0) }
    previousScenarioKey.current = scenarioKey
  }, [scenarioKey])
  useEffect(() => {
    if (!playing) { last.current = null; return }
    const tick = (now: number) => { const previous = last.current ?? now; last.current = now; setTime((value) => Math.min(duration, value + ((now - previous) / 1000) * speed * 8)); frame.current = requestAnimationFrame(tick) }
    frame.current = requestAnimationFrame(tick); return () => { if (frame.current) cancelAnimationFrame(frame.current) }
  }, [duration, playing, speed])
  useEffect(() => { if (time >= duration) setPlaying(false) }, [duration, time])

  const replayTrack = data ? topologyMainTrack(data.topology) : null
  const grid = useMemo(() => data && replayTrack ? illustrativeGridMarkers(data.replay, replayTrack.trackLengthMeters) : new Map(), [data, replayTrack])
  const markers = useMemo(() => data ? data.replay.drivers.map((driver) => visualHistoricalMarker(driver, time, visibleLaps, grid)).filter((marker): marker is Marker => marker !== null) : [], [data, grid, time, visibleLaps])
  const vmDistance = virtualRaceDistance(time, scenario, visibleLaps)
  const virtualMax: Marker = { driverId: 'VM', routeId: 'main', progress: vmDistance % 1, raceDistance: vmDistance, lap: Math.min(visibleLaps, Math.floor(vmDistance) + 1), timingGapSeconds: null, synthetic: true }
  const events = useMemo(() => data ? catchEvents(data.replay, scenario, visibleLaps, duration) : [], [data, duration, scenarioKey, visibleLaps])
  const activeEvent = events.find((event) => Math.abs(event.timeSeconds - time) < 1)
  const timingOrder = useMemo(() => reconstructedTimingOrder(markers, grid, vmDistance, scenario.virtualMaxPace, time, duration, events, virtualMax), [duration, events, grid, markers, scenario.virtualMaxPace, time, virtualMax, vmDistance])

  if (error) return <section className="track-replay panel"><p className="eyebrow">Track replay unavailable</p><strong>{error}</strong><button type="button" className="reset-button" onClick={() => setRequestVersion((version) => version + 1)}>Retry track replay</button></section>
  if (!data) return <section className="track-replay panel"><p className="eyebrow">Track replay</p><h2>Loading reconstructed timing anchors</h2></section>
  if (fieldMode === 'synthetic_100') return syntheticScenario?.syntheticReplay ? <SyntheticSpatialReplay track={replayTrack!} topology={data.topology} scenario={syntheticScenario} onLiveState={onSyntheticLiveState} /> : <section className="track-replay panel"><p className="eyebrow">Synthetic 100</p><h2>Awaiting simulated field replay</h2><p className="panel-note">Run or load the seeded Synthetic 100 scenario to visualize its deterministic timing projection. It is not historical telemetry.</p></section>
  const topologyPoints = data.topology.alternateRoutes.flatMap((route) => route.geometry)
  const projector = createProjector(replayTrack!, topologyPoints)
  const renderMarker = (marker: Marker) => {
    const coordinate = pointOnTrack(replayTrack!, marker.progress); const p = projector(coordinate.longitude, coordinate.latitude)
    const followed = (follow === 'vm' && marker.synthetic) || (follow === 'field' && !marker.synthetic)
    const selected = highlightedDriver === marker.driverId
    const row = timingOrder.find((candidate) => candidate.driverId === (marker.synthetic ? 'VIRTUAL MAX' : marker.driverId))
    const currentPosition = row ? timingOrder.indexOf(row) + 1 : null
    const caught = events.find((event) => event.driverId === marker.driverId && time >= event.timeSeconds)
    const leaderGap = row?.gapToLeaderSeconds === null || row?.gapToLeaderSeconds === undefined ? 'not available between source anchors' : `${row.gapToLeaderSeconds >= 0 ? '+' : ''}${row.gapToLeaderSeconds.toFixed(2)} s (latest source anchor)`
    const vmGap = row?.gapToVirtualMaxSeconds === null || row?.gapToVirtualMaxSeconds === undefined ? 'reference' : `${row.gapToVirtualMaxSeconds >= 0 ? '+' : ''}${row.gapToVirtualMaxSeconds.toFixed(2)} s`
    const telemetry = marker.synthetic ? `Virtual Max — synthetic scenario profile${scenario.custom ? ' · CUSTOM WHAT-IF' : ''} · Lap ${marker.lap} / ${visibleLaps} · Synthetic lap progress ${(vmDistance % 1).toFixed(3)} · Advantage ${scenario.advantage.toFixed(3)} s/lap · Start delay ${scenario.startingDelaySeconds >= 0 ? '+' : ''}${scenario.startingDelaySeconds.toFixed(2)} s · Comparison order ${currentPosition ?? 'not available'}` : `DRIVER ${marker.driverId} · Grid position ${marker.gridPosition} · Current timing position ${currentPosition ?? 'not available'} · Lap ${marker.lap} / ${visibleLaps} · Gap to leader ${leaderGap} · Gap to Virtual Max ${vmGap} · Timing catch: ${caught ? `Lap ${caught.lap}` : 'Not yet'}`
    const label = gridLabelPlacement(marker.gridPosition ?? 1, time < ILLUSTRATIVE_GRID_TRANSITION_SECONDS)
    return <g key={marker.driverId} tabIndex={0} aria-label={telemetry} data-grid-position={marker.gridPosition} data-replay-route-id={marker.routeId} data-entity-type={marker.synthetic ? 'virtual_max' : 'historical'} onMouseEnter={() => setHighlightedDriver(marker.synthetic ? 'VM' : marker.driverId)} onMouseLeave={() => setHighlightedDriver(null)} onFocus={() => setHighlightedDriver(marker.synthetic ? 'VM' : marker.driverId)} onBlur={() => setHighlightedDriver(null)} className={`${marker.synthetic ? 'track-marker vm-marker' : 'track-marker'}${followed || selected ? ' is-followed' : ''}`} transform={`translate(${p.x} ${p.y})`}><title>{telemetry}</title>{marker.synthetic ? <rect className="vm-diamond" x="-6" y="-6" width="12" height="12" transform="rotate(45)" /> : <circle r={5} />}{!marker.synthetic && time < ILLUSTRATIVE_GRID_TRANSITION_SECONDS ? <line className="track-label-leader" x2={label.dx} y2={label.dy} /> : null}<text x={marker.synthetic ? 13 : label.dx} y={marker.synthetic ? 4 : label.dy} textAnchor={marker.synthetic ? 'start' : label.anchor}>{marker.synthetic ? 'VM' : marker.driverId}</text></g>
  }
  const anchorCoordinate = data.topology.startAnchor; const anchorPoint = projector(anchorCoordinate.longitude, anchorCoordinate.latitude)
  return <section className="track-replay panel" aria-labelledby="track-replay-title">
    <div className="panel-heading"><div><p className="eyebrow">Track replay</p><h2 id="track-replay-title">Reconstructed track position <InfoTooltip label="Reconstructed position">An estimated circuit position derived from timing progression and supplied track geometry. It is not GPS telemetry.</InfoTooltip></h2></div><span className="unit-label">NOT GPS TELEMETRY</span></div>
    <p className="panel-note">Estimated from lap/sector timing and supplied track geometry. Not GPS telemetry.</p>
    <div className="track-meta"><span>ACTIVE REPLAY <strong>{scenario.label}</strong></span><span>{scenario.requestedLaps} LAPS · +{scenario.advantage.toFixed(3)} S/LAP · {scenario.startingDelaySeconds >= 0 ? '+' : ''}{scenario.startingDelaySeconds.toFixed(2)} S START DELAY</span><span>RACE DIRECTION <strong>{(replayTrack!.replayDirection ?? 'reverse').toUpperCase()}</strong></span><span>TIMING RESOLUTION <strong>LAP INTERPOLATION</strong></span><span>REPLAY START ANCHOR <InfoTooltip label="Replay start anchor">Replay start anchor selected for the reconstructed scenario. It is not independently verified as the official start/finish line.</InfoTooltip></span></div><TopologyLegend topology={data.topology} />
    <p className="track-footnote"><strong>ILLUSTRATIVE STARTING GRID.</strong> Initial grid spacing is a replay visualization and is not historical grid evidence.</p>
    <div className="track-replay-layout"><div className="track-canvas"><svg viewBox="0 0 1000 600" role="img" aria-label="Reconstructed positions on supplied circuit geometry"><TopologyLayer topology={data.topology} projector={projector} /><g className="track-start-anchor" aria-label="Illustrative replay start anchor" transform={`translate(${anchorPoint.x} ${anchorPoint.y})`}><line x1="-13" x2="13" y1="0" y2="0" /><text x="16" y="4">REPLAY START</text></g>{markers.filter((marker) => marker.driverId !== highlightedDriver).map(renderMarker)}{highlightedDriver !== 'VM' ? renderMarker(virtualMax) : null}{markers.filter((marker) => marker.driverId === highlightedDriver).map(renderMarker)}{highlightedDriver === 'VM' ? renderMarker(virtualMax) : null}</svg></div>
      <aside className="timing-order" aria-label={time < ILLUSTRATIVE_GRID_TRANSITION_SECONDS ? 'Illustrative replay grid' : 'Reconstructed timing order'}>
        {time < ILLUSTRATIVE_GRID_TRANSITION_SECONDS ? <>
          <p className="eyebrow">Grid launch</p><h3>Illustrative replay grid</h3><p>Illustrative replay grid — not historical grid evidence.</p>
          <div className="timing-order-head illustrative-grid-head"><span>GRID</span><span>DRIVER</span><span>START OFFSET</span></div>
          <ol className="illustrative-grid-list">{timingOrder.map((row) => <li key={row.driverId} tabIndex={0} onMouseEnter={() => setHighlightedDriver(row.entityType === 'virtual_max' ? 'VM' : row.driverId)} onMouseLeave={() => setHighlightedDriver(null)} onFocus={() => setHighlightedDriver(row.entityType === 'virtual_max' ? 'VM' : row.driverId)} onBlur={() => setHighlightedDriver(null)} className={`${row.entityType === 'virtual_max' ? 'vm-table-row' : ''}${highlightedDriver === (row.entityType === 'virtual_max' ? 'VM' : row.driverId) ? ' is-highlighted' : ''}`}><span>{row.gridPosition ?? '—'}</span><strong>{row.driverId}</strong><span>{row.entityType === 'virtual_max' ? `SYNTHETIC · ${scenario.startingDelaySeconds >= 0 ? '+' : ''}${scenario.startingDelaySeconds.toFixed(2)} s` : `−${grid.get(row.driverId)?.startOffsetMeters.toFixed(1)} m`}</span></li>)}</ol>
        </> : <>
          <p className="eyebrow">Timing reconstruction</p><h3>Reconstructed timing order</h3><p>Timing-based replay order. Not physical overtake telemetry. Leader gaps are the latest available source-anchor values; no intra-lap gap is fabricated. GAP VM: + driver ahead, − Virtual Max ahead.</p>
          <div className="timing-order-head"><span>POS</span><span>DRIVER</span><span>GRID</span><span>LAP</span><span>GAP LEADER*</span><span>GAP VM</span><span>STATUS</span></div>
          <ol>{timingOrder.map((row, index) => <li key={row.driverId} tabIndex={0} onMouseEnter={() => setHighlightedDriver(row.entityType === 'virtual_max' ? 'VM' : row.driverId)} onMouseLeave={() => setHighlightedDriver(null)} onFocus={() => setHighlightedDriver(row.entityType === 'virtual_max' ? 'VM' : row.driverId)} onBlur={() => setHighlightedDriver(null)} className={`${row.entityType === 'virtual_max' ? 'vm-table-row' : ''}${highlightedDriver === (row.entityType === 'virtual_max' ? 'VM' : row.driverId) ? ' is-highlighted' : ''}`}><span>{row.entityType === 'virtual_max' ? 'VM' : index + 1}</span><strong>{row.driverId}</strong><span>{row.gridPosition ?? '—'}</span><span>{row.lap}</span><span>{row.gapToLeaderSeconds === null ? '—' : `${row.gapToLeaderSeconds >= 0 ? '+' : ''}${row.gapToLeaderSeconds.toFixed(2)} s`}</span><span>{row.gapToVirtualMaxSeconds === null ? 'REFERENCE' : `${row.gapToVirtualMaxSeconds >= 0 ? '+' : ''}${row.gapToVirtualMaxSeconds.toFixed(2)} s`}</span><em>{row.status}</em></li>)}</ol>
        </>}
        <div className="vm-timing-reference"><span>VM TIMING REFERENCE</span><strong>{scenario.custom ? 'CUSTOM WHAT-IF' : 'SYNTHETIC SCENARIO PROFILE'}</strong><em>{scenario.startingDelaySeconds >= 0 ? '+' : ''}{scenario.startingDelaySeconds.toFixed(2)} s start delay · {scenario.virtualMaxPace.toFixed(3)} s/lap</em></div>
      </aside></div>
    {scenario.requestedLaps > visibleLaps ? <p className="track-footnote">Replay is limited to {visibleLaps} historically observed laps. The numerical scenario may continue beyond this evidence; no historical movement is extrapolated.</p> : null}
    {activeEvent ? <p className="timing-catch"><Radio size={14} /> TIMING CATCH - DRIVER {activeEvent.driverId}. Timing gap reached zero, not a physical overtake.</p> : null}
    <div className="replay-controls"><button type="button" className="run-scenario-button" onClick={() => setPlaying((value) => !value)}>{playing ? <Pause size={15} /> : <Play size={15} fill="currentColor" />}{playing ? 'PAUSE' : 'PLAY'}</button><button type="button" className="reset-button" onClick={() => setTime(0)}><RotateCcw size={14} /> Reset</button><label>RACE TIME <strong>{time.toFixed(1)} s · LAP {Math.min(visibleLaps, Math.floor(vmDistance) + 1)} / {visibleLaps}</strong><input aria-label="Replay timeline" type="range" min="0" max={duration} step="0.1" value={time} onChange={(event) => setTime(Number(event.target.value))} /></label><div className="speed-controls">{[0.5, 1, 2, 4].map((value) => <button type="button" className={speed === value ? 'active' : ''} key={value} onClick={() => setSpeed(value)}>{value}x</button>)}</div><span className="track-follow">FOLLOW <button type="button" className={follow === 'field' ? 'active' : ''} onClick={() => setFollow('field')}>FIELD</button><button type="button" className={follow === 'vm' ? 'active' : ''} onClick={() => setFollow('vm')}>VIRTUAL MAX</button></span></div>
    <p className="track-footnote">Virtual Max is a synthetic scenario profile{scenario.custom ? ' in this CUSTOM WHAT-IF' : ' in this governed baseline replay'}. Advantage {scenario.advantage.toFixed(3)} s/lap. {events.length} timing catches in this replay. Historical source IDs are categorical and are not real-world identities. This replay is reconstructed from timing data, not GPS telemetry.</p>
  </section>
}
