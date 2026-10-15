import { InfoTooltip } from './InfoTooltip'
import type { CustomDriverResult } from '../types/raceIntelligence'

export function sortChaseOrder(drivers: CustomDriverResult[]): CustomDriverResult[] {
  return [...drivers].sort((left, right) => {
    if (left.catchLapExact === null) return 1
    if (right.catchLapExact === null) return -1
    return left.catchLapExact - right.catchLapExact
  })
}

export function ChaseOrder({ drivers }: { drivers: CustomDriverResult[] }) {
  const ordered = sortChaseOrder(drivers)
  return (
    <section className="panel chase-order" aria-labelledby="chase-order-title">
      <div className="panel-heading"><div><p className="eyebrow">Deterministic timing catch</p><h2 id="chase-order-title">Chase order <InfoTooltip label="Catch lap">Deterministic lap at which the cumulative timing deficit reaches zero against this driver.</InfoTooltip></h2></div><span className="unit-label">NOT PHYSICAL OVERTAKE</span></div>
      <div className="telemetry-scroll-panel chase-order-scroll" tabIndex={0} aria-label="Scrollable deterministic chase order">
        <div className="telemetry-sticky-header chase-order-columns" aria-hidden="true"><span>CATCH LAP</span><span>DRIVER</span><span>TIMING LAP VALUE</span></div>
        <ol className="telemetry-scroll-content chase-order-list">
          {ordered.map((driver) => (
            <li key={driver.driverId}>
              <span>{driver.catchPossibleWithinRace && driver.catchLapDisplay !== null ? `LAP ${String(driver.catchLapDisplay).padStart(2, '0')}` : 'NOT CAUGHT'}</span>
              <strong>#{driver.driverId}</strong>
              <small>{driver.catchPossibleWithinRace && driver.catchLapExact !== null ? `${driver.catchLapExact.toFixed(2)} timing laps` : 'outside race length'}</small>
            </li>
          ))}
        </ol>
      </div>
    </section>
  )
}
