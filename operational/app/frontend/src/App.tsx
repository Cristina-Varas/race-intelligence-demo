import { Activity, Database, Gauge, MonitorUp, ShieldCheck, Timer } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'

import { runSimulation } from './api/raceIntelligence'
import { ChaseOrder } from './components/ChaseOrder'
import { CustomScenarioConsole } from './components/CustomScenarioConsole'
import { DeterministicChase } from './components/DeterministicChase'
import { delayInterpretation, pace, probability, signedSeconds } from './components/Format'
import { InfoTooltip } from './components/InfoTooltip'
import { FieldComparison } from './components/FieldComparison'
import { FieldModeSelector } from './components/FieldModeSelector'
import { ProbabilityChart } from './components/ProbabilityChart'
import { TimingTower } from './components/TimingTower'
import { SyntheticField } from './components/SyntheticField'
import { SyntheticComparativeAnalytics } from './components/SyntheticComparativeAnalytics'
import { TrackReplay } from './components/TrackReplay'
import { JokerStrategy } from './components/JokerStrategy'
import { CircleOfDoom, type CircleLiveState } from './components/CircleOfDoom'
import { JokerComparison } from './components/JokerComparison'
import { RaceModelComparison } from './components/RaceModelComparison'
import { EventOperations } from './components/EventOperations'
import { DocumentationPage } from './components/DocumentationPage'
import { RaceWall } from './components/RaceWall'
import { useRaceIntelligence } from './hooks/useRaceIntelligence'
import { useTrackTopology } from './hooks/useTrackTopology'
import type { CustomSimulationResult, FieldMode, JokerStrategyResult, SimulationRequest } from './types/raceIntelligence'
import { interpolateProbability } from './utils/probability'
import { deriveFixedLapTiming, formatRaceTime } from './utils/raceTiming'
import { validateSimulationRequest } from './utils/simulationValidation'

const defaultCustom: SimulationRequest = {
  raceFormat: 'FIXED_LAPS',
  raceLaps: 30,
  raceDurationSeconds: 3600,
  timedFinishRule: 'COMPLETE_CURRENT_LAP',
  virtualMaxAdvantageSecondsPerLap: 0.195,
  // The governed Observed 16 reference is anchored at the Gold P50 delay.
  // It is reconciled to the live governed summary once that data is loaded.
  startingDelaySeconds: 1.5,
  simulations: 5000,
  fieldMode: 'historical',
  raceModelMode: 'PURE_TIMING',
  paceProfile: [{ startLap: 1, endLap: 5, paceAdjustmentPercent: 1.5 }, { startLap: 6, endLap: null, paceAdjustmentPercent: -2 }],
  trafficCostModel: { enabled: true, earlyCostSecondsPerKart: 1, lateCostSecondsPerKart: .2, transitionStartLap: 1, transitionEndLap: 7, interpolation: 'LINEAR' },
  fieldVariabilityMode: 'NOMINAL',
  fieldVariabilitySeed: 42,
}

function LoadingState() {
  return <main className="loading-shell" aria-label="Loading governed race data"><div className="loading-line wide" /><div className="loading-grid"><div /><div /><div /></div><div className="loading-chart" /></main>
}

function simulationErrorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : 'The custom simulation could not be completed.'
  return message.includes('Historical serving data is unavailable')
    ? 'Historical variability serving view is unavailable.'
    : message
}

function buildObservedGovernedBaseline(raceLaps: number, advantage: number, p50Delay: number | null): SimulationRequest {
  return {
    ...defaultCustom,
    fieldMode: 'historical',
    raceLaps,
    virtualMaxAdvantageSecondsPerLap: advantage,
    startingDelaySeconds: p50Delay ?? 0,
  }
}

function buildSyntheticDefaultScenario(raceLaps: number, advantage: number, p50Delay: number | null): SimulationRequest {
  return {
    ...defaultCustom,
    fieldMode: 'synthetic_100',
    raceLaps,
    virtualMaxAdvantageSecondsPerLap: advantage,
    startingDelaySeconds: p50Delay ?? 0,
  }
}

