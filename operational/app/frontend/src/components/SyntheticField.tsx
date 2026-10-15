import type { CustomDriverResult } from '../types/raceIntelligence'
import { signedSeconds } from './Format'

export function SyntheticField({ drivers }: { drivers: CustomDriverResult[] }) {
  const limiting = [...drivers].sort((left, right) => left.paceGainSecondsPerLap - right.paceGainSecondsPerLap).slice(0, 20)
  return <section className="panel synthetic-field" aria-labelledby="synthetic-field-title">
    <div className="panel-heading"><div><p className="eyebrow">Synthetic stress test</p><h2 id="synthetic-field-title">Synthetic field</h2></div><span className="unit-label">TOP 20 LIMITING DRIVERS</span></div>
    <div className="tower-columns synthetic-columns" aria-hidden="true"><span>POS</span><span>SYNTHETIC ID</span><span>PACE</span><span>GAIN</span></div>
    <ol className="tower-list">{limiting.map((driver, index) => <li className="tower-row synthetic-columns" key={driver.driverId}><span>{String(index + 1).padStart(2, '0')}</span><strong>{driver.driverId}</strong><span>{driver.driverPace.toFixed(3)}</span><span>{signedSeconds(driver.paceGainSecondsPerLap, 3)}</span></li>)}</ol>
    <p className="panel-note">100 generated stress-test drivers. They are not historical records, evidence, or additional training data.</p>
  </section>
}
