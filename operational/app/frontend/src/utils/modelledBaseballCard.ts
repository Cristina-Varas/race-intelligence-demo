import type { BaseballCardDataResponse, BaseballCardDataRow, CustomSimulationResult, SimulationRequest } from '../types/raceIntelligence'
import { buildParticipantRaceCard } from './participantRaceCard'

/** Existing reference request, sent to the existing simulation API. No local engine. */
export const CARD_REFERENCE: SimulationRequest = {
  fieldMode: 'synthetic_100', raceFormat: 'FIXED_LAPS', raceLaps: 30,
  virtualMaxAdvantageSecondsPerLap: .195, startingDelaySeconds: 1.5, simulations: 5000,
  raceModelMode: 'TRAFFIC_ADJUSTED', fieldVariabilityMode: 'NOMINAL', fieldVariabilitySeed: 42,
  paceProfile: [{ startLap: 1, endLap: 5, paceAdjustmentPercent: 1.5 }, { startLap: 6, endLap: null, paceAdjustmentPercent: -2 }],
  trafficCostModel: { enabled: true, earlyCostSecondsPerKart: 1, lateCostSecondsPerKart: .2, transitionStartLap: 1, transitionEndLap: 7, interpolation: 'LINEAR' },
}

export function cardDuration(seconds: number | null) {
  if (seconds === null) return '—'
  const tenths = Math.round(seconds * 10)
  return `${String(Math.floor(tenths / 600)).padStart(2, '0')}:${String(Math.floor(tenths % 600 / 10)).padStart(2, '0')}.${tenths % 10}`
}

export function ordinal(value: number | null) {
  if (value === null) return '—'
  const suffix = value % 100 >= 10 && value % 100 <= 20 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[value % 10] ?? 'th'
  return `${value}${suffix}`
}

export function projectModelledCards(scenario: CustomSimulationResult): BaseballCardDataResponse {
  const drivers = scenario.syntheticReplay?.entities ?? scenario.syntheticReplay?.drivers ?? []
  if (scenario.fieldMode !== 'synthetic_100' || scenario.fieldEvidenceType !== 'SYNTHETIC' || drivers.length !== 100 || drivers.some(d => !/^SYN_\d+$/.test(d.driverId))) throw new Error('A completed Synthetic100 result is required.')
  const mode = scenario.raceModel?.mode ?? 'PURE_TIMING'
  if (mode === 'TRAFFIC_ADJUSTED' && !scenario.trafficAdjusted) throw new Error('Traffic Adjusted result is unavailable.')
  const cards = drivers.map(d => buildParticipantRaceCard(scenario, d.driverId, mode))
  if (cards.some(card => !card)) throw new Error('Participant trajectories are unavailable.')
  const times = cards.map(card => card!.virtualMaxInteraction.firstTimingCatchTimeSeconds).filter((t): t is number => t !== null && Number.isFinite(t))
  const rows: BaseballCardDataRow[] = cards.map((value, index) => {
    const card = value!, interaction = card.virtualMaxInteraction, result = card.result
    const seconds = interaction.firstTimingCatchTimeSeconds
    // Existing timing-catch evidence only. Strict comparison intentionally keeps ties at the same ordinal rank.
    const fieldPerformanceRank = seconds === null ? null : 1 + times.filter(t => t < seconds).length
    const kart = card.identity.kartNumber
    if (kart === null) throw new Error('Synthetic kart mapping is unavailable.')
    return {
      'Card No': index + 1, 'Participant ID': card.identity.driverId, 'Participant Name': null,
      'Kart No': kart, 'Kart Display': `KART ${kart}`,
      'Laps When Max Passed': interaction.firstTimingCatchRaceProgress, 'Time Spent Ahead of Max': seconds,
      'Field Performance Rank': fieldPerformanceRank, 'Field Performance Display': ordinal(fieldPerformanceRank),
      'Start Position': result.startPosition, 'Peak Position': result.bestPosition, 'Final Position': result.finalPosition,
      'Position Change': result.positionsGained, 'Start Display': `P${result.startPosition}`,
      'Peak Display': `P${result.bestPosition}`, 'Final Display': `P${result.finalPosition}`,
      'Change Display': `${result.positionsGained > 0 ? '+' : ''}${result.positionsGained}`,
      'Primary Result Label': 'PRIMARY RESULT', 'Primary Result Statement': seconds === null ? null : 'WHEN MAX PASSED',
      'Time Metric Label': seconds === null ? null : 'TIME SPENT AHEAD OF MAX',
      'Field Metric Label': fieldPerformanceRank === null ? null : 'FIELD PERFORMANCE',
      Campaign: 'MAX VS 100', 'Campaign Subtitle': 'RACE INTELLIGENCE', 'Photo Asset': null,
      status: seconds === null ? 'PARTIAL' : 'READY', statusReasons: seconds === null ? ['NO_MODELLED_TIMING_CATCH'] : [],
      evidenceDomain: 'MODELLED_SCENARIO',
    }
  })
  if (new Set(rows.map(row => row['Kart No'])).size !== 100) throw new Error('Synthetic kart keys must be unique.')
  return { sessionId: 'Synthetic100', mode: 'modelled', rows, metadata: {
    evidenceDomain: 'MODELLED_SCENARIO', rowCount: rows.length, comparableCatchCount: times.length,
    scenarioId: scenario.syntheticReplay?.scenarioId ?? null, raceModel: mode,
    raceLaps: scenario.raceLaps, startingDelaySeconds: scenario.startingDelaySeconds,
    fieldVariability: scenario.fieldVariability?.mode ?? 'NOMINAL',
    projection: 'buildParticipantRaceCard / existing scenario result',
  } }
}
