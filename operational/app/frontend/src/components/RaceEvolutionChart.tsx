import { useEffect, useMemo, useState, type MouseEvent } from 'react'

import type { CustomSimulationResult } from '../types/raceIntelligence'
import { createRaceEvolution, tacticalEvolutionIds, type EvolutionModel, type EvolutionPoint } from '../utils/raceEvolution'

interface Props {
  scenario: CustomSimulationResult
  currentReplayProgress: number
  selectedDriverId: string | null
  nextTargetId: string | null
  nearbyIds: string[]
  onSelect: (driverId: string | null) => void
}
const WIDTH = 1000; const HEIGHT = 410; const PAD = { left: 56, right: 26, top: 28, bottom: 36 }
const x = (lap: number, laps: number) => PAD.left + lap / Math.max(1, laps) * (WIDTH - PAD.left - PAD.right)
const positionY = (rank: number) => PAD.top + (rank - 1) / 100 * (HEIGHT - PAD.top - PAD.bottom)
function line(points: EvolutionPoint[], laps: number, metric: 'position' | 'gap', gapRange: number) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${x(point.lap, laps).toFixed(2)} ${(metric === 'position' ? positionY(point.rank) : PAD.top + (gapRange - point.gapToVmSeconds) / (gapRange * 2) * (HEIGHT - PAD.top - PAD.bottom)).toFixed(2)}`).join(' ')
}

export function RaceEvolutionChart({ scenario, currentReplayProgress, selectedDriverId, nextTargetId, nearbyIds, onSelect }: Props) {
  const [model, setModel] = useState<EvolutionModel>(scenario.raceModel?.mode ?? 'PURE_TIMING')
  const [metric, setMetric] = useState<'position' | 'gap'>('position')
  const [view, setView] = useState<'tactical' | 'all'>('tactical')
  const [hoverDriver, setHoverDriver] = useState<string | null>(null)
  const data = useMemo(() => createRaceEvolution(scenario, model), [model, scenario])
  if (!data) return null
  const tactical = tacticalEvolutionIds(nextTargetId, selectedDriverId, nearbyIds)
  const activeDriver = hoverDriver ?? selectedDriverId
  const activePoints = activeDriver && activeDriver !== 'VIRTUAL MAX' ? data.trajectories[activeDriver] : data.virtualMax
  const lap = Math.min(data.raceLaps, Math.max(0, Math.floor(currentReplayProgress)))
  const activePoint = activePoints?.[lap]
  const gapRange = Math.max(1, ...Object.values(data.trajectories).flat().map((point) => Math.abs(point.gapToVmSeconds))) * 1.08
  const markerX = x(Math.max(0, Math.min(data.raceLaps, currentReplayProgress)), data.raceLaps)
  const shown = Object.entries(data.trajectories).filter(([driverId]) => view === 'all' || tactical.has(driverId))
  const trafficReady = Boolean(scenario.trafficAdjusted?.rankTrajectory?.length)
  useEffect(() => { setModel(scenario.raceModel?.mode ?? 'PURE_TIMING') }, [scenario.raceModel?.mode, scenario.timing?.projectedFinishTimeSeconds])
  const progression = data.traffic?.rankTrajectory ?? []
  const ticks = metric === 'position' ? [1, 20, 40, 60, 80, 101] : [gapRange, 0, -gapRange]
  const yForTick = (tick: number) => metric === 'position' ? positionY(tick) : PAD.top + (gapRange - tick) / (gapRange * 2) * (HEIGHT - PAD.top - PAD.bottom)
  const hover = (event: MouseEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); const targetLap = Math.round(fraction * data.raceLaps); if (activeDriver) setHoverDriver(activeDriver); return targetLap }
  return <section className="race-evolution panel" aria-labelledby="race-evolution-title">
    <div className="race-evolution-head"><div><p className="eyebrow">Synthetic timing replay</p><h2 id="race-evolution-title">Race evolution</h2></div><span>{model.replace('_', ' ')}</span></div>
    <div className="race-evolution-controls">
      <div><small>RACE MODEL</small><button className={model === 'PURE_TIMING' ? 'active' : ''} onClick={() => setModel('PURE_TIMING')}>PURE TIMING</button><button className={model === 'TRAFFIC_ADJUSTED' ? 'active' : ''} disabled={!trafficReady} title={trafficReady ? undefined : 'Run Traffic Adjusted scenario first'} onClick={() => setModel('TRAFFIC_ADJUSTED')}>TRAFFIC ADJUSTED</button></div>
      <div><small>METRIC</small><button className={metric === 'position' ? 'active' : ''} onClick={() => setMetric('position')}>POSITION</button><button className={metric === 'gap' ? 'active' : ''} onClick={() => setMetric('gap')}>GAP TO VM</button></div>
      <div><small>VIEW</small><button className={view === 'tactical' ? 'active' : ''} onClick={() => setView('tactical')}>TACTICAL</button><button className={view === 'all' ? 'active' : ''} onClick={() => setView('all')}>ALL 100</button></div>
    </div>
    <div className="race-evolution-legend"><span className="vm">VIRTUAL MAX</span><span className="target">NEXT TARGET</span><span className="selected">SELECTED</span><span>SYNTHETIC FIELD</span></div>
    <div className="race-evolution-wrap"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label={`${metric === 'position' ? 'Race position evolution' : 'Gap to Virtual Max evolution'}`} onMouseMove={hover} onMouseLeave={() => setHoverDriver(null)}>
      {ticks.map((tick) => <g key={tick}><line className={metric === 'gap' && tick === 0 ? 'evolution-zero-line' : 'evolution-grid-line'} x1={PAD.left} x2={WIDTH - PAD.right} y1={yForTick(tick)} y2={yForTick(tick)} /><text className="evolution-axis" x="5" y={yForTick(tick) + 3}>{metric === 'position' ? `P${tick}` : `${tick === 0 ? '0 s' : `${tick > 0 ? '+' : ''}${tick.toFixed(0)} s`}`}</text></g>)}
      {shown.map(([driverId, points]) => <path key={driverId} d={line(points, data.raceLaps, metric, gapRange)} className={`evolution-synthetic${selectedDriverId === driverId ? ' is-selected' : ''}${nextTargetId === driverId ? ' is-next-target' : ''}`} tabIndex={0} onClick={() => onSelect(driverId)} onMouseEnter={() => setHoverDriver(driverId)} onFocus={() => setHoverDriver(driverId)}><title>{driverId}</title></path>)}
      <path d={line(data.virtualMax, data.raceLaps, metric, gapRange)} className="evolution-vm" onClick={() => onSelect('VIRTUAL MAX')}><title>VIRTUAL MAX</title></path>
      <line className="evolution-current-marker" data-current-replay-progress={currentReplayProgress.toFixed(2)} x1={markerX} x2={markerX} y1={PAD.top} y2={HEIGHT - PAD.bottom} /><text className="evolution-current-label" x={markerX + 5} y={HEIGHT - PAD.bottom - 6}>REPLAY NOW · LAP {currentReplayProgress.toFixed(2)}</text>
      {metric === 'gap' ? <text className="evolution-threshold-label" x={WIDTH - PAD.right} y={yForTick(0) - 7} textAnchor="end">TIMING CATCH THRESHOLD</text> : null}
    </svg></div>
    <p className="race-evolution-tooltip">{activeDriver ?? 'VIRTUAL MAX'} · LAP {lap} · {metric === 'position' ? `P${activePoint?.rank ?? '—'}` : `${(activePoint?.gapToVmSeconds ?? 0) >= 0 ? '+' : ''}${(activePoint?.gapToVmSeconds ?? 0).toFixed(3)} s`} {activeDriver && activeDriver !== 'VIRTUAL MAX' ? `· ${nextTargetId === activeDriver ? 'NEXT TARGET' : tactical.has(activeDriver) ? 'TACTICAL FIELD' : 'SYNTHETIC FIELD'}` : '· VIRTUAL MAX'}</p>
    <p className="race-evolution-methodology">{metric === 'position' ? 'Reconstructed race position from deterministic cumulative race progress.' : 'Gap is reconstructed from deterministic race state. Zero denotes timing catch, not physical overtake.'} {model === 'TRAFFIC_ADJUSTED' ? 'Traffic-adjusted VM progression includes configured pace phases and sequential clearance-cost assumptions.' : ''}</p>
    {model === 'TRAFFIC_ADJUSTED' ? <div className="field-progression"><h3>Field progression</h3><p>TIMING CAUGHT / CLEARED — authoritative backend trajectory</p><div className="field-progression-rows">{progression.map((point) => <span key={point.lap}>L{point.lap}<b>{point.timingCaughtCount ?? 0}</b><em>{point.clearedCount ?? 0}</em></span>)}</div><small>RED: timing caught · CYAN: cleared · data is not recalculated in the browser.</small></div> : null}
  </section>
}
