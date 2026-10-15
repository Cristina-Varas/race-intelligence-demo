import type { DistanceToFieldState, ReplayAheadEntity } from '../utils/distanceToField'
import { fieldGapBarWidth } from '../utils/distanceToField'

interface Props<T extends ReplayAheadEntity> {
  state: DistanceToFieldState<T>
  vmRank: number
  caughtCount: number
  uncaughtTargetCount: number
  currentlyAheadCount: number
  currentlyAheadLabel?: string
  modelLabel?: string
  selectedDriverId: string | null
  startingDelaySeconds: number
  replayTime: number
  onSelect: (driverId: string | null) => void
}

export function DistanceToField<T extends ReplayAheadEntity>({ state, vmRank, caughtCount, uncaughtTargetCount, currentlyAheadCount, currentlyAheadLabel = 'CURRENTLY AHEAD', modelLabel, selectedDriverId, startingDelaySeconds, replayTime, onSelect }: Props<T>) {
  const waiting = startingDelaySeconds > 0 && replayTime < startingDelaySeconds
  const allTimingTargetsCaught = uncaughtTargetCount === 0
  if (!state.ahead.length) return <section className="distance-to-field panel" aria-labelledby="distance-to-field-title">
    <div className="distance-field-head"><div><p className="eyebrow">Synthetic timing replay</p><h2 id="distance-to-field-title">Distance to field</h2></div><span>VM P{vmRank} / 101</span></div>
    <div className="distance-clear"><strong>{allTimingTargetsCaught ? 'ALL TIMING TARGETS CAUGHT' : waiting ? 'WAITING TO START' : 'NO ACTIVE POSITIVE GAP'}</strong><span>TIMING CAUGHT {caughtCount} / 100 · UNCAUGHT TARGETS {uncaughtTargetCount} · {currentlyAheadLabel} {currentlyAheadCount}</span></div>
  </section>

  return <section className="distance-to-field panel" aria-labelledby="distance-to-field-title">
    <div className="distance-field-head"><div><p className="eyebrow">Synthetic timing replay</p><h2 id="distance-to-field-title">Distance to field</h2></div><span>{waiting ? 'WAITING TO START' : `VM P${vmRank} / 101`}</span></div>
    <div className="distance-field-kpis"><span>{currentlyAheadLabel} <strong>{currentlyAheadCount}</strong></span><span>UNCAUGHT TARGETS <strong>{uncaughtTargetCount}</strong></span><span>TIMING CAUGHT <strong>{caughtCount} / 100</strong></span><span>LEADER <strong>{state.leader?.driverId}</strong></span><span>LEADER GAP <strong>+{state.leaderGapToVMMeters?.toFixed(1)} m</strong></span><span>NEXT UP <strong>{state.nextTarget?.driverId} · +{state.nextTarget?.gapToVirtualMaxMeters.toFixed(1)} m</strong></span></div>
    <div className="distance-field-label"><span>LEADER</span><span>RECONSTRUCTED GAP TO VM · METRES</span><span>NEAREST TARGET</span></div>
    <ol className="distance-field-bars" aria-label="Synthetic drivers still ahead of Virtual Max">
      {state.ahead.map((driver, index) => { const nearest = driver.driverId === state.nextTarget?.driverId; const selected = driver.driverId === selectedDriverId; const width = fieldGapBarWidth(driver.gapToVirtualMaxMeters, state.maxGapMeters); return <li key={driver.driverId} className={`${nearest ? 'is-next-up' : ''}${selected ? ' is-selected' : ''}`} tabIndex={0} onMouseEnter={() => onSelect(driver.driverId)} onMouseLeave={() => onSelect(null)} onFocus={() => onSelect(driver.driverId)} onBlur={() => onSelect(null)} onClick={() => onSelect(driver.driverId)}>
        <span className="field-rank">P{index + 1}</span><strong>{driver.driverId}</strong><span className="field-bar"><i style={{ width: `${width * 100}%` }} /></span><em>+{driver.gapToVirtualMaxMeters.toFixed(1)} m</em>{nearest ? <small>NEXT UP</small> : null}
      </li> })}
    </ol>
    <p className="distance-field-note">{modelLabel ? `${modelLabel}. ` : ''}Reconstructed cumulative Main-route distance. Current spatial order and timing-catch history are reported separately.</p>
  </section>
}
