import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JokerComparison } from './JokerComparison'
import { compareJokers } from '../api/raceIntelligence'
import type { CustomSimulationResult } from '../types/raceIntelligence'

vi.mock('../api/raceIntelligence', () => ({ compareJokers: vi.fn() }))

const scenario = { raceLaps: 30, virtualMaxAdvantageSecondsPerLap: .195, startingDelaySeconds: 1.5, simulations: 5000, fieldMode: 'synthetic_100' } as CustomSimulationResult
const option = { optionId: 'joker_1-lap-5', driverId: 'VIRTUAL_MAX', routeId: 'joker_1' as const, lap: 5, mainReplacedTimeSeconds: 5, alternateRouteTimeSeconds: 1, timingDeltaSeconds: -4, speedFactor: 1, breakEvenSpeedFactor: .2, projectedRejoin: { rank: 1, aheadDriverId: null, behindDriverId: 'SYN_034', gapAheadSeconds: null, gapBehindSeconds: 3.9 }, caveats: [] }

describe('JokerComparison', () => {
  it('renders an explicit desktop column model and structured best-outcome card', async () => {
    vi.mocked(compareJokers).mockResolvedValue({ evaluatedOptions: [option], bestTimingOptionIds: [option.optionId], bestTimingDeltaSeconds: -4, tieToleranceSeconds: .01, assumptionSummary: 'test' })
    const { container } = render(<JokerComparison scenario={scenario} onSelect={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: /compare options/i }))
    expect(await screen.findByLabelText(/best evaluated timing outcome/i)).toBeTruthy()
    expect(screen.getByText('GAP AHEAD')).toBeTruthy()
    expect(screen.getByText('GAP BEHIND')).toBeTruthy()
    expect(container.querySelectorAll('colgroup col')).toHaveLength(9)
    expect(screen.getByLabelText(/scrollable joker comparison options/i).className).toContain('telemetry-scroll-panel')
  })
})
