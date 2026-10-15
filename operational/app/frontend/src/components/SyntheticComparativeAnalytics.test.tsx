import { render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { SyntheticComparativeAnalytics } from './SyntheticComparativeAnalytics'

describe('SyntheticComparativeAnalytics', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('keeps the synthetic population distinct from historical field metadata', () => {
    vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} })
    const scenario = { fieldMode: 'synthetic_100', raceLaps: 3, virtualMaxPace: 81.5, startingDelaySeconds: 0, deterministicMaxDelaySeconds: 5.85, fullFieldCatchProbability: .62, fieldVariability: { mode: 'HISTORICAL_SEEDED', seed: 42 }, terminalState: { raceFormat: 'FIXED_LAPS', virtualMax: { finalRank: 4 } }, syntheticReplay: { method: 'seeded_historical_lap_variability', seed: 42, raceLaps: 3, caveat: 'No telemetry.', drivers: [{ driverId: 'SYN_001', lapTimeSeconds: 80, raceDurationSeconds: 240 }, { driverId: 'SYN_002', lapTimeSeconds: 82, raceDurationSeconds: 246 }] } } as never
    render(<SyntheticComparativeAnalytics scenario={scenario} historicalFieldSize={16} trackLengthMeters={2448.0699568362184} />)
    expect(screen.getByText(/TRACK LENGTH · 2.448 KM/i)).toBeTruthy()
    expect(screen.getByText(/Historical observed field: 16 drivers, kept separate/i)).toBeTruthy()
    expect(screen.getByText(/2 \/ 3/)).toBeTruthy()
    expect(screen.getByText(/Synthetic race duration ECDF/i)).toBeTruthy()
    expect(screen.getByText('NOMINAL PACE RANK')).toBeTruthy()
    expect(screen.getByText('NOMINAL PACE PERCENTILE')).toBeTruthy()
    expect(screen.getByText(/not the selected seeded final classification/i)).toBeTruthy()
    expect(screen.getByText('Deterministic nominal sensitivity')).toBeTruthy()
    expect(screen.getByText(/does not use the selected Historical Seeded realization/i)).toBeTruthy()
  })
})
