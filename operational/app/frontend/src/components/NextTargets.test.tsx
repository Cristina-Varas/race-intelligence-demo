import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { NextTargets } from './NextTargets'
import { getNextTargets } from '../utils/nextTargets'

describe('NextTargets', () => {
  it('renders the closest targets and shares selection through its callback', () => {
    const state = getNextTargets({ entities: [
      { driverId: 'SYN_080', raceDistance: 10.002, gapToVirtualMaxMeters: 2.1, caughtByVirtualMax: false, timingCatchTimeSeconds: null },
      { driverId: 'SYN_081', raceDistance: 9.9, gapToVirtualMaxMeters: -3, caughtByVirtualMax: true, timingCatchTimeSeconds: 22.3 },
    ], virtualMaxRaceDistance: 10, replayTime: 24 })
    const onSelect = vi.fn()
    render(<NextTargets state={state} vmRank={3} currentlyAheadCount={2} replayTime={24} raceLaps={30} virtualMaxLap={4} startingDelaySeconds={0} selectedDriverId={null} onSelect={onSelect} />)
    expect(screen.getByRole('heading', { name: 'Next targets' })).toBeTruthy()
    expect(screen.getByText('SYN_080')).toBeTruthy()
    expect(screen.getByText('SYN_081')).toBeTruthy()
    fireEvent.click(screen.getByText('SYN_080'))
    expect(onSelect).toHaveBeenCalledWith('SYN_080')
  })

  it('allows a terminal P4 with zero uncaught targets without claiming clear track', () => {
    const state = getNextTargets({ entities: [
      { driverId: 'SYN_001', raceDistance: 9.9, gapToVirtualMaxMeters: -2, caughtByVirtualMax: true, timingCatchTimeSeconds: 20 },
    ], virtualMaxRaceDistance: 10, replayTime: 30 })
    render(<NextTargets state={state} vmRank={4} currentlyAheadCount={3} modelLabel="PURE TIMING REFERENCE REPLAY" replayTime={30} raceLaps={30} virtualMaxLap={30} startingDelaySeconds={0} selectedDriverId={null} onSelect={() => undefined} />)
    expect(screen.getByText('VM P4 / 101')).toBeTruthy()
    expect(screen.getAllByText('ALL TIMING TARGETS CAUGHT').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/CURRENTLY AHEAD/).some((element) => element.textContent?.includes('3'))).toBe(true)
    expect(screen.queryByText('CLEAR TRACK')).toBeNull()
  })
})
