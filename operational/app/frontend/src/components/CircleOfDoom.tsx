import type { JokerStrategyResult, TrackTopology } from '../types/raceIntelligence'
import { circleAngle, circleDisplayLanes, circleLabelLayout, jokerRoute, sectorForProgress } from '../utils/circleOfDoom'

export const CIRCLE_AHEAD_LIMIT = 5
export const CIRCLE_BEHIND_LIMIT = 3

export interface CircleNearbyDriver {
  driverId: string
  progress: number
  lap: number
  gapToVirtualMaxMeters: number
  status: 'AHEAD' | 'BEHIND'
  isNextTarget: boolean
}

export interface CircleLiveState {
  vmProgress: number
  vmRank: number
  lap: number
  raceLaps: number
  nextTargetId: string | null
  nextTargetGapMeters: number | null
  selectedDriverId?: string | null
  nearby: CircleNearbyDriver[]
  modelLabel?: string
}

const point = (progress: number, radius: number) => {
  const angle = circleAngle(progress) * Math.PI / 180
  return { x: 210 + radius * Math.cos(angle), y: 210 + radius * Math.sin(angle) }
}

function labelPlacement(progress: number, markerRadius: number, radialOffset: number, tangentOffset: number) {
  // Keep live labels inside the J1/J2/S1/S2/S3 outer annotation band at radius 178.
  const radius = Math.min(174, markerRadius + radialOffset)
  const angle = circleAngle(progress) * Math.PI / 180
  const base = point(progress, radius)
  return { x: base.x - Math.sin(angle) * tangentOffset, y: base.y + Math.cos(angle) * tangentOffset, anchor: Math.cos(angle) >= 0 ? 'start' as const : 'end' as const }
}

export function CircleOfDoom({ topology, live, joker }: { topology: TrackTopology; live: CircleLiveState | null; joker: JokerStrategyResult | null }) {
  const selectedRoute = joker ? jokerRoute(topology, joker.routeId) : null
  const vm = point(live?.vmProgress ?? 0, 145)
  const nearby = circleDisplayLanes(live?.nearby ?? [])
  const labels = circleLabelLayout(nearby.map((driver) => ({ ...driver, isSelected: driver.driverId === live?.selectedDriverId })), live?.vmProgress ?? 0)
  const sectors = topology.sectors ?? []
  const routes = topology.alternateRoutes ?? []
  const vmAnchor = Math.cos(circleAngle(live?.vmProgress ?? 0) * Math.PI / 180) >= 0 ? 'start' : 'end'

  return <section className="circle-doom panel">
    <div className="circle-head"><div><p className="eyebrow">Circular timing view</p><h2>Circle of Doom</h2></div><span>{live?.modelLabel ?? 'LIVE + WHAT-IF'}</span></div>
    <div className="circle-layout">
      <svg viewBox="0 0 440 440" role="img" aria-label="Circular reconstructed timing view">
        <circle className="circle-main" cx="210" cy="210" r="145" />
        {sectors.map((sector) => { const p = point(sector.mainRouteStartProgress, 170); return <g key={sector.sectorId}><line className="circle-sector" x1="210" y1="210" x2={p.x} y2={p.y} /><text className="circle-annotation-label" x={p.x} y={p.y}>{sector.sectorId.replace('sector_', 'S')}</text></g> })}
        {routes.filter((route) => route.routeType === 'JOKER').map((route) => { const p = point(route.entryAnchor!.normalizedProgress, 178); return <g key={route.routeId} className={`circle-joker${selectedRoute?.routeId === route.routeId ? ' is-selected' : ''}`}><circle cx={p.x} cy={p.y} r="8" /><text className="circle-annotation-label" x={p.x + 11} y={p.y}>{route.routeId === 'joker_1' ? 'J1' : 'J2'}</text></g> })}
        {nearby.map((driver) => { const p = point(driver.progress, 145 + driver.lane); const telemetry = `${driver.driverId} · Lap ${driver.lap} · Reconstructed gap to VM: ${driver.gapToVirtualMaxMeters.toFixed(1)} m · ${driver.status}. Synthetic scenario entity — not historical telemetry.`; return <g key={driver.driverId} tabIndex={0} aria-label={telemetry} className={`circle-driver ${driver.status.toLowerCase()}${driver.isNextTarget ? ' is-next-target' : ''}${driver.driverId === live?.selectedDriverId ? ' is-selected' : ''}`} transform={`translate(${p.x} ${p.y})`}><circle r={driver.isNextTarget || driver.driverId === live?.selectedDriverId ? 7 : 4} /><title>{telemetry}</title></g> })}
        {labels.filter((driver) => driver.showLabel).map((driver) => { const markerRadius = 145 + driver.lane; const label = labelPlacement(driver.progress, markerRadius, driver.labelRadialOffset, driver.labelTangentOffset); return <text key={`${driver.driverId}-label`} className={`circle-driver-label${driver.isNextTarget ? ' is-next-target' : ''}${driver.isSelected ? ' is-selected' : ''}`} x={label.x} y={label.y} textAnchor={label.anchor}>{driver.isNextTarget ? `NEXT · ${driver.driverId}` : driver.driverId}</text> })}
        <text className="circle-start circle-annotation-label" x="210" y="50">START</text>
        {live ? <g className="circle-vm" transform={`translate(${vm.x} ${vm.y})`}><circle r="10" /><text className="circle-vm-label" x={vmAnchor === 'start' ? 15 : -15} y="-8" textAnchor={vmAnchor}>VIRTUAL MAX<tspan x={vmAnchor === 'start' ? 15 : -15} dy="11">VM · P{live.vmRank} / 101</tspan></text></g> : null}
        {selectedRoute ? (() => { const p = point(selectedRoute.exitAnchor!.normalizedProgress, 178); return <g className="circle-rejoin" transform={`translate(${p.x} ${p.y})`}><circle r="11" /><text className="circle-annotation-label" x="14" y="4">{joker!.routeId === 'joker_1' ? "J1'" : "J2'"}</text><title>Projected rejoin point for the selected Joker WHAT-IF.</title></g> })() : null}
      </svg>
      <aside><p className="eyebrow">Live</p><strong>VIRTUAL MAX</strong><b>{live ? `P${live.vmRank} / 101` : 'AWAITING REPLAY'}</b><span>{live ? `LAP ${live.lap} / ${live.raceLaps} · ${sectorForProgress(topology, live.vmProgress).replace('sector_', 'S').toUpperCase()}` : 'Synthetic replay state required'}</span><small>NEXT TARGET {live?.nextTargetId ?? '—'} {live?.nextTargetGapMeters === null || live?.nextTargetGapMeters === undefined ? '' : `· +${live.nextTargetGapMeters.toFixed(1)} m`}</small>{joker ? <div className="circle-whatif"><p>PROJECTED {joker.routeId.toUpperCase()} WHAT-IF</p><b>REJOIN P{joker.projectedRejoin.rank}</b><span>Δ {joker.timingDeltaSeconds >= 0 ? '+' : ''}{joker.timingDeltaSeconds.toFixed(3)} s</span><small>AHEAD {joker.projectedRejoin.aheadDriverId ?? 'CLEAR'} · BEHIND {joker.projectedRejoin.behindDriverId ?? '—'}</small></div> : <div className="circle-whatif"><p>What-if</p><small>NO JOKER WHAT-IF SELECTED</small></div>}</aside>
    </div>
    <p className="panel-note">{live?.modelLabel ? `${live.modelLabel}. ` : ''}Abstracted lap-progress visualization based on reconstructed timing and Track Topology V2. Not GPS telemetry.</p>
  </section>
}
