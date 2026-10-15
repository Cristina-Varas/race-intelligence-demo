import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup } from '@testing-library/react'

import { RaceEvolutionChart } from './RaceEvolutionChart'
import type { CustomSimulationResult } from '../types/raceIntelligence'

const scenario = {
  raceLaps: 3, virtualMaxPace: 80, startingDelaySeconds: 1.5,
  syntheticReplay: { raceLaps: 3, entities: [
    { driverId: 'SYN_001', paceSecondsPerLap: 80.4, gridPosition: 1, entityType: 'synthetic' },
    { driverId: 'SYN_002', paceSecondsPerLap: 81, gridPosition: 2, entityType: 'synthetic' },
  ] },
  trafficAdjusted: { rankTrajectory: [
    { lap: 0, rank: 3, raceTimeSeconds: 1.5, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 0, timingCaughtCount: 0, clearedCount: 0, stillToClearCount: 2 },
    { lap: 1, rank: 2, raceTimeSeconds: 82, trafficCostSeconds: 1, cumulativeTrafficCostSeconds: 1, timingCaughtCount: 1, clearedCount: 1, stillToClearCount: 1 },
    { lap: 2, rank: 1, raceTimeSeconds: 163, trafficCostSeconds: 1, cumulativeTrafficCostSeconds: 2, timingCaughtCount: 2, clearedCount: 2, stillToClearCount: 0 },
    { lap: 3, rank: 1, raceTimeSeconds: 243, trafficCostSeconds: 0, cumulativeTrafficCostSeconds: 2, timingCaughtCount: 2, clearedCount: 2, stillToClearCount: 0 },
  ] },
} as unknown as CustomSimulationResult

afterEach(cleanup)

describe('RaceEvolutionChart', () => {
  it('renders position, continuous replay marker and shared driver selection', () => {
    const onSelect = vi.fn()
    const { container } = render(<RaceEvolutionChart scenario={scenario} currentReplayProgress={1.43} selectedDriverId="SYN_001" nextTargetId="SYN_002" nearbyIds={['SYN_001', 'SYN_002']} onSelect={onSelect} />)
    expect(screen.getByRole('heading', { name: 'Race evolution' })).toBeTruthy()
    expect(container.querySelector('[data-current-replay-progress="1.43"]')).toBeTruthy()
    expect(container.querySelector('.evolution-vm')).toBeTruthy()
    expect(container.querySelector('.evolution-synthetic.is-selected')).toBeTruthy()
    fireEvent.click(container.querySelector('.evolution-synthetic.is-next-target')!)
    expect(onSelect).toHaveBeenCalledWith('SYN_002')
  })

  it('uses backend traffic rank trajectory and exposes gap semantics and field progression', () => {
    const { container } = render(<RaceEvolutionChart scenario={scenario} currentReplayProgress={2} selectedDriverId={null} nextTargetId={null} nearbyIds={[]} onSelect={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: 'TRAFFIC ADJUSTED' }))
    expect(screen.getByText(/FIELD PROGRESSION/i)).toBeTruthy()
    expect(screen.getByText(/authoritative backend trajectory/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'GAP TO VM' }))
    expect(screen.getByText(/TIMING CATCH THRESHOLD/)).toBeTruthy()
    expect(screen.getByText(/not physical overtake/i)).toBeTruthy()
    expect(container.querySelector('.evolution-zero-line')).toBeTruthy()
  })

  it('uses the selected Traffic Adjusted model as its initial active view', () => {
    render(<RaceEvolutionChart scenario={{ ...scenario, raceModel: { mode: 'TRAFFIC_ADJUSTED' } } as CustomSimulationResult} currentReplayProgress={2} selectedDriverId={null} nextTargetId={null} nearbyIds={[]} onSelect={() => undefined} />)
    expect(screen.getByText('TRAFFIC ADJUSTED', { selector: '.race-evolution-head span' })).toBeTruthy()
    expect(screen.getByText(/FIELD PROGRESSION/i)).toBeTruthy()
  })

  it('switches Tactical and All 100 without hiding Virtual Max', () => {
    const { container } = render(<RaceEvolutionChart scenario={scenario} currentReplayProgress={0} selectedDriverId={null} nextTargetId={null} nearbyIds={[]} onSelect={() => undefined} />)
    expect(container.querySelectorAll('.evolution-synthetic')).toHaveLength(0)
    fireEvent.click(screen.getByRole('button', { name: 'ALL 100' }))
    expect(container.querySelectorAll('.evolution-synthetic')).toHaveLength(2)
    expect(container.querySelector('.evolution-vm')).toBeTruthy()
  })
})
