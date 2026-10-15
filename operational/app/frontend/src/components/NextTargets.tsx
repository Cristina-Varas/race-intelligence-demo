import type { NextTargetReplayEntity, NextTargetsState } from '../utils/nextTargets'

interface Props<T extends NextTargetReplayEntity> {
  state: NextTargetsState<T>
  vmRank: number
  currentlyAheadCount: number
  currentlyAheadLabel?: string
  modelLabel?: string
  replayTime: number
  raceLaps: number
  virtualMaxLap: number
  startingDelaySeconds: number
  selectedDriverId: string | null
  onSelect: (driverId: string | null) => void
}

function catchClock(seconds: number) {
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds % 60).toFixed(1).padStart(4, '0')}`
}

export function NextTargets<T extends NextTargetReplayEntity>({ state, vmRank, currentlyAheadCount, currentlyAheadLabel = 'CURRENTLY AHEAD', modelLabel, replayTime, raceLaps, virtualMaxLap, startingDelaySeconds, selectedDriverId, onSelect }: Props<T>) {
  const waiting = startingDelaySeconds > 0 && replayTime < startingDelaySeconds
  const allTimingTargetsCaught = state.uncaughtTargetCount === 0
  const lastCatch = state.lastCatch
  return <section className="next-targets panel" aria-labelledby="next-targets-title">
    <div className="next-targets-head">
      <div><p className="eyebrow">Synthetic timing replay</p><h2 id="next-targets-title">Next targets</h2></div>
      <strong>VM P{vmRank} / 101</strong>
    </div>
    <div className="next-targets-vm">
      <span className="next-targets-vm-badge" aria-hidden="true">◆</span><div><span>VIRTUAL MAX</span><strong>{waiting ? 'WAITING TO START' : allTimingTargetsCaught ? 'ALL TIMING TARGETS CAUGHT' : 'HUNTING'}</strong><small>{modelLabel ? `${modelLabel} · ` : ''}LAP {virtualMaxLap} / {raceLaps}{waiting ? ` · START DELAY +${startingDelaySeconds.toFixed(2)} S` : ''}</small></div>
      <div className="next-targets-last-catch"><span>LAST TIMING CATCH</span>{lastCatch ? <><strong>{lastCatch.driverId}</strong><small>LAP {Math.min(raceLaps, Math.floor(lastCatch.raceDistance) + 1)} · {catchClock(lastCatch.timingCatchTimeSeconds!)}</small></> : <strong>NO TIMING CATCH YET</strong>}</div>
    </div>
    {state.targets.length ? <ol className="next-target-list" aria-label="Nearest synthetic targets ahead">
      {state.targets.map((target, index) => <li key={target.driverId} className={`${index === 0 ? 'is-next-up' : ''}${selectedDriverId === target.driverId ? ' is-selected' : ''}`} onMouseEnter={() => onSelect(target.driverId)} onMouseLeave={() => onSelect(null)} onFocus={() => onSelect(target.driverId)} onBlur={() => onSelect(null)} onClick={() => onSelect(target.driverId)} tabIndex={0}>
        <span className="next-target-position">{index === 0 ? 'NEXT UP' : `+${index + 1}`}</span><strong>{target.driverId}</strong><span>RECONSTRUCTED GAP</span><em>+{target.gapToVirtualMaxMeters.toFixed(1)} m</em>
      </li>)}
    </ol> : <div className="next-target-clear"><strong>{allTimingTargetsCaught ? 'ALL TIMING TARGETS CAUGHT' : waiting ? 'WAITING TO START' : 'NO ACTIVE POSITIVE GAP'}</strong><span>{allTimingTargetsCaught ? 'All synthetic timing targets have been caught at least once.' : 'Synthetic timing references remain active; no positive reconstructed Main-route gap is currently available.'}</span></div>}
    <footer><span>TIMING CAUGHT <strong>{state.caughtCount} / 100</strong></span><span>UNCAUGHT TARGETS <strong>{state.uncaughtTargetCount}</strong></span><span>{currentlyAheadLabel} <strong>{currentlyAheadCount}</strong></span><small>Timing catch is not final classification or a physical overtake.</small></footer>
  </section>
}
