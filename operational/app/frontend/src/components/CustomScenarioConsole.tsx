import { Play, RotateCcw } from 'lucide-react'

import { InfoTooltip } from './InfoTooltip'
import type { SimulationRequest } from '../types/raceIntelligence'
import { validateSimulationRequest } from '../utils/simulationValidation'

interface Props {
  parameters: SimulationRequest
  onChange: (parameters: SimulationRequest) => void
  onRun: () => void
  onReset: () => void
  isRunning: boolean
  hasResult: boolean
  fieldMode?: SimulationRequest['fieldMode']
  isDirty?: boolean
  error?: string | null
}

export function CustomScenarioConsole({ parameters, onChange, onRun, onReset, isRunning, hasResult, fieldMode = parameters.fieldMode, isDirty = false, error }: Props) {
  const update = <K extends keyof SimulationRequest>(key: K, value: SimulationRequest[K]) => onChange({ ...parameters, [key]: value })
  const traffic = parameters.trafficCostModel ?? { enabled: true, earlyCostSecondsPerKart: 1, lateCostSecondsPerKart: .2, transitionStartLap: 1, transitionEndLap: 7, interpolation: 'LINEAR' as const }
  const profile = parameters.paceProfile ?? [{ startLap: 1, endLap: 5, paceAdjustmentPercent: 1.5 }, { startLap: 6, endLap: null, paceAdjustmentPercent: -2 }]
  const updateProfile = (index: number, paceAdjustmentPercent: number) => update('paceProfile', profile.map((phase, phaseIndex) => phaseIndex === index ? { ...phase, paceAdjustmentPercent } : phase))
  const validation = validateSimulationRequest(parameters)
  const runButtonDisabled = isRunning || !validation.formValid
  return (
    <section className="custom-console panel" aria-labelledby="custom-scenario-title">
      <div className="simulator-head">
        <div>
          <p className="eyebrow">Scenario controls</p>
          <h2 id="custom-scenario-title">Active configuration</h2>
          <p className="panel-note">{fieldMode === 'historical' ? 'Observed historical evidence remains governed. Changes create a transient WHAT-IF only.' : 'Synthetic stress-test configuration. It does not create additional historical evidence.'}</p>
        </div>
        <button type="button" onClick={onReset} className="reset-button"><RotateCcw size={14} /> {fieldMode === 'historical' ? 'RESET TO GOVERNED BASELINE' : 'RESET TO DEFAULT SCENARIO'}</button>
      </div>
      <div className="control-grid">
        <div className="scenario-control"><span>RACE FORMAT</span><div className="race-model-toggle" aria-label="Race format"><button type="button" className={parameters.raceFormat !== 'TIMED_RACE' ? 'active' : ''} onClick={() => update('raceFormat', 'FIXED_LAPS')}>FIXED LAPS</button><button type="button" className={parameters.raceFormat === 'TIMED_RACE' ? 'active' : ''} onClick={() => update('raceFormat', 'TIMED_RACE')}>TIMED RACE</button></div></div>
        {parameters.raceFormat === 'TIMED_RACE' ? <label className="scenario-control"><span>RACE DURATION</span><strong>{Math.round((parameters.raceDurationSeconds ?? 3600) / 60)} MIN</strong><input aria-label="Race duration minutes" type="range" min="10" max="120" step="5" value={(parameters.raceDurationSeconds ?? 3600) / 60} onChange={(event) => update('raceDurationSeconds', Number(event.target.value) * 60)} /><small>FINISH RULE · COMPLETE CURRENT LAP <InfoTooltip label="Timed race finish rule">When race time expires, each entity completes its current lap. This is a deterministic scenario rule, not an official regulation.</InfoTooltip></small></label> : <label className="scenario-control"><span>RACE LENGTH</span><strong>{parameters.raceLaps} LAPS</strong><input type="range" min="5" max="100" step="1" value={parameters.raceLaps} onChange={(event) => update('raceLaps', Number(event.target.value))} /></label>}
        <label className="scenario-control">
          <span>VIRTUAL MAX GAIN <InfoTooltip label="Virtual Max" definitionId="virtual-max" /></span>
          <strong>{parameters.virtualMaxAdvantageSecondsPerLap.toFixed(3)} S/LAP</strong>
          <input type="range" min="0.05" max="0.50" step="0.005" value={parameters.virtualMaxAdvantageSecondsPerLap} onChange={(event) => update('virtualMaxAdvantageSecondsPerLap', Number(event.target.value))} />
        </label>
      </div>
      <p className="panel-note scenario-delay-link">START DELAY is edited once in Start Delay Analysis below; its active value is included in this scenario configuration.</p>
      <details className="advanced-race-assumptions" open={parameters.raceModelMode === 'TRAFFIC_ADJUSTED'}>
        <summary>ADVANCED RACE ASSUMPTIONS</summary>
        {fieldMode === 'synthetic_100' ? <div className="field-variability-control">
          <div><small>FIELD VARIABILITY</small><p>Lap-by-lap synthetic field variation is sampled reproducibly from observed historical lap deviations. It does not add historical drivers or evidence.</p></div>
          <div className="race-model-toggle" aria-label="Field variability"><button type="button" className={parameters.fieldVariabilityMode !== 'HISTORICAL_SEEDED' ? 'active' : ''} onClick={() => update('fieldVariabilityMode', 'NOMINAL')}>NOMINAL</button><button type="button" className={parameters.fieldVariabilityMode === 'HISTORICAL_SEEDED' ? 'active' : ''} onClick={() => update('fieldVariabilityMode', 'HISTORICAL_SEEDED')}>HISTORICAL SEEDED</button></div>
          {parameters.fieldVariabilityMode === 'HISTORICAL_SEEDED' ? <p className="field-variability-meta">SOURCE · 299 OBSERVED HISTORICAL LAP DEVIATIONS &nbsp; SEED · {parameters.fieldVariabilitySeed ?? 42}</p> : null}
        </div> : null}
        <div className="race-model-toggle" aria-label="Race model"><button type="button" className={parameters.raceModelMode !== 'TRAFFIC_ADJUSTED' ? 'active' : ''} onClick={() => update('raceModelMode', 'PURE_TIMING')}>PURE TIMING</button><button type="button" className={parameters.raceModelMode === 'TRAFFIC_ADJUSTED' ? 'active' : ''} onClick={() => update('raceModelMode', 'TRAFFIC_ADJUSTED')}>TRAFFIC ADJUSTED</button></div>
        {parameters.raceModelMode === 'TRAFFIC_ADJUSTED' ? <div className="assumption-grid">
          <p className="panel-note">REFERENCE TRAFFIC ASSUMPTIONS. Positive lap-time percentage is slower; negative is faster. These are configurable scenario assumptions, not measured telemetry.</p>
          <label>LAPS {profile[0].startLap}–{profile[0].endLap} · LAP TIME % <input aria-label="Early pace adjustment percent" type="number" step=".1" value={profile[0].paceAdjustmentPercent} onChange={(event) => updateProfile(0, Number(event.target.value))} /></label>
          <label>LAPS {profile[1].startLap}+ · LAP TIME % <input aria-label="Late pace adjustment percent" type="number" step=".1" value={profile[1].paceAdjustmentPercent} onChange={(event) => updateProfile(1, Number(event.target.value))} /></label>
          <label>EARLY TRAFFIC COST · S/KART <input aria-label="Early traffic cost" type="number" min="0" step=".1" value={traffic.earlyCostSecondsPerKart} onChange={(event) => update('trafficCostModel', { ...traffic, earlyCostSecondsPerKart: Number(event.target.value) })} /></label>
          <label>LATE TRAFFIC COST · S/KART <input aria-label="Late traffic cost" type="number" min="0" step=".1" value={traffic.lateCostSecondsPerKart} onChange={(event) => update('trafficCostModel', { ...traffic, lateCostSecondsPerKart: Number(event.target.value) })} /></label>
          <label>TRANSITION END · LAP <input aria-label="Traffic transition end lap" type="number" min="1" value={traffic.transitionEndLap} onChange={(event) => update('trafficCostModel', { ...traffic, transitionEndLap: Number(event.target.value) })} /></label>
        </div> : null}
      </details>
      <div className="custom-actions">
        {isDirty || error ? <button type="button" className="run-scenario-button" disabled={runButtonDisabled} onClick={onRun}><Play size={15} fill="currentColor" /> {isRunning ? 'RUNNING SIMULATION' : 'RUN SCENARIO'}</button> : null}
        <span>{parameters.simulations.toLocaleString()} seeded simulations. Results update only when run.</span>
        {hasResult && !isDirty ? <span className="result-ready">CURRENT RESULT READY</span> : null}
      </div>
    </section>
  )
}
