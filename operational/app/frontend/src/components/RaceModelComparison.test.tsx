import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RaceModelComparison } from './RaceModelComparison'
import type { CustomSimulationResult } from '../types/raceIntelligence'

describe('RaceModelComparison', () => {
  it('keeps Pure Timing and Traffic Adjusted values visibly distinct', () => {
    const scenario = { pureTiming: { projectedFinishTimeSeconds: 2404.4, p1Lap: 8, p1TimeSeconds: 700, fullFieldClearLap: 8, fullFieldClearTimeSeconds: 700, cumulativeTrafficCostSeconds: 0, rankTrajectory: [] }, trafficAdjusted: { projectedFinishTimeSeconds: 2440, p1Lap: 24, p1TimeSeconds: 1900, fullFieldClearLap: 25, fullFieldClearTimeSeconds: 2000, cumulativeTrafficCostSeconds: 35.6, rankTrajectory: [] } } as unknown as CustomSimulationResult
    render(<RaceModelComparison scenario={scenario} />)
    expect(screen.getByText('Model comparison')).toBeTruthy()
    expect(screen.getByText('LAP 8')).toBeTruthy()
    expect(screen.getByText('LAP 24')).toBeTruthy()
    expect(screen.getByText('+35.6 s')).toBeTruthy()
  })
})
