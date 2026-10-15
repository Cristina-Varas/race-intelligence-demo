import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import type { CustomSimulationResult, RaceIntelligenceData } from './types/raceIntelligence'

const api = vi.hoisted(() => ({ runSimulation: vi.fn(), fetchTrackReplay: vi.fn() }))
const raceHook = vi.hoisted(() => ({ state: null as { data: RaceIntelligenceData | null; error: string | null; loading: boolean } | null }))

vi.mock('./api/raceIntelligence', () => ({ runSimulation: api.runSimulation, fetchTrackReplay: api.fetchTrackReplay }))

vi.mock('./components/TrackReplay', () => ({
  TrackReplay: ({ activeScenario, fieldMode }: { activeScenario?: { requestedLaps: number; advantage: number; startingDelaySeconds: number }; fieldMode: string }) => <div data-testid="track-replay-scenario">{activeScenario ? `${fieldMode}/${activeScenario.requestedLaps}/${activeScenario.advantage}/${activeScenario.startingDelaySeconds}` : 'BASELINE'}</div>,
}))

const data: RaceIntelligenceData = {
  health: { status: 'ok', databaseConfigured: true, databaseReachable: true },
  summary: {
    supportedFieldSize: 16,
    raceLaps: 30,
    simulations: 5000,
    deterministicMaxDelaySeconds: 5.85,
    probabilityAtZeroDelay: 0.5812,
    thresholds: { p50: 1.5, p80: -4.5, p90: -7.8 },
  },
  curve: [{ delaySeconds: -4.5, catchProbability: 0.8 }, { delaySeconds: 0, catchProbability: 0.5812 }, { delaySeconds: 1.5, catchProbability: 0.5 }, { delaySeconds: 5.85, catchProbability: 0.1 }],
  virtualMax: {
    scenarioDriverId: 'VIRTUAL_MAX', referenceDriverId: 13, referencePaceSeconds: 80.293,
    assumedAdvantageSecondsPerLap: 0.195, virtualMaxPaceSeconds: 80.098,
    scenarioType: 'SYNTHETIC', label: 'WHAT-IF', historicalStatus: 'NOT HISTORICAL',
  },
  drivers: [{ driverId: 13, pooledValidLaps: 26, pooledMedianPace: 80.293, pooledMad: 2.876, supportStatus: 'sufficient' }],
}

vi.mock('./hooks/useRaceIntelligence', () => ({
  useRaceIntelligence: () => raceHook.state,
}))

vi.mock('./hooks/useTrackTopology', () => ({
  useTrackTopology: () => ({ mainRoute: { lengthMeters: 2448.0699568362184 } }),
}))

vi.mock('./components/ProbabilityChart', () => ({ ProbabilityChart: () => <div>Probability chart</div> }))
vi.mock('./components/DeterministicChase', () => ({ DeterministicChase: () => <div>Deterministic chase</div> }))
vi.mock('./components/ChaseOrder', () => ({ ChaseOrder: () => <div>Chase order</div> }))
vi.mock('./components/TimingTower', () => ({ TimingTower: () => <div>Timing tower</div> }))
vi.mock('./components/SyntheticField', () => ({ SyntheticField: () => <div>Synthetic field</div> }))
vi.mock('./components/FieldComparison', () => ({ FieldComparison: () => <div>Independent field comparison</div> }))
vi.mock('./components/EventOperations', () => ({ EventOperations: () => <div>Event operations workspace</div> }))

import { App } from './App'

const observed: CustomSimulationResult = {
  mode: 'custom', scenarioType: 'SYNTHETIC WHAT-IF', fieldMode: 'historical', fieldLabel: 'Observed historical field',
  fieldSize: 16, fieldEvidenceType: 'OBSERVED', raceLaps: 30, simulations: 5000, fastestObservedPace: 80.293,
  virtualMaxAdvantageSecondsPerLap: 0.195, virtualMaxPace: 80.098, startingDelaySeconds: 1.5,
  deterministicMaxDelaySeconds: 5.85, fullFieldCatchProbability: 0.5,
  thresholds: { p50: 1.5, p80: -4.5, p90: -7.8 }, probabilityCurve: [{ delaySeconds: 0, catchProbability: 0.5 }],
  drivers: [], timing: { raceFormat: 'FIXED_LAP', projectedFinishTimeSeconds: 2404.44, projectedFinishLap: 30, fullFieldCatchTimeSeconds: 618.4, fullFieldCatchLap: 8, fullFieldCaught: true }, caveats: [],
}

const synthetic: CustomSimulationResult = {
  ...observed,
  fieldMode: 'synthetic_100', fieldLabel: 'Synthetic 100-driver stress test', fieldSize: 100,
  fieldEvidenceType: 'SYNTHETIC', fullFieldCatchProbability: 0.0468,
  thresholds: { p50: -7.2, p80: -11.4, p90: -13.5 }, drivers: [],
}

beforeEach(() => {
  raceHook.state = { data, error: null, loading: false }
})

afterEach(() => {
  cleanup()
  api.runSimulation.mockReset()
})

