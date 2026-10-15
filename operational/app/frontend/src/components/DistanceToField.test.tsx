import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { DistanceToField } from './DistanceToField'
import { getDistanceToField } from '../utils/distanceToField'

const rows = [
  { driverId: 'SYN_074', raceDistance: 10.026, gapToVirtualMaxMeters: 26, caughtByVirtualMax: false },
  { driverId: 'SYN_080', raceDistance: 10.0021, gapToVirtualMaxMeters: 2.1, caughtByVirtualMax: false },
  { driverId: 'SYN_081', raceDistance: 9.99, gapToVirtualMaxMeters: -10, caughtByVirtualMax: true },
]

describe('DistanceToField', () => {
  it('renders only active ahead drivers, with the nearest target shared with Next Targets', () => {
    const state = getDistanceToField(rows, 10)
    const onSelect = vi.fn()
    render(<DistanceToField state={state} vmRank={3} caughtCount={1} uncaughtTargetCount={2} currentlyAheadCount={2} selectedDriverId="SYN_080" startingDelaySeconds={0} replayTime={10} onSelect={onSelect} />)
    expect(screen.getAllByText('SYN_074')).toHaveLength(2)
    expect(screen.getAllByText('SYN_080')).toHaveLength(1)
    expect(screen.queryByText('SYN_081')).toBeNull()
    expect(screen.getAllByText('NEXT UP')).toHaveLength(2)
    fireEvent.click(screen.getByText('SYN_080'))
    expect(onSelect).toHaveBeenCalledWith('SYN_080')
  })

  it('does not imply P1 when every timing target has been caught', () => {
    const state = getDistanceToField([{ ...rows[2] }], 10)
    const view = render(<DistanceToField state={state} vmRank={4} caughtCount={100} uncaughtTargetCount={0} currentlyAheadCount={3} selectedDriverId={null} startingDelaySeconds={0} replayTime={20} onSelect={() => undefined} />)
    expect(screen.getByText('ALL TIMING TARGETS CAUGHT')).toBeTruthy()
    expect(screen.getByText(/CURRENTLY AHEAD 3/)).toBeTruthy()
    expect(screen.queryByText('CLEAR TRACK')).toBeNull()
    expect(within(view.container).queryByRole('list', { name: /drivers still ahead/i })).toBeNull()
    view.unmount()
  })
})
