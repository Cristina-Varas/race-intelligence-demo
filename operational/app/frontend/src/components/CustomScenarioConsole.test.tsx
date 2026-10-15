import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { CustomScenarioConsole } from './CustomScenarioConsole'

const parameters = { raceLaps: 30, virtualMaxAdvantageSecondsPerLap: 0.195, startingDelaySeconds: 1.5, simulations: 5000, fieldMode: 'synthetic_100' as const }

describe('CustomScenarioConsole', () => {
  it('renders the single Scenario Controls panel and leaves Start Delay to its linked explorer', () => {
    const html = renderToStaticMarkup(<CustomScenarioConsole parameters={parameters} onChange={vi.fn()} onRun={vi.fn()} onReset={vi.fn()} isRunning={false} hasResult={false} isDirty />)
    for (const label of ['Scenario controls', 'RACE LENGTH', 'VIRTUAL MAX GAIN', 'RUN SCENARIO', 'RESET TO DEFAULT SCENARIO']) expect(html).toContain(label)
    expect(html).toContain('START DELAY is edited once in Start Delay Analysis')
    expect(html).not.toContain('CURRENT RESULT READY')
  })

  it('keeps Run Scenario available after a failed attempt when no request is running', () => {
    const html = renderToStaticMarkup(<CustomScenarioConsole parameters={parameters} onChange={vi.fn()} onRun={vi.fn()} onReset={vi.fn()} isRunning={false} hasResult={false} error="Request failed" />)
    expect(html).toContain('RUN SCENARIO')
    expect(html).not.toContain('disabled')
  })

  it('shows editable traffic assumptions only for the Traffic Adjusted model', () => {
    const adjusted = { ...parameters, raceModelMode: 'TRAFFIC_ADJUSTED' as const, paceProfile: [{ startLap: 1, endLap: 5, paceAdjustmentPercent: 1.5 }, { startLap: 6, endLap: null, paceAdjustmentPercent: -2 }], trafficCostModel: { enabled: true, earlyCostSecondsPerKart: 1, lateCostSecondsPerKart: .2, transitionStartLap: 1, transitionEndLap: 7, interpolation: 'LINEAR' as const } }
    const html = renderToStaticMarkup(<CustomScenarioConsole parameters={adjusted} onChange={vi.fn()} onRun={vi.fn()} onReset={vi.fn()} isRunning={false} hasResult={false} />)
    expect(html).toContain('PURE TIMING')
    expect(html).toContain('TRAFFIC ADJUSTED')
    expect(html).toContain('EARLY TRAFFIC COST')
    expect(html).toContain('LATE TRAFFIC COST')
  })
})