function buildFieldDefault(fieldMode: FieldMode, raceLaps: number, advantage: number, p50Delay: number | null): SimulationRequest {
  return fieldMode === 'synthetic_100'
    ? buildSyntheticDefaultScenario(raceLaps, advantage, p50Delay)
    : buildObservedGovernedBaseline(raceLaps, advantage, p50Delay)
}

function buildUnavailableFieldDefault(fieldMode: FieldMode): SimulationRequest {
  return { ...defaultCustom, fieldMode }
}

function normalizedScenario(parameters: SimulationRequest, baseline: SimulationRequest) {
  const isTimed = parameters.raceFormat === 'TIMED_RACE'
  const isTrafficAdjusted = parameters.raceModelMode === 'TRAFFIC_ADJUSTED'
  const isSynthetic = parameters.fieldMode === 'synthetic_100'
  const isSeeded = isSynthetic && parameters.fieldVariabilityMode === 'HISTORICAL_SEEDED'
  return {
    fieldMode: parameters.fieldMode,
    raceFormat: parameters.raceFormat,
    raceLaps: parameters.raceLaps,
    virtualMaxAdvantageSecondsPerLap: parameters.virtualMaxAdvantageSecondsPerLap,
    startingDelaySeconds: parameters.startingDelaySeconds,
    raceModelMode: parameters.raceModelMode,
    raceDurationSeconds: isTimed ? parameters.raceDurationSeconds ?? baseline.raceDurationSeconds ?? null : null,
    timedFinishRule: isTimed ? parameters.timedFinishRule ?? 'COMPLETE_CURRENT_LAP' : null,
    fieldVariabilityMode: isSynthetic ? parameters.fieldVariabilityMode : 'NOMINAL',
    fieldVariabilitySeed: isSeeded ? parameters.fieldVariabilitySeed ?? baseline.fieldVariabilitySeed ?? 42 : null,
    paceProfile: isTrafficAdjusted ? parameters.paceProfile ?? defaultCustom.paceProfile : null,
    trafficCostModel: isTrafficAdjusted ? parameters.trafficCostModel ?? defaultCustom.trafficCostModel : null,
  }
}

function isFieldDefault(parameters: SimulationRequest, baseline: SimulationRequest): boolean {
  return JSON.stringify(normalizedScenario(parameters, baseline)) === JSON.stringify(normalizedScenario(baseline, baseline))
}

