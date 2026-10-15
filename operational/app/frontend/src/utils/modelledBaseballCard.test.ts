import { expect, it } from 'vitest'
import { modelledCardScenario } from '../testFixtures/modelledCardScenario'
import { buildParticipantRaceCard } from './participantRaceCard'
import { cardDuration, ordinal, projectModelledCards } from './modelledBaseballCard'

it('reuses existing participant catch and rank outputs for early, median, late, best and worst cards', () => {
  const scenario = modelledCardScenario(), data = projectModelledCards(scenario)
  expect(data.rows).toHaveLength(100)
  for (const index of [0,1,49,97,98]) {
    const row=data.rows[index], original=buildParticipantRaceCard(scenario,row['Participant ID'],'TRAFFIC_ADJUSTED')!
    expect(row['Laps When Max Passed']).toBe(original.virtualMaxInteraction.firstTimingCatchRaceProgress)
    expect(row['Time Spent Ahead of Max']).toBe(original.virtualMaxInteraction.firstTimingCatchTimeSeconds)
    expect(row['Start Position']).toBe(original.result.startPosition)
    expect(row['Peak Position']).toBe(original.result.bestPosition)
    expect(row['Final Position']).toBe(original.result.finalPosition)
    expect(row['Position Change']).toBe(original.result.positionsGained)
  }
  expect(data.rows.every(row=>row['Participant Name']===null&&row.evidenceDomain==='MODELLED_SCENARIO')).toBe(true)
})
it('excludes target and incomparable catches from denominator, does not count ties, and stays monotonic', () => {
  const rows=projectModelledCards(modelledCardScenario()).rows
  expect(rows[0]['Field Performance Rank']).toBe(1)
  expect(rows[1]['Field Performance Rank']).toBe(1)
  expect(rows[2]['Field Performance Rank']).toBe(3)
  expect(rows[98]['Field Performance Rank']).toBe(99)
  expect(rows[99]['Field Performance Rank']).toBeNull()
  expect(rows[99]['Time Spent Ahead of Max']).toBeNull()
  expect(rows[99]['Laps When Max Passed']).toBeNull()
  const comparable=rows.slice(0,99)
  comparable.slice(1).forEach((row,i)=>expect(row['Field Performance Rank']!).toBeGreaterThanOrEqual(comparable[i]['Field Performance Rank']!))
})
it('formats duration with decimal rollover and rejects non-synthetic or missing active traffic results', () => {
  expect(cardDuration(908.3)).toBe('15:08.3')
  expect(cardDuration(59.99)).toBe('01:00.0')
  expect([1,2,3,4,11,12,13,21,22,23,67,100].map(ordinal)).toEqual(['1st','2nd','3rd','4th','11th','12th','13th','21st','22nd','23rd','67th','100th'])
  expect(()=>projectModelledCards({...modelledCardScenario(),fieldMode:'historical'})).toThrow()
  expect(()=>projectModelledCards({...modelledCardScenario(),trafficAdjusted:undefined})).toThrow()
})
