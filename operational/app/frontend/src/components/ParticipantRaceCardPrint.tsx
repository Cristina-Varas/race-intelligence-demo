import type { RaceModelMode } from '../types/raceIntelligence'
import { formatRaceTime } from '../utils/raceTiming'
import type { ParticipantRaceCardData } from '../utils/participantRaceCard'

interface Props { card: ParticipantRaceCardData; raceLaps: number; model: RaceModelMode }

const width = 640
const height = 170
const inset = 28

function chartPath(points: { progress: number; gapToVmSeconds: number }[], laps: number, range: number) {
  return points.map((point, index) => `${index ? 'L' : 'M'} ${inset + point.progress / Math.max(1, laps) * (width - inset * 2)} ${inset + (range - point.gapToVmSeconds) / (range * 2) * (height - inset * 2)}`).join(' ')
}

export function ParticipantRaceCardPrint({ card, raceLaps, model }: Props) {
  const interaction = card.virtualMaxInteraction
  const catchProgress = interaction.firstTimingCatchRaceProgress
  const chaseLaps = catchProgress === null ? raceLaps : Math.min(raceLaps, Math.ceil(catchProgress) + 1)
  const points = card.trajectory.chaseTrajectory.filter((point) => point.progress <= chaseLaps)
  const range = Math.max(1, ...points.map((point) => Math.abs(point.gapToVmSeconds))) * 1.08
  const samples = points.filter((point, index) => point.isTimingCatch || points.length <= 6 || index === 0 || index === points.length - 1 || index % Math.ceil(points.length / 5) === 0)
  const heldOff = card.fieldComparison.heldOffPercentile
  const catchLap = interaction.firstTimingCatchLap

  return <article className="race-card-print" data-print-card="true" aria-label={`Race card for ${card.identity.driverId}`}>
    <div className="race-card-print__stripe" aria-hidden="true" />
    <header className="race-card-print__header">
      <div className="race-card-print__brand"><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /><p>MAX V 100<br />RACE INTELLIGENCE</p></div>
      <div className="race-card-print__identity"><strong>{card.identity.driverId}</strong><span>{card.identity.kartNumber === null ? '' : `KART ${card.identity.kartNumber}`}</span><small>{card.identity.synthetic ? 'SIMULATED SCENARIO' : 'PARTICIPANT SCENARIO'} · {model.replace('_', ' ')}</small></div>
    </header>

    <section className="race-card-print__hero" aria-label="Chase summary">
      <div><b>{catchProgress === null ? 'FULL' : catchProgress.toFixed(1)}</b><span>{catchProgress === null ? 'RACE HELD VM OFF' : 'LAPS HELD VM OFF'}</span></div>
      <div><b>{interaction.timeAheadOfVirtualMaxSeconds === null ? 'FULL RACE' : formatRaceTime(interaction.timeAheadOfVirtualMaxSeconds)}</b><span>TIME AHEAD</span></div>
      <div><b>{catchLap === null ? 'NOT CAUGHT' : `L${catchLap}`}</b><span>CAUGHT ON</span></div>
      <div><b>{heldOff === null ? 'N/A' : `${heldOff}%`}</b><span>HELD VM OFF LONGER THAN FIELD</span></div>
    </section>

    <section className="race-card-print__chart" aria-label="Your chase versus Virtual Max">
      <h2>YOUR CHASE <span>VS VIRTUAL MAX</span></h2>
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Race card timing gap chart"><line className="race-card-print__zero" x1={inset} x2={width - inset} y1={height / 2} y2={height / 2} /><text x={width - inset} y={height / 2 - 7} textAnchor="end">0 s TIMING CATCH</text><path className="race-card-print__path" d={chartPath(points, chaseLaps, range)} />{catchProgress !== null ? <g className="race-card-print__catch" transform={`translate(${inset + catchProgress / Math.max(1, chaseLaps) * (width - inset * 2)} 0)`}><line y1={inset} y2={height - inset} /><text y={inset + 11}>CATCH POINT · L{catchProgress.toFixed(2)}</text></g> : null}<text x="4" y={inset + 2}>+{range.toFixed(0)} s</text><text x="4" y={height - inset}>-{range.toFixed(0)} s</text></svg>
      <p>Reconstructed timing scenario · not physical overtake telemetry.</p>
    </section>

    <section className="race-card-print__timeline" aria-label="Chase telemetry timeline">{samples.map((point) => <div className={point.isTimingCatch ? 'is-catch' : ''} key={`${point.progress}-${point.isTimingCatch ? 'catch' : 'lap'}`}><span>{point.isTimingCatch ? 'CATCH' : `L${point.progress}`}</span><b>{point.gapToVmSeconds >= 0 ? '+' : ''}{point.gapToVmSeconds.toFixed(1)} s</b>{point.isTimingCatch ? <small>L{point.progress.toFixed(2)}</small> : null}</div>)}</section>

    <section className="race-card-print__result" aria-label="Race result"><div><span>START</span><b>P{card.result.startPosition}</b></div><div><span>PEAK</span><b>P{card.result.bestPosition}</b></div><div><span>FINAL</span><b>P{card.result.finalPosition}</b></div><div><span>CHANGE</span><b>{card.result.positionsGained >= 0 ? '+' : ''}{card.result.positionsGained}</b></div></section>

    <section className="race-card-print__details"><div><h2>CHASE COMPARISON</h2>{card.fieldComparison.fieldMedianCatchLap !== null ? <p><span>FIELD MEDIAN CATCH</span><b>L{card.fieldComparison.fieldMedianCatchLap}</b></p> : null}{card.fieldComparison.fieldMedianTimeAheadSeconds !== null ? <p><span>FIELD MEDIAN TIME</span><b>{formatRaceTime(card.fieldComparison.fieldMedianTimeAheadSeconds)}</b></p> : null}<p><span>YOUR TIME AHEAD</span><b>{interaction.timeAheadOfVirtualMaxSeconds === null ? 'FULL RACE' : formatRaceTime(interaction.timeAheadOfVirtualMaxSeconds)}</b></p><p><span>NOMINAL PACE</span><b>{card.pace.nominalLapSeconds.toFixed(3)} s</b></p></div><div><h2>RACE HIGHLIGHTS</h2><ul>{card.highlights.slice(0, 3).map((highlight) => <li key={highlight}>{highlight}</li>)}</ul></div></section>
  </article>
}
