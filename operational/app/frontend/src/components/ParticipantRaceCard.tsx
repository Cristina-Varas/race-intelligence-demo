import { Printer, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'

import type { CustomSimulationResult, RaceModelMode } from '../types/raceIntelligence'
import { formatRaceTime } from '../utils/raceTiming'
import { buildParticipantRaceCard, raceCardPdfFilename } from '../utils/participantRaceCard'
import { ParticipantRaceCardPrint } from './ParticipantRaceCardPrint'

interface Props { scenario: CustomSimulationResult | null; selectedDriverId: string | null; onSelect: (driverId: string | null) => void }
const W = 640; const H = 200; const pad = 22
function gapPath(points: { progress: number; gapToVmSeconds: number }[], laps: number, range: number) { return points.map((point, index) => `${index ? 'L' : 'M'} ${pad + point.progress / Math.max(1, laps) * (W - pad * 2)} ${pad + (range - point.gapToVmSeconds) / (range * 2) * (H - pad * 2)}`).join(' ') }

export function ParticipantRaceCard({ scenario, selectedDriverId, onSelect }: Props) {
  const [search, setSearch] = useState('')
  const [model, setModel] = useState<RaceModelMode>(scenario?.raceModel?.mode ?? 'PURE_TIMING')
  useEffect(() => { setModel(scenario?.raceModel?.mode ?? 'PURE_TIMING') }, [scenario?.raceModel?.mode, scenario?.syntheticReplay?.scenarioId])
  const entities = scenario?.syntheticReplay?.entities ?? scenario?.syntheticReplay?.drivers ?? []
  const available = useMemo(() => entities.filter((driver) => driver.driverId.toLowerCase().includes(search.toLowerCase())), [entities, search])
  const activeId = selectedDriverId && selectedDriverId !== 'VIRTUAL MAX' && entities.some((driver) => driver.driverId === selectedDriverId) ? selectedDriverId : entities[0]?.driverId ?? null
  const card = scenario && activeId ? buildParticipantRaceCard(scenario, activeId, model) : null
  const printCard = (pdf = false) => { if (pdf && card) document.title = raceCardPdfFilename(card).replace(/\.pdf$/, ''); window.print() }
  if (!scenario?.syntheticReplay) return <section className="participant-race-cards panel"><p className="eyebrow">Post-race</p><h2>Participant race cards</h2><strong>RUN A SCENARIO TO GENERATE PARTICIPANT RACE CARDS</strong></section>
  if (!card) return null
  const catchLap = card.virtualMaxInteraction.firstTimingCatchLap
  const catchProgress = card.virtualMaxInteraction.firstTimingCatchRaceProgress
  const heldOffPercentile = card.fieldComparison.heldOffPercentile
  const topPercent = card.fieldComparison.heldOffTopPercent
  const chaseLaps = catchProgress === null ? scenario.raceLaps : Math.min(scenario.raceLaps, Math.ceil(catchProgress) + 1)
  const chasePoints = card.trajectory.chaseTrajectory.filter((point) => point.progress <= chaseLaps)
  const gapRange = Math.max(1, ...chasePoints.map((point) => Math.abs(point.gapToVmSeconds))) * 1.08
  const gapRows = chasePoints.filter((point, index) => point.isTimingCatch || chasePoints.length <= 6 || index === 0 || index === chasePoints.length - 1 || index % Math.ceil(chasePoints.length / 5) === 0)
  return <section className="participant-race-cards panel" aria-labelledby="race-card-title">
    <div className="race-card-toolbar no-print"><div><p className="eyebrow">Post-race</p><h2 id="race-card-title">Participant race cards</h2></div><label><Search size={13} /> <input aria-label="Search participants" value={search} placeholder="Search driver or kart" onChange={(event) => setSearch(event.target.value)} /></label><select aria-label="Participant selector" value={activeId} onChange={(event) => onSelect(event.target.value)}>{available.map((driver) => <option key={driver.driverId} value={driver.driverId}>{driver.driverId} · KART {driver.gridPosition}</option>)}</select><button onClick={() => onSelect(entities[Math.max(0, entities.findIndex((driver) => driver.driverId === activeId) - 1)]?.driverId ?? activeId)}>PREVIOUS</button><button onClick={() => onSelect(entities[Math.min(entities.length - 1, entities.findIndex((driver) => driver.driverId === activeId) + 1)]?.driverId ?? activeId)}>NEXT</button><button className={model === 'PURE_TIMING' ? 'active' : ''} onClick={() => setModel('PURE_TIMING')}>PURE</button><button className={model === 'TRAFFIC_ADJUSTED' ? 'active' : ''} disabled={!scenario.trafficAdjusted} onClick={() => setModel('TRAFFIC_ADJUSTED')}>TRAFFIC</button></div>
    <article className="participant-card">
      <header className="participant-card-header">
        <div className="participant-card-brand"><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /><div><span>MAX V 100</span><p>{card.identity.synthetic ? 'SIMULATED RACE CARD' : 'PARTICIPANT RACE CARD'} · {model.replace('_', ' ')}</p></div></div>
        <div className="participant-card-identity"><strong>{card.identity.driverId}</strong><small>{card.identity.kartNumber === null ? '' : `ILLUSTRATIVE GRID · KART ${card.identity.kartNumber}`}</small></div>
      </header>
      {catchLap === null || (heldOffPercentile ?? 0) >= 75 ? <div className="participant-badges">{catchLap === null ? <b>NOT CAUGHT</b> : null}{catchLap !== null && (heldOffPercentile ?? 0) >= 75 ? <b>TOP {topPercent}% · HELD VM OFF</b> : null}</div> : null}
      <div className="participant-kpis chase-kpis"><div><span>HELD VM OFF</span><b>{catchProgress === null ? 'FULL RACE' : `${catchProgress.toFixed(1)} LAPS`}</b></div><div><span>TIME AHEAD</span><b>{card.virtualMaxInteraction.timeAheadOfVirtualMaxSeconds === null ? 'FULL RACE' : formatRaceTime(card.virtualMaxInteraction.timeAheadOfVirtualMaxSeconds)}</b></div><div><span>CAUGHT ON</span><b>{catchLap === null ? 'NOT CAUGHT' : `L${catchLap}`}</b></div><div className="participant-percentile"><span>HELD VM OFF LONGER THAN</span><b>{heldOffPercentile === null ? 'N/A' : `${heldOffPercentile}% OF FIELD`}</b></div></div>
      <div className="participant-chase-chart" data-chase-laps={chaseLaps}><p>YOUR CHASE <span>VS VIRTUAL MAX</span></p><svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Participant gap to Virtual Max chase"><line className="card-gap-zero" x1={pad} x2={W - pad} y1={pad + (H - pad * 2) / 2} y2={pad + (H - pad * 2) / 2} /><text x={W - pad} y={pad + (H - pad * 2) / 2 - 6} textAnchor="end">TIMING CATCH · 0 s</text><path className="card-chase-path" d={gapPath(chasePoints, chaseLaps, gapRange)} />{catchProgress !== null ? <g className="card-catch-marker" data-catch-progress={catchProgress.toFixed(2)} data-catch-gap="0" transform={`translate(${pad + catchProgress / Math.max(1, chaseLaps) * (W - pad * 2)} 0)`}><line y1={pad} y2={H - pad} /><text y={pad + 10}>CAUGHT · L{catchProgress.toFixed(2)}</text></g> : null}<text x="2" y={pad + 3}>+{gapRange.toFixed(0)} s</text><text x="2" y={H - pad}>-{gapRange.toFixed(0)} s</text></svg><small>Reconstructed timing gap; zero does not imply physical pass. {catchLap === null ? 'Held Virtual Max off for the full race.' : `Chart focuses on the chase through Lap ${chaseLaps}.`}</small></div>
      <div className="chase-lap-summary">{gapRows.map((point) => <span className={point.isTimingCatch ? 'is-catch' : ''} key={`${point.progress}-${point.isTimingCatch ? 'catch' : 'lap'}`}>{point.isTimingCatch ? `CATCH · L${point.progress.toFixed(2)}` : `L${point.progress}`}<b>{point.gapToVmSeconds >= 0 ? '+' : ''}{point.gapToVmSeconds.toFixed(1)} s</b>{point.isTimingCatch ? <em>CATCH</em> : null}</span>)}</div>
      <div className="participant-card-grid"><div className="participant-race-result"><h3>Race result</h3><div className="participant-position-stats"><p><span>INITIAL TIMING RANK</span><b>P{card.result.startPosition}</b></p><p><span>PEAK</span><b>P{card.result.bestPosition}</b></p><p><span>FINAL</span><b>P{card.result.finalPosition}</b></p></div><p className="participant-position-change"><span>POSITION CHANGE</span><b>{card.result.positionsGained >= 0 ? '+' : ''}{card.result.positionsGained}</b></p><small className="panel-note">Lap 0 has equal timing progress; this rank uses deterministic ID tie resolution, not the illustrative grid or nominal pace order.</small></div><div className="participant-field-comparison"><h3>Chase comparison</h3>{card.fieldComparison.fieldMedianCatchLap !== null ? <p><span>FIELD MEDIAN CATCH</span><b>L{card.fieldComparison.fieldMedianCatchLap}</b></p> : null}{card.fieldComparison.fieldMedianTimeAheadSeconds !== null ? <p><span>FIELD MEDIAN TIME AHEAD</span><b>{formatRaceTime(card.fieldComparison.fieldMedianTimeAheadSeconds)}</b></p> : null}{card.virtualMaxInteraction.firstClearLap !== null ? <p><span>TRAFFIC ADJUSTED CLEAR</span><b>L{card.virtualMaxInteraction.firstClearLap} · {formatRaceTime(card.virtualMaxInteraction.firstClearTimeSeconds!)}</b></p> : null}<p><span>YOUR NOMINAL PACE</span><b>{card.pace.nominalLapSeconds.toFixed(3)} s</b></p></div></div>
      <div className="participant-highlights"><h3>Race highlights</h3><ul>{card.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></div>
    </article>
    <div className="race-card-print-host"><ParticipantRaceCardPrint card={card} raceLaps={scenario.raceLaps} model={model} /></div>
    <div className="race-card-actions no-print"><button onClick={() => printCard(false)}><Printer size={14} /> PRINT CARD</button><button onClick={() => printCard(true)}>EXPORT PDF</button><small>Export opens the dedicated print layout. Enable Background graphics for colour accents and disable Headers and footers. Suggested file: {raceCardPdfFilename(card)}</small></div>
  </section>
}
