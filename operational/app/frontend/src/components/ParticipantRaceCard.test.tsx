import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { ParticipantRaceCard } from './ParticipantRaceCard'

const scenario = { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'PURE_TIMING' }, raceLaps: 2, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 2, entities: [
  { driverId: 'SYN_001', gridPosition: 1, paceSecondsPerLap: 80.4, entityType: 'synthetic' },
  { driverId: 'SYN_042', gridPosition: 42, paceSecondsPerLap: 81, timingCatchTimeSeconds: 161.5, entityType: 'synthetic' },
] } } as never

afterEach(() => { cleanup(); vi.restoreAllMocks() })
describe('ParticipantRaceCard', () => {
  it('renders a synthetic card, uses shared selection, chase chart and print/PDF actions', () => {
    const onSelect = vi.fn(); const print = vi.spyOn(window, 'print').mockImplementation(() => undefined)
    const { container } = render(<ParticipantRaceCard scenario={scenario} selectedDriverId="SYN_042" onSelect={onSelect} />)
    expect(screen.getByRole('heading', { name: 'Participant race cards' })).toBeTruthy()
    expect(screen.getByText(/SIMULATED RACE CARD/)).toBeTruthy()
    expect(screen.getByRole('img', { name: 'Participant gap to Virtual Max chase' })).toBeTruthy()
    expect(screen.getByText(/TIMING CATCH · 0 s/)).toBeTruthy()
    expect(screen.getByText(/CAUGHT · L2/)).toBeTruthy()
    expect(screen.getByText('2.0 LAPS')).toBeTruthy()
    expect(container.querySelector('[data-chase-laps]')?.getAttribute('data-chase-laps')).toBe('2')
    fireEvent.change(screen.getByLabelText('Participant selector'), { target: { value: 'SYN_001' } })
    expect(onSelect).toHaveBeenCalledWith('SYN_001')
    fireEvent.click(screen.getByRole('button', { name: /PRINT CARD/i }))
    fireEvent.click(screen.getByRole('button', { name: /EXPORT PDF/i }))
    expect(print).toHaveBeenCalledTimes(2)
    expect(container.querySelectorAll('[data-print-card="true"]')).toHaveLength(1)
  })

  it('shows the no-scenario empty state', () => {
    render(<ParticipantRaceCard scenario={null} selectedDriverId={null} onSelect={() => undefined} />)
    expect(screen.getByText('RUN A SCENARIO TO GENERATE PARTICIPANT RACE CARDS')).toBeTruthy()
  })

  it('keeps the full race window and no catch marker for a participant not timing-caught', () => {
    const notCaught = { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'PURE_TIMING' }, raceLaps: 2, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 2, entities: [{ driverId: 'SYN_099', gridPosition: 99, paceSecondsPerLap: 79, entityType: 'synthetic' }] } } as never
    const { container } = render(<ParticipantRaceCard scenario={notCaught} selectedDriverId="SYN_099" onSelect={() => undefined} />)
    expect(screen.getByText(/HELD VIRTUAL MAX OFF FOR THE FULL RACE/i)).toBeTruthy()
    expect(screen.getAllByText('NOT CAUGHT').length).toBeGreaterThanOrEqual(1)
    expect(screen.queryByText(/CAUGHT · L/)).toBeNull()
    expect(container.querySelector('[data-chase-laps]')?.getAttribute('data-chase-laps')).toBe('2')
  })

  it('uses distinct early, mid and late catch windows rather than a full-race flat tail', () => {
    const makeScenario = (driverId: string, pace: number, catchTime: number) => ({ fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'PURE_TIMING' }, raceLaps: 10, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 10, entities: [{ driverId, gridPosition: 1, paceSecondsPerLap: pace, timingCatchTimeSeconds: catchTime, entityType: 'synthetic' }] } } as never)
    const early = render(<ParticipantRaceCard scenario={makeScenario('SYN_010', 81.5, 81.5)} selectedDriverId="SYN_010" onSelect={() => undefined} />)
    expect(early.container.querySelector('[data-chase-laps]')?.getAttribute('data-chase-laps')).toBe('2')
    early.unmount()
    const mid = render(<ParticipantRaceCard scenario={makeScenario('SYN_050', 80.3, 401.5)} selectedDriverId="SYN_050" onSelect={() => undefined} />)
    expect(mid.container.querySelector('[data-chase-laps]')?.getAttribute('data-chase-laps')).toBe('6')
    mid.unmount()
    const late = render(<ParticipantRaceCard scenario={makeScenario('SYN_090', 80.18, 721.5)} selectedDriverId="SYN_090" onSelect={() => undefined} />)
    expect(late.container.querySelector('[data-chase-laps]')?.getAttribute('data-chase-laps')).toBe('10')
  })

  it('renders the exact continuous timing-catch point on the zero-gap line', () => {
    const continuous = { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'PURE_TIMING' }, raceLaps: 10, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 10, entities: [{ driverId: 'SYN_043', gridPosition: 43, paceSecondsPerLap: 80.3, timingCatchTimeSeconds: 435.9, entityType: 'synthetic' }] } } as never
    const { container } = render(<ParticipantRaceCard scenario={continuous} selectedDriverId="SYN_043" onSelect={() => undefined} />)
    const marker = container.querySelector('.card-catch-marker')
    expect(marker?.getAttribute('data-catch-progress')).toBe('5.43')
    expect(marker?.getAttribute('data-catch-gap')).toBe('0')
    expect(screen.getByText('CAUGHT · L5.43')).toBeTruthy()
    expect(screen.getByText('5.4 LAPS')).toBeTruthy()
  })

  it('uses held-off percentile direction and only presents a top badge at the top-quarter threshold', () => {
    const entities = Array.from({ length: 10 }, (_, index) => ({ driverId: `SYN_${String(index + 1).padStart(3, '0')}`, gridPosition: index + 1, paceSecondsPerLap: 80.1 + index / 10, timingCatchTimeSeconds: 80 + (index + 1) * 10, entityType: 'synthetic' }))
    const ranked = { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'PURE_TIMING' }, raceLaps: 10, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 10, entities } } as never
    const early = render(<ParticipantRaceCard scenario={ranked} selectedDriverId="SYN_001" onSelect={() => undefined} />)
    expect(screen.getByText('0% OF FIELD')).toBeTruthy()
    expect(screen.queryByText(/TOP .* HELD VM OFF/)).toBeNull()
    early.unmount()
    const topQuarter = render(<ParticipantRaceCard scenario={ranked} selectedDriverId="SYN_008" onSelect={() => undefined} />)
    expect(screen.getByText('78% OF FIELD')).toBeTruthy()
    expect(screen.getByText('TOP 30% · HELD VM OFF')).toBeTruthy()
    topQuarter.unmount()
    render(<ParticipantRaceCard scenario={ranked} selectedDriverId="SYN_010" onSelect={() => undefined} />)
    expect(screen.getByText('TOP 10% · HELD VM OFF')).toBeTruthy()
  })

  it('shows the tied top rank rather than claiming a tied participant held VM off longer than everyone', () => {
    const entities = Array.from({ length: 100 }, (_, index) => ({
      driverId: `SYN_${String(index + 1).padStart(3, '0')}`,
      gridPosition: index + 1,
      paceSecondsPerLap: 80 + index / 100,
      timingCatchTimeSeconds: index < 97 ? 100 + index : 1_000,
      entityType: 'synthetic',
    }))
    const tied = { fieldMode: 'synthetic_100', fieldEvidenceType: 'SYNTHETIC', raceModel: { mode: 'PURE_TIMING' }, raceLaps: 30, virtualMaxPace: 80, startingDelaySeconds: 1.5, syntheticReplay: { raceLaps: 30, entities } } as never
    render(<ParticipantRaceCard scenario={tied} selectedDriverId="SYN_098" onSelect={() => undefined} />)
    expect(screen.getByText('98% OF FIELD')).toBeTruthy()
    expect(screen.getByText('TOP 3% · HELD VM OFF')).toBeTruthy()
    expect(screen.queryByText('100% OF FIELD')).toBeNull()
  })

})