export function App() {
  if (window.location.pathname === '/race-wall') return <RaceWall />
  const { data, error, loading } = useRaceIntelligence()
  const topology = useTrackTopology()
  // This is the one frontend-level source of truth for every configurable
  // scenario input.  A POST result is deliberately separate: it is only valid
  // for these exact inputs after RUN SCENARIO completes.
  const [activeScenario, setActiveScenario] = useState<SimulationRequest>(defaultCustom)
  const [customResult, setCustomResult] = useState<CustomSimulationResult | null>(null)
  const [customError, setCustomError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const [jokerResult, setJokerResult] = useState<JokerStrategyResult | null>(null)
  const [circleLiveState, setCircleLiveState] = useState<CircleLiveState | null>(null)
  const [comparison, setComparison] = useState<{ observed: CustomSimulationResult; synthetic: CustomSimulationResult } | null>(null)
  const [workspace, setWorkspace] = useState<'analysis' | 'event' | 'documentation'>('analysis')
  const baselineHydrated = useRef(false)
  const fieldMode = activeScenario.fieldMode
  const activeBaseline = data
    ? buildFieldDefault(fieldMode, data.summary.raceLaps, data.virtualMax.assumedAdvantageSecondsPerLap, data.summary.thresholds.p50)
    : buildUnavailableFieldDefault(fieldMode)

  useEffect(() => {
    if (!data || baselineHydrated.current) return
    setActiveScenario((current) => {
      const bootstrapBaseline = { ...defaultCustom, fieldMode: current.fieldMode }
      if (!isFieldDefault(current, bootstrapBaseline)) return current
      return buildFieldDefault(current.fieldMode, data.summary.raceLaps, data.virtualMax.assumedAdvantageSecondsPerLap, data.summary.thresholds.p50)
    })
    baselineHydrated.current = true
  }, [data])

  useEffect(() => {
    const baseline = data && buildSyntheticDefaultScenario(data.summary.raceLaps, data.virtualMax.assumedAdvantageSecondsPerLap, data.summary.thresholds.p50)
    if (!data || !baseline || fieldMode !== 'synthetic_100' || customResult || !isFieldDefault(activeScenario, baseline)) return
    const parameters = {
      raceLaps: data.summary.raceLaps,
      virtualMaxAdvantageSecondsPerLap: data.virtualMax.assumedAdvantageSecondsPerLap,
      startingDelaySeconds: baseline.startingDelaySeconds,
      simulations: data.summary.simulations,
    }
    let active = true
    runSimulation({ ...parameters, fieldMode: 'synthetic_100' }).then((synthetic) => {
      if (active) {
        setCustomResult(synthetic)
      }
    }).catch((requestError: unknown) => {
      if (active) setCustomError(requestError instanceof Error ? requestError.message : 'The synthetic stress test could not be completed.')
    })
    return () => { active = false }
  }, [activeScenario, customResult, data, fieldMode])

  const baselineCurve = useMemo(() => data ? [...data.curve].sort((a, b) => a.delaySeconds - b.delaySeconds) : [], [data])
  if (workspace === 'documentation') return <main className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-mark" aria-hidden="true" /><div><p>RACE INTELLIGENCE</p><span>Documentation &amp; Methodology</span></div></div>
      <WorkspaceNavigation workspace={workspace} onChange={setWorkspace} />
      <div className="team-lockup"><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /></div>
      <div className="system-state"><ShieldCheckIcon /><span>METHODS &amp; PROVENANCE</span></div>
    </header>
    <DocumentationPage />
  </main>
  if (workspace === 'event') return <main className="app-shell">
    <header className="topbar">
      <div className="brand-lockup"><span className="brand-mark" aria-hidden="true" /><div><p>RACE INTELLIGENCE</p><span>Race Operations</span></div></div>
      <WorkspaceNavigation workspace={workspace} onChange={setWorkspace} />
      <div className="team-lockup"><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /></div>
      <div className="system-state"><span className={data?.health.databaseReachable ? 'status-signal online' : 'status-signal'} aria-label={data?.health.databaseReachable ? 'Database reachable' : 'Database status unavailable'} /><Database size={15} /><span>ACTUAL EVENT</span></div>
    </header>
    <EventOperations modelledScenario={customResult?.fieldMode === 'synthetic_100' ? customResult : null} />
  </main>
  if (loading) return <LoadingState />
  if (error || !data || baselineCurve.length === 0 || data.drivers.length === 0) {
    return <main className="app-shell">
      <header className="topbar"><div className="brand-lockup"><span className="brand-mark" aria-hidden="true" /><div><p>RACE INTELLIGENCE</p><span>Virtual Max timing-catch simulator</span></div></div><WorkspaceNavigation workspace={workspace} onChange={setWorkspace} /><div className="team-lockup"><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /></div></header>
      <FieldModeSelector value={fieldMode} onChange={changeFieldMode} />
      <CustomScenarioConsole parameters={activeScenario} onChange={updateActiveScenario} onRun={runCustomScenario} onReset={resetToBaseline} isRunning={running} hasResult={false} fieldMode={fieldMode} isDirty error={customError ?? error} />
      <section className="scenario-error" role="alert"><p className="eyebrow">Simulation unavailable</p><strong>The dynamic simulation service is not currently ready.</strong><p>{customError ?? error ?? 'Governed baseline data is unavailable. You can keep editing inputs and retry Run Scenario.'}</p></section>
    </main>
  }

  const baseline = activeBaseline
  const scenario = customResult?.fieldMode === fieldMode ? customResult : null
  const activeScenarioIsCustom = !isFieldDefault(activeScenario, baseline)
  const scenarioDirty = activeScenarioIsCustom && !scenario
  const scenarioStatus = activeScenarioIsCustom
    ? 'CUSTOM WHAT-IF'
    : fieldMode === 'historical' ? 'GOVERNED BASELINE' : 'DEFAULT SCENARIO'
  const summary = scenario ? {
    supportedFieldSize: scenario.drivers.length,
    raceLaps: scenario.raceLaps,
    simulations: scenario.simulations,
    deterministicMaxDelaySeconds: scenario.deterministicMaxDelaySeconds,
    probabilityAtZeroDelay: scenario.probabilityCurve.find((point) => point.delaySeconds === 0)?.catchProbability ?? 0,
    thresholds: scenario.thresholds,
  } : data.summary
  const curve = scenario ? scenario.probabilityCurve : baselineCurve
  const virtualMaxPace = scenario ? scenario.virtualMaxPace : data.virtualMax.virtualMaxPaceSeconds
  const assumedAdvantage = scenario ? scenario.virtualMaxAdvantageSecondsPerLap : data.virtualMax.assumedAdvantageSecondsPerLap
  const fastestObserved = scenario ? scenario.fastestObservedPace : data.drivers[0].pooledMedianPace
  const delay = scenario ? scenario.startingDelaySeconds : activeScenario.startingDelaySeconds
  const catchProbability = scenario ? scenario.fullFieldCatchProbability : interpolateProbability(delay, curve)
  const timing = scenario?.timing ?? deriveFixedLapTiming({
    raceLaps: summary.raceLaps,
    virtualMaxPace,
    startingDelaySeconds: delay,
    driverPaces: data.drivers.map((driver) => driver.pooledMedianPace),
  })
  const scenarioIdentifier = scenario ? `${scenario.fieldEvidenceType === 'SYNTHETIC' ? 'SYNTHETIC STRESS TEST' : 'OBSERVED FIELD'} · ${scenario.fieldSize} DRIVERS` : fieldMode === 'synthetic_100' ? 'SYNTHETIC STRESS TEST · 100 DRIVERS' : `OBSERVED FIELD · ${data.summary.supportedFieldSize} DRIVERS`
  const minDelay = curve[0]?.delaySeconds ?? -10
  const maxDelay = curve[curve.length - 1]?.delaySeconds ?? 10
  const quickTargets = [
    { label: 'P90', value: summary.thresholds.p90 },
    { label: 'P80', value: summary.thresholds.p80 },
    { label: 'P50', value: summary.thresholds.p50 },
    { label: '0 s', value: 0 },
    { label: 'Deterministic', value: summary.deterministicMaxDelaySeconds },
  ].filter((target): target is { label: string; value: number } => target.value !== null)
  const activeReplay = {
    label: scenarioStatus,
    requestedLaps: activeScenario.raceFormat === 'TIMED_RACE'
      ? Math.max(1, scenario?.raceLaps ?? activeScenario.raceLaps ?? data.summary.raceLaps)
      : activeScenario.raceLaps ?? data.summary.raceLaps,
    advantage: activeScenario.virtualMaxAdvantageSecondsPerLap,
    virtualMaxPace: data.virtualMax.referencePaceSeconds - activeScenario.virtualMaxAdvantageSecondsPerLap,
    startingDelaySeconds: activeScenario.startingDelaySeconds,
    custom: activeScenarioIsCustom,
  }

  async function runCustomScenario() {
    const validation = validateSimulationRequest(activeScenario)
    const runButtonDisabled = running || !validation.formValid
    if (import.meta.env.DEV) console.info('[simulation] run clicked', {
      fieldMode,
      raceLaps: activeScenario.raceLaps,
      virtualMaxAdvantageSecondsPerLap: activeScenario.virtualMaxAdvantageSecondsPerLap,
      startingDelaySeconds: activeScenario.startingDelaySeconds,
      simulations: activeScenario.simulations,
      ...validation,
      runButtonDisabled,
    })
    if (!validation.formValid || running) return
    setRunning(true)
    setCustomError(null)
    try {
      const syntheticRequest = { ...activeScenario, fieldMode: 'synthetic_100' as const }
      if (activeScenario.fieldVariabilityMode === 'HISTORICAL_SEEDED') {
        const synthetic = await runSimulation(syntheticRequest)
        setComparison(null)
        setCustomResult(synthetic)
      } else {
        const observedRequest = { ...activeScenario, fieldMode: 'historical' as const }
        const [observed, synthetic] = await Promise.all([runSimulation(observedRequest), runSimulation(syntheticRequest)])
        setComparison({ observed, synthetic })
        setCustomResult(fieldMode === 'synthetic_100' ? synthetic : observed)
      }
    } catch (requestError) {
      setCustomResult(null)
      setCustomError(simulationErrorMessage(requestError))
    } finally {
      setRunning(false)
    }
  }

  function updateActiveScenario(parameters: SimulationRequest) {
    const next = parameters.fieldVariabilityMode === 'HISTORICAL_SEEDED'
      ? { ...parameters, fieldMode: 'synthetic_100' as const }
      : parameters
    setActiveScenario(next)
    setCustomResult(null)
    setCustomError(null)
    setComparison(null)
  }

  function changeFieldMode(nextFieldMode: FieldMode) {
    setCustomResult(null)
    setComparison(null)
    setCustomError(null)
    setActiveScenario(data
      ? buildFieldDefault(nextFieldMode, data.summary.raceLaps, data.virtualMax.assumedAdvantageSecondsPerLap, data.summary.thresholds.p50)
      : buildUnavailableFieldDefault(nextFieldMode))
  }

  function resetToBaseline() {
    setActiveScenario(activeBaseline)
    setCustomResult(null)
    setComparison(null)
    setCustomError(null)
    setJokerResult(null)
    setCircleLiveState(null)
  }

  function updateExplorerDelay(startingDelaySeconds: number) {
    updateActiveScenario({ ...activeScenario, startingDelaySeconds })
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup"><span className="brand-mark" aria-hidden="true" /><div><p>RACE INTELLIGENCE</p><span>Virtual Max timing-catch simulator</span></div></div>
        <WorkspaceNavigation workspace={workspace} onChange={setWorkspace} />
        <div className="team-lockup"><img src="/assets/race-intelligence.svg" alt="Race Intelligence" /></div>
        <div className="system-state"><span className={data.health.databaseReachable ? 'status-signal online' : 'status-signal'} aria-label={data.health.databaseReachable ? 'Database reachable' : 'Database unavailable'} /><Database size={15} /><span>GOVERNED AIDP GOLD</span></div>
      </header>

      <FieldModeSelector value={fieldMode} onChange={changeFieldMode} />

      <section className="hero-grid" aria-labelledby="page-title">
        <div className="hero-copy">
          <p className="eyebrow">FIELD · {fieldMode === 'historical' ? 'OBSERVED 16' : 'SYNTHETIC 100'} · STATUS · {scenarioStatus}</p>
          <h1 id="page-title">Virtual Max <InfoTooltip label="Virtual Max" definitionId="virtual-max" /></h1>
          <p className="hero-subtitle">How late can Virtual Max start and still catch the entire supported field before the end of the race?</p>
          <div className="synthetic-stamp"><Activity size={15} /> {fieldMode === 'synthetic_100' ? 'SYNTHETIC FIELD · STRESS TEST · NOT HISTORICAL' : activeScenarioIsCustom ? 'CUSTOM WHAT-IF · ACTIVE INPUTS' : 'HISTORICAL EVIDENCE · GOVERNED REFERENCE'}</div>
          <p className="caveat">Timing catch only. Not a physical overtake model.</p>
        </div>
        <div className="hero-result">
          <div className="result-heading"><span>DETERMINISTIC <InfoTooltip label="Deterministic Limit" definitionId="deterministic-limit" /></span><Timer size={18} /></div>
          <strong>{signedSeconds(summary.deterministicMaxDelaySeconds)}</strong><p>{scenarioDirty ? 'Governed reference · changes not yet run' : 'Maximum delayed start'}</p>
          <div className="hero-meta"><span>{scenarioIdentifier}</span><span>{summary.raceLaps} laps</span></div>
        </div>
        <div className="hero-telemetry">
          <div><span>VIRTUAL MAX PACE <InfoTooltip label="Virtual Max Pace" definitionId="virtual-max" /></span><strong>{pace(virtualMaxPace)}</strong></div>
          <div><span>ASSUMED ADVANTAGE</span><strong>{signedSeconds(assumedAdvantage, 3)}/lap</strong></div>
          <div><span>MONTE CARLO RUNS <InfoTooltip label="Monte Carlo" definitionId="catch-probability" /></span><strong>{summary.simulations.toLocaleString()}</strong></div>
        </div>
      </section>

      <section className="race-completion-grid" aria-label="Race completion estimates">
        <article className="projected-finish-kpi">
          <span>PROJECTED MAX FINISH</span>
          <strong>{formatRaceTime(timing.projectedFinishTimeSeconds)}</strong>
          <p>Deterministic projected race completion</p>
          <small>{timing.projectedFinishLap} LAPS · {pace(virtualMaxPace).toUpperCase()} · {signedSeconds(delay, 2).toUpperCase()} START DELAY</small>
        </article>
        <article className="full-field-catch-kpi">
          <span>FULL-FIELD TIMING CATCH <InfoTooltip label="Timing Catch" definitionId="timing-catch" /></span>
          <strong>{timing.fullFieldCaught && timing.fullFieldCatchTimeSeconds !== null ? formatRaceTime(timing.fullFieldCatchTimeSeconds) : 'NOT CAUGHT'}</strong>
          <p>Final timing catch in selected scenario{timing.fullFieldCatchLap === null ? '' : ` · LAP ${timing.fullFieldCatchLap}`}</p>
        </article>
      </section>

      <section className="scenario-summary" aria-label="Active scenario summary">
        <span>ACTIVE CONFIGURATION</span><strong>{fieldMode === 'historical' ? 'OBSERVED 16' : 'SYNTHETIC 100'} · {scenarioStatus}</strong>
        <span>{activeScenario.raceFormat === 'TIMED_RACE' ? `${Math.round((activeScenario.raceDurationSeconds ?? 3600) / 60)} MIN` : `${activeScenario.raceLaps} LAPS`}</span>
        <span>{activeScenario.raceModelMode === 'TRAFFIC_ADJUSTED' ? 'TRAFFIC ADJUSTED' : 'PURE TIMING'}</span>
        {fieldMode === 'synthetic_100' && activeScenario.fieldVariabilityMode === 'HISTORICAL_SEEDED' ? <span>HISTORICAL SEEDED · SEED {activeScenario.fieldVariabilitySeed ?? 42}</span> : null}
        <span>VM {signedSeconds(activeScenario.virtualMaxAdvantageSecondsPerLap, 3)}/LAP</span><span>{signedSeconds(activeScenario.startingDelaySeconds, 2)} START</span>
      </section>

      <CustomScenarioConsole parameters={activeScenario} onChange={updateActiveScenario} onRun={runCustomScenario} onReset={resetToBaseline} isRunning={running} hasResult={Boolean(scenario)} fieldMode={fieldMode} isDirty={scenarioDirty} error={customError} />

      {scenarioDirty ? <section className="custom-empty panel" role="status"><p className="eyebrow">Changes not yet run</p><h2>Active inputs are applied to replay only.</h2><p>Run Scenario to publish authoritative scenario KPIs, field order and model outputs. Governed Monte Carlo remains a reference curve until it is explicitly recomputed.</p></section> : null}
      {fieldMode === 'synthetic_100' && !scenario && !scenarioDirty && !customError ? <section className="custom-empty panel"><p className="eyebrow">Synthetic stress test</p><h2>Calculating default scenario.</h2><p>The 100-driver field is transient and synthetic; observed evidence remains separate.</p></section> : null}
      {customError ? <section className="scenario-error" role="alert"><p className="eyebrow">Simulation unavailable</p><strong>Custom result was not substituted with reference data.</strong><p>{customError}</p></section> : null}
      <section className="simulator panel" aria-labelledby="simulator-title">
        <div className="simulator-head"><div><p className="eyebrow">Start delay analysis · active input</p><h2 id="simulator-title">Start delay explorer</h2></div></div>
        <div className="delay-readout"><div><span>START DELAY <InfoTooltip label="Start Delay" definitionId="start-delay" /></span><strong>{signedSeconds(delay, 1)}</strong><p>{delayInterpretation(delay)}</p></div><div><span>FULL-FIELD CATCH PROBABILITY <InfoTooltip label="Catch Probability" definitionId="catch-probability" /></span><strong>{probability(catchProbability)}</strong><p>Derived from governed Monte Carlo curve</p></div></div>
        <label className="sr-only" htmlFor="delay-slider">Starting delay in seconds</label>
        <input id="delay-slider" className="delay-slider" type="range" min={minDelay} max={maxDelay} step="0.1" value={delay} aria-valuetext={`${signedSeconds(delay, 1)}. ${delayInterpretation(delay)}`} onChange={(event) => updateExplorerDelay(Number(event.target.value))} />
        <div className="slider-scale"><span>{signedSeconds(minDelay, 0)}</span><span>0 s</span><span>{signedSeconds(maxDelay, 1)}</span></div>
        <div className="quick-targets" aria-label="Scenario delay shortcuts">{quickTargets.map((target) => <button type="button" key={target.label} onClick={() => updateExplorerDelay(target.value)} className={Math.abs(delay - target.value) < 0.05 ? 'active' : ''}>{target.label}<small>{signedSeconds(target.value, 1)}</small></button>)}</div>
      </section>

      <ProbabilityChart curve={curve} summary={summary} activeDelay={delay} trafficAdjusted={scenario?.raceModel?.mode === 'TRAFFIC_ADJUSTED'} historicalSeeded={scenario?.fieldVariability?.mode === 'HISTORICAL_SEEDED'} timedRace={scenario?.raceFormat?.mode === 'TIMED_RACE'} referenceOnly={!scenario || scenarioDirty} />
      {(!scenarioDirty && (fieldMode === 'historical' || scenario)) ? <>
        <section className="threshold-grid" aria-label="Confidence thresholds">
          {[{ label: 'P50', value: summary.thresholds.p50, note: 'Delayed start possible', definitionId: 'p50' as const }, { label: 'P80', value: summary.thresholds.p80, note: 'Head start required', definitionId: 'p80' as const }, { label: 'P90', value: summary.thresholds.p90, note: 'Head start required', definitionId: 'p90' as const }].map((threshold) => <article className="threshold-card" key={threshold.label}><span>{threshold.label} <InfoTooltip label={threshold.label} definitionId={threshold.definitionId} /></span><strong>{signedSeconds(threshold.value)}</strong><p>{threshold.value !== null && threshold.value >= 0 ? 'Delayed start possible' : threshold.note}</p></article>)}
        </section>
        <section className="analysis-grid">
          <DeterministicChase raceLaps={summary.raceLaps} deterministicDelay={summary.deterministicMaxDelaySeconds} fastestObservedPace={fastestObserved} virtualMaxPace={virtualMaxPace} />
          {scenario ? <ChaseOrder drivers={scenario.drivers} /> : null}
        </section>
        {scenario?.fieldEvidenceType === 'SYNTHETIC' ? <SyntheticField drivers={scenario.drivers} /> : null}
        {comparison?.observed.fieldMode === 'historical' && comparison.synthetic.fieldMode === 'synthetic_100' ? <FieldComparison observed={comparison.observed} synthetic={comparison.synthetic} /> : null}
      </> : null}

      {fieldMode === 'historical' ? <TimingTower drivers={data.drivers} scenarioDrivers={scenario?.fieldEvidenceType === 'OBSERVED' ? scenario.drivers : undefined} /> : null}

      <TrackReplay fieldMode={fieldMode} activeScenario={activeReplay} customScenario={scenario?.fieldMode === 'historical' ? scenario : null} syntheticScenario={fieldMode === 'synthetic_100' ? scenario : null} baselineSummary={data.summary} baselineVirtualMax={data.virtualMax} onSyntheticLiveState={setCircleLiveState} />
      {scenario ? <><JokerStrategy scenario={scenario} onResult={setJokerResult} />{topology ? <CircleOfDoom topology={topology} live={circleLiveState} joker={jokerResult} /> : null}<JokerComparison scenario={scenario} onSelect={setJokerResult} /></> : null}
      {scenario ? <RaceModelComparison scenario={scenario} /> : null}
      {scenario?.fieldMode === 'synthetic_100' ? <SyntheticComparativeAnalytics scenario={scenario} historicalFieldSize={data.summary.supportedFieldSize} trackLengthMeters={topology?.mainRoute.lengthMeters ?? null} /> : null}

      <section className="method-strip" aria-label="Methodology">
        <div><span>HISTORICAL <InfoTooltip label="Historical source IDs">Driver IDs are categorical identifiers from the supplied dataset and are not mapped to real-world driver identities.</InfoTooltip></span><strong>Supplied timing data</strong><p>Observed profiles remain historical evidence.</p></div>
        <div><span>SCENARIO</span><strong>Virtual Max</strong><p>Synthetic WHAT-IF profile only.</p></div>
        <div><span>UNCERTAINTY <InfoTooltip label="Centered variability">Historical lap deviations are centered around zero before simulation so uncertainty does not systematically speed up or slow down the field.</InfoTooltip></span><strong>{summary.simulations.toLocaleString()} simulations</strong><p>Centered historical field variability.</p></div>
        <div><span>OUTPUT <InfoTooltip label="Timing catch">Timing gap reaches zero. This does not guarantee a physical on-track overtake.</InfoTooltip></span><strong>Timing catch probability</strong><p>Not physical overtaking.</p></div>
      </section>
      <footer><Gauge size={16} /><p>Virtual Max is a synthetic scenario profile and does not represent measured Max Verstappen performance. Historical IDs are categorical source identifiers. This timing-catch model excludes traffic, defence, DRS, tyres, pit stops and safety cars.</p></footer>
    </main>
  )
}

function ShieldCheckIcon() { return <ShieldCheck size={15} aria-hidden="true" /> }

function WorkspaceNavigation({ workspace, onChange }: { workspace: 'analysis' | 'event' | 'documentation'; onChange: (workspace: 'analysis' | 'event' | 'documentation') => void }) {
  return <nav className="workspace-navigation" aria-label="Product area">
    <button type="button" className={workspace === 'analysis' ? 'active' : ''} aria-pressed={workspace === 'analysis'} onClick={() => onChange('analysis')}>RACE ANALYSIS</button>
    <button type="button" className={workspace === 'event' ? 'active' : ''} aria-pressed={workspace === 'event'} onClick={() => onChange('event')}>EVENT <span>RACE OPERATIONS</span></button>
    <button type="button" className={workspace === 'documentation' ? 'active' : ''} aria-pressed={workspace === 'documentation'} onClick={() => onChange('documentation')}>DOCUMENTATION</button>
    <a className="workspace-race-wall" href="/race-wall"><MonitorUp size={14} /> RACE WALL</a>
  </nav>
}
