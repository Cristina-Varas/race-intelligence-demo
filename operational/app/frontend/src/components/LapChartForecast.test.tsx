import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { LapChartForecast, lapChartPath, lapChartX, lapChartY } from './LapChartForecast'
import type { CustomSimulationResult } from '../types/raceIntelligence'

const scenario = { raceLaps: 3, virtualMaxPace: 80, startingDelaySeconds: 1.5, timing: { fullFieldCaught: true, fullFieldCatchLap: 2 }, syntheticReplay: { scenarioId: 'active-scenario', populationId: 'bootstrap_bounded_v1:seed=42', raceLaps: 3, entities: [
  { driverId: 'SYN_001', paceSecondsPerLap: 80.5, gridPosition: 1, gridOffsetMeters: 400, entityType: 'synthetic' },
  { driverId: 'SYN_002', paceSecondsPerLap: 81, gridPosition: 2, gridOffsetMeters: 5, entityType: 'synthetic' },
] } } as unknown as CustomSimulationResult

describe('LapChartForecast', () => {
  it('renders active-scenario trajectories, current lap, KPI catch marker and selected driver interaction', () => {
    const onSelect = vi.fn()
    const { container } = render(<LapChartForecast scenario={scenario} currentReplayProgress={1.25} currentVmRank={2} selectedDriverId="SYN_001" nextTargetId="SYN_002" onSelect={onSelect} />)
    expect(screen.getByRole('heading', { name: 'Lap chart forecast' })).toBeTruthy()
    expect(screen.getByText(/LAP 1\.25 \/ 3 · VM P2/)).toBeTruthy()
    expect(screen.getByText(/FULL-FIELD TIMING CATCH · L2/)).toBeTruthy()
    const selected = container.querySelector('.lap-synthetic-line.is-selected')
    expect(selected).toBeTruthy()
    fireEvent.click(selected!)
    expect(onSelect).toHaveBeenCalledWith('SYN_001')
    expect(container.querySelectorAll('.lap-synthetic-line')).toHaveLength(2)
    expect(container.querySelector('.lap-initialization-region')).toBeTruthy()
    expect(screen.getByText(/GRID P1/)).toBeTruthy()
  })

  it('keeps the current lap-13 P1 header and VM chart intersection on the same X/Y coordinates', () => {
    const longScenario = { ...scenario, raceLaps: 30, syntheticReplay: { ...scenario.syntheticReplay!, raceLaps: 30 } }
    const { container } = render(<LapChartForecast scenario={longScenario} currentReplayProgress={13} currentVmRank={1} selectedDriverId={null} nextTargetId={null} onSelect={() => undefined} />)
    expect(screen.getAllByText('P1').length).toBeGreaterThan(1)
    const pastPath = container.querySelector('[data-vm-segment="past"]')?.getAttribute('d')
    expect(pastPath).toContain(`${lapChartX(13, 30).toFixed(2)} ${lapChartY(1).toFixed(2)}`)
    expect(lapChartPath([{ lap: 0, rank: 101, timingProgress: 0 }, { lap: 13, rank: 1, timingProgress: 13 }], 30)).toContain(`${lapChartX(13, 30).toFixed(2)} ${lapChartY(1).toFixed(2)}`)
  })

  it('keeps the exact replay rank distinct from the integer lap-boundary forecast', () => {
    const { container } = render(<LapChartForecast scenario={longScenarioForBoundaryTest()} currentReplayProgress={2.43} currentVmRank={17} selectedDriverId={null} nextTargetId={null} onSelect={() => undefined} />)
    expect(screen.getByText(/LAP 2\.43 \/ 30 · VM P17/)).toBeTruthy()
    expect(screen.getAllByText(/LAP 2 FORECAST/)).toHaveLength(2)
    const currentMarker = container.querySelector('[data-current-replay-progress="2.43"]')
    expect(currentMarker?.getAttribute('x1')).toBe(String(lapChartX(2.43, 30)))
  })

  it('labels and promotes the Traffic Adjusted trajectory when it is the active model', () => {
    const adjusted = { ...scenario, raceModel: { mode: 'TRAFFIC_ADJUSTED' }, trafficAdjusted: { rankTrajectory: [{ lap: 1, rank: 90, raceTimeSeconds: 80, trafficCostSeconds: 2, cumulativeTrafficCostSeconds: 2 }] } } as unknown as CustomSimulationResult
    const { container } = render(<LapChartForecast scenario={adjusted} currentReplayProgress={1} currentVmRank={2} selectedDriverId={null} nextTargetId={null} onSelect={() => undefined} />)
    expect(container.querySelector('[data-vm-traffic-adjusted="true"]')).toBeTruthy()
    expect(container.querySelector('.lap-vm-traffic-line.is-active')).toBeTruthy()
    expect(container.querySelector('.lap-vm-line.is-reference')).toBeTruthy()
    expect(screen.getByText(/ACTIVE: TRAFFIC ADJUSTED/)).toBeTruthy()
    expect(screen.getAllByText(/PURE TIMING reference/i).length).toBeGreaterThan(0)
    expect(container.querySelectorAll('.lap-synthetic-line')).toHaveLength(2)
  })
})

function longScenarioForBoundaryTest(): CustomSimulationResult {
  return { ...scenario, raceLaps: 30, syntheticReplay: { ...scenario.syntheticReplay!, raceLaps: 30 } }
}
