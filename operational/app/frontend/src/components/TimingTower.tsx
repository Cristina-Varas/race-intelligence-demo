import { signedSeconds } from './Format'
import { InfoTooltip } from './InfoTooltip'
import type { CustomDriverResult, HistoricalDriver } from '../types/raceIntelligence'

interface Props { drivers: HistoricalDriver[]; scenarioDrivers?: CustomDriverResult[] }

export function TimingTower({ drivers, scenarioDrivers }: Props) {
  const fastest = drivers[0]?.pooledMedianPace
  const scenarioByDriver = new Map(scenarioDrivers?.map((driver) => [driver.driverId, driver]))
  const hasScenario = Boolean(scenarioDrivers)
  return (
    <section className="panel timing-tower" aria-labelledby="tower-title">
      <div className="panel-heading">
        <div>
          <p className="eyebrow">Historical field</p>
          <h2 id="tower-title">Timing tower</h2>
        </div>
        <span className="unit-label">HISTORICAL SOURCE IDS <InfoTooltip label="Historical source IDs">Driver IDs are categorical source identifiers from the supplied dataset and are not mapped to real-world driver identities.</InfoTooltip></span>
      </div>
      <div className={hasScenario ? 'tower-columns tower-columns-custom' : 'tower-columns'} aria-hidden="true"><span>POS</span><span>DRIVER ID</span><span>PACE</span><span>DELTA</span>{hasScenario ? <><span>CATCH LAP</span><span>CATCH %</span></> : null}</div>
      <ol className="tower-list">
        {drivers.map((driver, index) => {
          const delta = fastest === undefined ? 0 : driver.pooledMedianPace - fastest
          const scenario = scenarioByDriver.get(String(driver.driverId))
          return (
            <li className={`${hasScenario ? 'tower-row tower-row-custom' : 'tower-row'}${index === 0 ? ' fastest-row' : ''}`} key={driver.driverId}>
              <span>{String(index + 1).padStart(2, '0')}</span>
              <strong>#{driver.driverId}</strong>
              <span>{driver.pooledMedianPace.toFixed(3)}</span>
              <span>{index === 0 ? '0.000 s' : signedSeconds(delta, 3)}</span>
              {hasScenario ? <><span className="scenario-tower-value">{scenario?.catchPossibleWithinRace && scenario.catchLapDisplay !== null ? `LAP ${scenario.catchLapDisplay}` : 'NOT CAUGHT'}</span><span className="scenario-tower-value">{scenario ? `${(scenario.catchProbability * 100).toFixed(0)}%` : 'N/A'}</span></> : null}
            </li>
          )
        })}
      </ol>
      <p className="panel-note">Historical rank, pace and delta remain observed evidence. Catch lap and catch percentage are synthetic scenario outputs. Virtual Max is intentionally excluded from the historical ranking.</p>
    </section>
  )
}
