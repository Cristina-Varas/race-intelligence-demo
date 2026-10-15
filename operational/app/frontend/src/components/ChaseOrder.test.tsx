import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { ChaseOrder, sortChaseOrder } from './ChaseOrder'

describe('ChaseOrder', () => {
  it('puts deterministic catch laps first and not-caught drivers last', () => {
    const ordered = sortChaseOrder([
      { driverId: '13', driverPace: 80.3, deltaToFastest: 0, paceGainSecondsPerLap: 0.2, catchLapExact: null, catchLapDisplay: null, catchPossibleWithinRace: false, catchProbability: 0.3 },
      { driverId: '10', driverPace: 80.5, deltaToFastest: 0.2, paceGainSecondsPerLap: 0.4, catchLapExact: 6.25, catchLapDisplay: 7, catchPossibleWithinRace: true, catchProbability: 0.7 },
      { driverId: '3', driverPace: 80.4, deltaToFastest: 0.1, paceGainSecondsPerLap: 0.3, catchLapExact: 3.1, catchLapDisplay: 4, catchPossibleWithinRace: true, catchProbability: 0.8 },
    ])
    expect(ordered.map((driver) => driver.driverId)).toEqual(['3', '10', '13'])
  })

  it('keeps its title outside a bounded, keyboard-scrollable row container', () => {
    render(<ChaseOrder drivers={[{ driverId: '3', driverPace: 80.4, deltaToFastest: 0.1, paceGainSecondsPerLap: 0.3, catchLapExact: 3.1, catchLapDisplay: 4, catchPossibleWithinRace: true, catchProbability: 0.8 }]} />)
    expect(screen.getByRole('heading', { name: /chase order/i })).toBeTruthy()
    const panel = screen.getByLabelText(/scrollable deterministic chase order/i)
    expect(panel.className).toContain('telemetry-scroll-panel')
    expect(panel.getAttribute('tabindex')).toBe('0')
    expect(screen.getByText('CATCH LAP')).toBeTruthy()
    expect(screen.getByText('#3')).toBeTruthy()
  })
})