describe('Two-field scenario information architecture', () => {
  it('keeps Race Operations separate from the analysis field modes', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /event race operations/i }))
    expect(screen.getByText('Event operations workspace')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /observed 16/i })).toBeNull()
    await user.click(within(screen.getByRole('navigation', { name: /product area/i })).getByRole('button', { name: /^race analysis$/i }))
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
  })

  it('opens Documentation without changing the Race Analysis scenario workspace', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /^documentation$/i }))
    expect(screen.getByRole('heading', { name: /^Race Intelligence Documentation$/i })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /observed 16/i })).toBeNull()
    await user.click(within(screen.getByRole('navigation', { name: /product area/i })).getByRole('button', { name: /^race analysis$/i }))
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
  })

  it('shows Observed 16 as the governed default with one Scenario Controls owner', async () => {
    render(<App />)

    expect(await screen.findByText('40:04.4')).toBeTruthy()
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
    expect(screen.getByText('Scenario controls')).toBeTruthy()
    expect(screen.getAllByLabelText('Starting delay in seconds')).toHaveLength(1)
    expect(screen.queryByRole('navigation', { name: /scenario mode/i })).toBeNull()
    expect(screen.queryByRole('button', { name: /run scenario/i })).toBeNull()
    expect(screen.getByTestId('track-replay-scenario').textContent).toContain('historical/30/0.195/1.5')
  })

  it('keeps an Observed custom WHAT-IF in the same field experience until it is run', async () => {
    render(<App />)
    await screen.findByText('Start delay explorer')
    fireEvent.change(screen.getByLabelText('Starting delay in seconds'), { target: { value: '0' } })
    expect(screen.getByText('Changes not yet run')).toBeTruthy()
    expect(screen.getAllByText(/OBSERVED 16 · CUSTOM WHAT-IF/i).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: /run scenario/i })).toBeTruthy()
    expect(screen.getByTestId('track-replay-scenario').textContent).toContain('historical/30/0.195/0')
    fireEvent.click(screen.getAllByRole('button', { name: /reset to governed baseline/i })[0])
    expect(screen.getByTestId('track-replay-scenario').textContent).toContain('historical/30/0.195/1.5')
  })

  it('returns to the governed Observed baseline when a user manually restores the baseline delay', async () => {
    render(<App />)
    const delay = screen.getByLabelText('Starting delay in seconds')
    fireEvent.change(delay, { target: { value: '0' } })
    expect(screen.getByText('Changes not yet run')).toBeTruthy()
    fireEvent.change(delay, { target: { value: '1.5' } })
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
    expect(screen.queryByText('Changes not yet run')).toBeNull()
    expect(screen.queryByRole('button', { name: /run scenario/i })).toBeNull()
  })

  it('shows Synthetic 100 as a default stress test and never presents a historical tower as synthetic evidence', async () => {
    api.runSimulation.mockResolvedValueOnce(synthetic)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /synthetic 100/i }))
    expect(await screen.findByText(/SYNTHETIC 100 · DEFAULT SCENARIO/i)).toBeTruthy()
    expect(screen.getByTestId('track-replay-scenario').textContent).toContain('synthetic_100/30/0.195/1.5')
    expect(screen.queryByText('Timing tower')).toBeNull()
  })

  it('does not carry Synthetic-only state back into an untouched Observed baseline', async () => {
    api.runSimulation.mockResolvedValueOnce(synthetic)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /synthetic 100/i }))
    await user.click(screen.getByRole('button', { name: /observed 16/i }))
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
    expect(screen.queryByText('Changes not yet run')).toBeNull()
    expect(screen.queryByRole('button', { name: /run scenario/i })).toBeNull()
  })

  it('switches from a dirty Observed WHAT-IF to the independent Synthetic default', async () => {
    api.runSimulation.mockResolvedValue(synthetic)
    const user = userEvent.setup()
    render(<App />)
    fireEvent.change(screen.getByLabelText('Starting delay in seconds'), { target: { value: '0' } })
    expect(screen.getAllByText(/OBSERVED 16 · CUSTOM WHAT-IF/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /synthetic 100/i }))
    expect(await screen.findByText(/SYNTHETIC 100 · DEFAULT SCENARIO/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /synthetic 100/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('switches from a dirty Synthetic WHAT-IF back to the governed Observed baseline', async () => {
    api.runSimulation.mockResolvedValue(synthetic)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /synthetic 100/i }))
    await user.click(screen.getByText('ADVANCED RACE ASSUMPTIONS'))
    await user.click(screen.getByRole('button', { name: /historical seeded/i }))
    expect(screen.getAllByText(/SYNTHETIC 100 · CUSTOM WHAT-IF/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /observed 16/i }))
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
    expect(screen.getByRole('button', { name: /observed 16/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('keeps both field tabs selectable through repeated toggles and mode-local resets', async () => {
    api.runSimulation.mockResolvedValue(synthetic)
    const user = userEvent.setup()
    render(<App />)
    const syntheticTab = screen.getByRole('button', { name: /synthetic 100/i })
    const observedTab = screen.getByRole('button', { name: /observed 16/i })

    await user.click(syntheticTab)
    expect(await screen.findByText(/SYNTHETIC 100 · DEFAULT SCENARIO/i)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: /reset to default scenario/i })[0])
    expect(syntheticTab.getAttribute('aria-pressed')).toBe('true')
    await user.click(observedTab)
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
    await user.click(screen.getAllByRole('button', { name: /reset to governed baseline/i })[0])
    expect(observedTab.getAttribute('aria-pressed')).toBe('true')
    await user.click(syntheticTab)
    expect(await screen.findByText(/SYNTHETIC 100 · DEFAULT SCENARIO/i)).toBeTruthy()
    await user.click(observedTab)
    expect(screen.getByText(/OBSERVED 16 · GOVERNED BASELINE/i)).toBeTruthy()
  })

  it('keeps field tabs functional when governed data is temporarily unavailable', async () => {
    raceHook.state = { data: null, error: 'Governed race data could not be loaded.', loading: false }
    const user = userEvent.setup()
    render(<App />)
    const syntheticTab = screen.getByRole('button', { name: /synthetic 100/i })
    await user.click(syntheticTab)
    expect(syntheticTab.getAttribute('aria-pressed')).toBe('true')
    await user.click(screen.getByRole('button', { name: /observed 16/i }))
    expect(screen.getByRole('button', { name: /observed 16/i }).getAttribute('aria-pressed')).toBe('true')
  })

  it('runs an Observed custom scenario only after the active inputs become dirty', async () => {
    api.runSimulation.mockResolvedValueOnce(observed).mockResolvedValueOnce(synthetic)
    render(<App />)
    fireEvent.change(screen.getByLabelText('Starting delay in seconds'), { target: { value: '0' } })
    const runButton = screen.getByRole('button', { name: /run scenario/i })
    expect((runButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(runButton)
    await waitFor(() => expect(api.runSimulation).toHaveBeenCalledTimes(2))
    expect(api.runSimulation).toHaveBeenNthCalledWith(1, expect.objectContaining({
      raceLaps: 30, virtualMaxAdvantageSecondsPerLap: 0.195, startingDelaySeconds: 0,
      simulations: 5000, fieldMode: 'historical',
    }))
    expect(api.runSimulation).toHaveBeenNthCalledWith(2, expect.objectContaining({ fieldMode: 'synthetic_100' }))
    expect(await screen.findByText('CURRENT RESULT READY')).toBeTruthy()
    expect(screen.getByText('OBSERVED FIELD · 16 DRIVERS')).toBeTruthy()
    expect(screen.getByText('40:04.4')).toBeTruthy()
    expect(screen.getByTestId('track-replay-scenario').textContent).toBe('historical/30/0.195/0')
    fireEvent.change(screen.getAllByRole('slider')[0], { target: { value: '20' } })
    expect(screen.getByTestId('track-replay-scenario').textContent).toBe('historical/20/0.195/0')
  })

  it('keeps controls and an enabled retry button after a simulation API failure', async () => {
    api.runSimulation.mockRejectedValue(new Error('Request to http://127.0.0.1:8003/api/simulation/run failed.'))
    render(<App />)
    fireEvent.change(screen.getByLabelText('Starting delay in seconds'), { target: { value: '0' } })
    const runButton = screen.getByRole('button', { name: /run scenario/i })
    fireEvent.click(runButton)
    expect(await screen.findByText(/custom result was not substituted with reference data/i)).toBeTruthy()
    expect(screen.getByTestId('track-replay-scenario').textContent).toBe('historical/30/0.195/0')
    expect(screen.getByText('RACE LENGTH')).toBeTruthy()
    expect((runButton as HTMLButtonElement).disabled).toBe(false)

    fireEvent.click(runButton)
    await waitFor(() => expect(api.runSimulation).toHaveBeenCalledTimes(4))
  })

  it('keeps Synthetic 100 custom assumptions in its field experience and runs only its authoritative request when seeded', async () => {
    api.runSimulation.mockResolvedValueOnce(synthetic).mockResolvedValueOnce(synthetic)
    const user = userEvent.setup()
    render(<App />)
    await user.click(screen.getByRole('button', { name: /synthetic 100/i }))
    await user.click(screen.getByText('ADVANCED RACE ASSUMPTIONS'))
    await user.click(screen.getByRole('button', { name: /historical seeded/i }))
    expect(screen.getAllByText(/SYNTHETIC 100 · CUSTOM WHAT-IF/i).length).toBeGreaterThan(0)
    await user.click(screen.getByRole('button', { name: /run scenario/i }))
    await waitFor(() => expect(api.runSimulation).toHaveBeenCalledTimes(2))
    expect(api.runSimulation).toHaveBeenLastCalledWith(expect.objectContaining({ fieldMode: 'synthetic_100', fieldVariabilityMode: 'HISTORICAL_SEEDED', fieldVariabilitySeed: 42 }))
  })
})
