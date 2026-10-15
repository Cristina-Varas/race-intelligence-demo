import { useMemo, useState, type MouseEvent } from 'react'

import type { CustomSimulationResult } from '../types/raceIntelligence'
import { formatRaceTime } from '../utils/raceTiming'
import { createLapChartForecast, type LapRankPoint } from '../utils/lapChartForecast'

interface Props { scenario: CustomSimulationResult; currentReplayProgress: number; currentVmRank: number; selectedDriverId: string | null; nextTargetId: string | null; onSelect: (driverId: string | null) => void }
const WIDTH = 1000; const HEIGHT = 420; const PAD = { left: 54, right: 26, top: 28, bottom: 38 }

export function lapChartX(lap: number, raceLaps: number) { return PAD.left + lap / Math.max(1, raceLaps) * (WIDTH - PAD.left - PAD.right) }
export function lapChartY(rank: number) { return PAD.top + (rank - 1) / 100 * (HEIGHT - PAD.top - PAD.bottom) }
export function lapChartPath(points: LapRankPoint[], raceLaps: number) { return points.map((point, index) => `${index ? 'L' : 'M'} ${lapChartX(point.lap, raceLaps).toFixed(2)} ${lapChartY(point.rank).toFixed(2)}`).join(' ') }

export function LapChartForecast({ scenario, currentReplayProgress, currentVmRank, selectedDriverId, nextTargetId, onSelect }: Props) {
  const forecast = useMemo(() => createLapChartForecast(scenario), [scenario])
  const [hoverLap, setHoverLap] = useState<number | null>(null)
  if (!forecast) return null
  const continuousLap = Math.max(0, Math.min(forecast.raceLaps, currentReplayProgress))
  const boundaryLap = Math.floor(continuousLap)
  const activeLap = hoverLap ?? boundaryLap
  const vmPoint = forecast.virtualMax[activeLap]
  const selected = selectedDriverId && selectedDriverId !== 'VIRTUAL MAX' ? forecast.trajectories[selectedDriverId] : null
  const selectedPoint = selected?.[activeLap]
  const selectedDriver = selectedDriverId && selectedDriverId !== 'VIRTUAL MAX' ? scenario.syntheticReplay?.entities.find((driver) => driver.driverId === selectedDriverId) : null
  const x = lapChartX(continuousLap, forecast.raceLaps)
  const catchLap = scenario.timing?.fullFieldCaught ? scenario.timing.fullFieldCatchLap : null
  const catchTime = scenario.timing?.fullFieldCatchTimeSeconds ?? null
  const trafficTrajectory = scenario.trafficAdjusted?.rankTrajectory.map((point) => ({ lap: point.lap, rank: point.rank, timingProgress: point.lap })) ?? []
  const trafficAdjustedActive = scenario.raceModel?.mode === 'TRAFFIC_ADJUSTED' && trafficTrajectory.length > 0
  const modelOwnership = trafficAdjustedActive ? 'ACTIVE: TRAFFIC ADJUSTED · RED: PURE TIMING REFERENCE' : 'ACTIVE: PURE TIMING'
  const chartPointer = (event: MouseEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); const fraction = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)); setHoverLap(Math.round(fraction * forecast.raceLaps)) }
  return <section className="lap-chart-forecast panel" aria-labelledby="lap-chart-title">
    <div className="lap-chart-head"><div><p className="eyebrow">Synthetic timing replay</p><h2 id="lap-chart-title">Lap chart forecast</h2></div><span>{modelOwnership} · {scenario.fieldVariability?.mode === 'HISTORICAL_SEEDED' ? 'SEEDED HISTORICAL VARIABILITY SCENARIO' : `DETERMINISTIC FORECAST · ${forecast.populationId}`}</span></div>
    <div className="lap-chart-kpis"><span>REPLAY NOW <strong>LAP {continuousLap.toFixed(2)} / {forecast.raceLaps} · VM P{currentVmRank}</strong></span><span>LAP {boundaryLap} FORECAST <strong>P{forecast.virtualMax[boundaryLap].rank}</strong></span>{selectedPoint ? <span>SELECTED <strong>{selectedDriverId} · P{selectedPoint.rank}</strong></span> : null}{catchLap ? <span>FULL-FIELD TIMING CATCH <strong>LAP {catchLap}{catchTime === null ? '' : ` · ${formatRaceTime(catchTime)}`}</strong></span> : null}</div>
    <div className="lap-chart-wrap"><svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Deterministic synthetic lap chart forecast" onMouseMove={chartPointer} onMouseLeave={() => setHoverLap(null)}>
      {[1, 25, 50, 75, 101].map((rank) => <g key={rank}><line className="lap-grid-line" x1={PAD.left} x2={WIDTH - PAD.right} y1={PAD.top + (rank - 1) / 100 * (HEIGHT - PAD.top - PAD.bottom)} y2={PAD.top + (rank - 1) / 100 * (HEIGHT - PAD.top - PAD.bottom)} /><text className="lap-axis-label" x="6" y={PAD.top + (rank - 1) / 100 * (HEIGHT - PAD.top - PAD.bottom) + 3}>P{rank}</text></g>)}
      {Array.from({ length: forecast.raceLaps + 1 }, (_, lap) => lap).filter((lap) => lap === 0 || lap === forecast.raceLaps || lap % Math.max(1, Math.ceil(forecast.raceLaps / 6)) === 0).map((lap) => <text key={lap} className="lap-axis-label" x={PAD.left + lap / Math.max(1, forecast.raceLaps) * (WIDTH - PAD.left - PAD.right)} y={HEIGHT - 12} textAnchor="middle">{lap}</text>)}
      <g className="lap-initialization-region"><rect x={PAD.left} y={PAD.top} width={(WIDTH - PAD.left - PAD.right) / forecast.raceLaps} height={HEIGHT - PAD.top - PAD.bottom} /><text x={PAD.left + 7} y={PAD.top + 13}>INITIALIZATION</text></g>
      {Object.entries(forecast.trajectories).map(([driverId, points]) => <path key={driverId} d={lapChartPath(points.filter((point) => point.lap >= 1), forecast.raceLaps)} className={`lap-synthetic-line${selectedDriverId === driverId ? ' is-selected' : ''}${nextTargetId === driverId ? ' is-next-target' : ''}`} onMouseEnter={() => onSelect(driverId)} onFocus={() => onSelect(driverId)} onClick={() => onSelect(driverId)} tabIndex={0}><title>{driverId}</title></path>)}
      {catchLap ? <g className="lap-catch-marker" transform={`translate(${PAD.left + catchLap / forecast.raceLaps * (WIDTH - PAD.left - PAD.right)} 0)`}><line y1={PAD.top} y2={HEIGHT - PAD.bottom} /><text y="16">FULL-FIELD TIMING CATCH · L{catchLap}</text></g> : null}
      <line className="lap-current-marker" data-current-replay-progress={continuousLap.toFixed(2)} x1={x} x2={x} y1={PAD.top} y2={HEIGHT - PAD.bottom} /><text className="lap-current-label" x={x + 5} y={HEIGHT - PAD.bottom - 6}>REPLAY {continuousLap.toFixed(2)} / {forecast.raceLaps}</text>
      <path data-vm-segment="past" d={lapChartPath(forecast.virtualMax.filter((point) => point.lap <= boundaryLap), forecast.raceLaps)} className={`lap-vm-line${trafficAdjustedActive ? ' is-reference' : ''}`} onClick={() => onSelect('VIRTUAL MAX')}><title>{trafficAdjustedActive ? 'Pure Timing reference progression' : 'Active Pure Timing progression'}</title></path><path data-vm-segment="forecast" d={lapChartPath(forecast.virtualMax.filter((point) => point.lap >= boundaryLap), forecast.raceLaps)} className={`lap-vm-line lap-vm-forecast${trafficAdjustedActive ? ' is-reference' : ''}`} onClick={() => onSelect('VIRTUAL MAX')} />
      {trafficTrajectory.length ? <path data-vm-traffic-adjusted="true" d={lapChartPath(trafficTrajectory, forecast.raceLaps)} className={`lap-vm-traffic-line${trafficAdjustedActive ? ' is-active' : ''}`}><title>{trafficAdjustedActive ? 'Active Traffic-Adjusted scenario progression' : 'Traffic-Adjusted scenario comparison'}</title></path> : null}
    </svg></div>
    <p className="lap-chart-tooltip">LAP {activeLap} FORECAST · VIRTUAL MAX <strong>P{vmPoint.rank}</strong>{selectedPoint && selectedDriver ? <> · {selectedDriverId} <strong>P{selectedPoint.rank}</strong> · {selectedDriver.paceSecondsPerLap.toFixed(3)} s/lap · GRID P{selectedDriver.gridPosition}</> : null} · VM pace {scenario.virtualMaxPace.toFixed(3)} s/lap · start delay {scenario.startingDelaySeconds >= 0 ? '+' : ''}{scenario.startingDelaySeconds.toFixed(2)} s</p>
    <p className="lap-chart-methodology">{scenario.fieldVariability?.mode === 'HISTORICAL_SEEDED' ? 'Synthetic drivers use a single reproducible realization sampled from the observed historical lap-deviation distribution. It is scenario variation, not telemetry or a stochastic forecast.' : 'Synthetic drivers use fixed nominal pace in this deterministic forecast. Their relative order therefore stabilizes quickly. Lap-to-lap uncertainty is shown separately by the Monte Carlo model.'} {trafficTrajectory.length ? trafficAdjustedActive ? 'The solid cyan VM line is the active Traffic-Adjusted trajectory; the dashed red VM line is a Pure Timing reference.' : 'The cyan VM line is the explicit Traffic-Adjusted Scenario comparison.' : ''}</p>
  </section>
}
