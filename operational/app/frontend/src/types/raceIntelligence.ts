export interface ScenarioSummary {
  supportedFieldSize: number
  raceLaps: number
  simulations: number
  deterministicMaxDelaySeconds: number
  probabilityAtZeroDelay: number
  thresholds: {
    p50: number | null
    p80: number | null
    p90: number | null
  }
}

export interface ProbabilityPoint {
  delaySeconds: number
  catchProbability: number
}

export interface VirtualMaxProfile {
  scenarioDriverId: string
  referenceDriverId: number
  referencePaceSeconds: number
  assumedAdvantageSecondsPerLap: number
  virtualMaxPaceSeconds: number
  scenarioType: 'SYNTHETIC'
  label: 'WHAT-IF'
  historicalStatus: 'NOT HISTORICAL'
}

export interface HistoricalDriver {
  driverId: number
  pooledValidLaps: number
  pooledMedianPace: number
  pooledMad: number
  supportStatus: 'sufficient' | string
}

export interface HealthStatus {
  status: string
  databaseConfigured: boolean
  databaseReachable?: boolean
}

export interface RaceIntelligenceData {
  health: HealthStatus
  summary: ScenarioSummary
  curve: ProbabilityPoint[]
  virtualMax: VirtualMaxProfile
  drivers: HistoricalDriver[]
}

export interface SimulationRequest {
  raceFormat?: RaceFormat
  raceLaps: number
  raceDurationSeconds?: number
  timedFinishRule?: 'COMPLETE_CURRENT_LAP'
  virtualMaxAdvantageSecondsPerLap: number
  startingDelaySeconds: number
  simulations: number
  fieldMode: FieldMode
  raceModelMode?: RaceModelMode
  paceProfile?: PacePhase[]
  trafficCostModel?: TrafficCostModel
  fieldVariabilityMode?: FieldVariabilityMode
  fieldVariabilitySeed?: number
}

export type FieldMode = 'historical' | 'synthetic_100'
export type RaceFormat = 'FIXED_LAPS' | 'TIMED_RACE'
export type RaceModelMode = 'PURE_TIMING' | 'TRAFFIC_ADJUSTED'
export type FieldVariabilityMode = 'NOMINAL' | 'HISTORICAL_SEEDED'
export interface PacePhase { startLap: number; endLap: number | null; paceAdjustmentPercent: number }
export interface TrafficCostModel { enabled: boolean; earlyCostSecondsPerKart: number; lateCostSecondsPerKart: number; transitionStartLap: number; transitionEndLap: number; interpolation: 'LINEAR' }

export interface CustomDriverResult {
  driverId: string
  driverPace: number
  deltaToFastest: number
  paceGainSecondsPerLap: number
  catchLapExact: number | null
  catchLapDisplay: number | null
  catchPossibleWithinRace: boolean
  catchProbability: number
}

export interface ScenarioTiming {
  raceFormat: 'FIXED_LAP'
  projectedFinishTimeSeconds: number
  projectedFinishLap: number
  fullFieldCatchTimeSeconds: number | null
  fullFieldCatchLap: number | null
  fullFieldCaught: boolean
}

export interface RaceModelSummary { projectedFinishTimeSeconds: number; p1Lap: number | null; p1TimeSeconds: number | null; fullFieldClearLap: number | null; fullFieldClearTimeSeconds: number | null; cumulativeTrafficCostSeconds: number; timingCatchCount?: number; clearedCount?: number; stillToClearCount?: number; rankTrajectory: { lap: number; raceTimeSeconds: number; rank: number; trafficCostSeconds: number; cumulativeTrafficCostSeconds: number; timingCaughtCount?: number; clearedCount?: number; stillToClearCount?: number }[]; clearanceEvents?: { driverIndex: number; timingCatchTimeSeconds: number; clearTimeSeconds: number; trafficCostSeconds: number; lap: number }[] }
export interface RaceModel { mode: RaceModelMode; paceProfile: PacePhase[]; trafficCostModel: TrafficCostModel }

export interface SyntheticReplayDriver {
  driverId: string
  entityType: 'synthetic'
  gridPosition: number
  paceSecondsPerLap: number
  lapTimeSeconds: number
  raceDurationSeconds: number
  gridOffsetMeters: number
  initialRaceDistanceMeters: number
  routeId: 'main'
  replayDirection: 'reverse'
  timingCatchTimeSeconds: number | null
  lapTimes?: number[] | null
  cumulativeLapTimes?: number[] | null
}
export interface SyntheticReplayGrid { kind: 'ILLUSTRATIVE_SYNTHETIC_STARTING_GRID'; ordering: 'nominal_pace_ascending'; frontOffsetMeters: number; spacingMeters: number; lastOffsetMeters: number; totalLengthMeters: number }
export interface SyntheticReplay { method: 'constant_pace_lap_interpolation' | 'seeded_historical_lap_variability'; seed: number; populationId: string; scenarioId: string; raceLaps: number; fieldSize: number; grid: SyntheticReplayGrid; entities: SyntheticReplayDriver[]; /** Legacy local hot-reload compatibility only; not returned by the API. */ drivers?: SyntheticReplayDriver[]; caveat: string }
export interface FieldVariability { mode: FieldVariabilityMode; seed: number; sourceCount: number; methodology: 'none' | 'centered_empirical_bootstrap'; sourceMeanDeviationSeconds: number; appliedCenteringSeconds: number; bounds: null; distribution: { count: number; min: number; max: number; mean: number; median: number; p5: number; p25: number; p75: number; p95: number; p99: number }; sampleAudit: { minimumEffectiveLapTimeSeconds: number; maximumEffectiveLapTimeSeconds: number; sampledDeviationsOver3Seconds: number; sampledDeviationsOver5Seconds: number; sampledDeviationsOver8Seconds: number } | null }

export interface CustomSimulationResult {
  mode: 'custom'
  scenarioType: 'SYNTHETIC WHAT-IF'
  fieldMode: FieldMode
  fieldLabel: string
  fieldSize: number
  fieldEvidenceType: 'OBSERVED' | 'SYNTHETIC'
  raceLaps: number
  raceFormat?: { mode: RaceFormat; durationSeconds: number | null; finishRule: 'COMPLETE_CURRENT_LAP' | null }
  terminalState?: { raceFormat: RaceFormat; raceClockExpirySeconds: number; finishRule: 'COMPLETE_CURRENT_LAP'; entities: { entityId: string; completedLaps: number; finishLap: number; finishTimeSeconds: number; finalRank: number; finished: boolean }[]; virtualMax: { completedLaps: number; finishLap: number; finishTimeSeconds: number; finalRank: number }; fieldSummary: { maxCompletedLaps: number; minCompletedLaps: number; distinctCompletedLapCounts: number } } | null
  simulations: number
  fastestObservedPace: number
  virtualMaxAdvantageSecondsPerLap: number
  virtualMaxPace: number
  startingDelaySeconds: number
  deterministicMaxDelaySeconds: number
  fullFieldCatchProbability: number
  thresholds: ScenarioSummary['thresholds']
  probabilityCurve: ProbabilityPoint[]
  drivers: CustomDriverResult[]
  timing: ScenarioTiming
  caveats: string[]
  syntheticReplay?: SyntheticReplay | null
  raceModel?: RaceModel
  pureTiming?: RaceModelSummary
  trafficAdjusted?: RaceModelSummary | null
  fieldVariability?: FieldVariability
}

export interface JokerStrategyResult { driverId: string; routeId: 'joker_1' | 'joker_2'; lap: number; mainReplacedTimeSeconds: number; alternateRouteTimeSeconds: number; timingDeltaSeconds: number; speedFactor: number; breakEvenSpeedFactor: number; projectedRejoin: { rank: number; aheadDriverId: string | null; behindDriverId: string | null; gapAheadSeconds: number | null; gapBehindSeconds: number | null }; caveats: string[] }
export interface JokerComparisonResult { evaluatedOptions: (JokerStrategyResult & { optionId: string })[]; bestTimingOptionIds: string[]; bestTimingDeltaSeconds: number; tieToleranceSeconds: number; assumptionSummary: string }

export interface TrackPoint { normalizedDistance: number; latitude: number; longitude: number }
export interface ReplayStartAnchor { sourceGeometryIndex: number; sourceNormalizedDistance: number; latitude: number; longitude: number; sourceCumulativeDistanceMeters: number; label: 'illustrative_replay_start_anchor' }
export interface TrackGeometry { trackLengthMeters: number; closedLoop: boolean; pointCount: number; sourcePointCount: number; startFinishSource: string; replayDirection?: 'forward' | 'reverse'; replayStartAnchor: ReplayStartAnchor; geometry: TrackPoint[] }
export interface TopologyPoint { latitude: number; longitude: number; normalizedDistance?: number; cumulativeDistanceMeters?: number }
export interface TopologyAnchor { latitude: number; longitude: number; normalizedProgress: number; cumulativeDistanceMeters: number; separationMeters: number }
export interface TrackRoute { routeId: 'main' | 'joker_1' | 'joker_2' | 'penalty_1' | 'penalty_2'; routeType: 'MAIN' | 'JOKER' | 'PENALTY'; closedLoop: boolean; lengthMeters: number; geometry: TopologyPoint[]; entryAnchor?: TopologyAnchor; exitAnchor?: TopologyAnchor; replacedMainDistanceMeters?: number; routeDistanceDeltaMeters?: number }
export interface TrackSector { sectorId: string; sectorNumber: number; startAnchor: TopologyAnchor; endAnchor: TopologyAnchor; mainRouteStartProgress: number; mainRouteEndProgress: number; lengthMeters: number }
export interface TrackTopology { trackId: string; metadata: { mainRouteLengthMeters: number; direction: 'forward' | 'reverse'; directionSource: string; startAnchorSource: string; sectorGeometryAvailable: boolean }; mainRoute: TrackRoute; alternateRoutes: TrackRoute[]; sectors: TrackSector[]; startAnchor: { latitude: number; longitude: number; source: string; mainRouteProjection: TopologyAnchor } }
export interface ReplayAnchor { raceTimeSeconds: number; lap: number; lapDurationSeconds: number; timingGapSeconds: number | null }
export interface ReplayDriver { driverId: string; anchors: ReplayAnchor[] }
export interface ReplayMetadata { supportedDriverIds: string[]; supportedDriverCount: number; raceLaps: number; raceDurationSeconds: number; reconstructionMethod: 'lap_interpolation'; trackLengthMeters: number; gpsTelemetry: false; trackOrigin: string; sourceSession: string }
export interface HistoricalReplay { metadata: ReplayMetadata; drivers: ReplayDriver[] }

export interface EventSessionSummary {
  sessionId: string | null
  eventId: string | null
  sessionType: string | null
  sessionName: string | null
  status: string | null
  startedAt: string | null
  endedAt: string | null
  sessionDurationSeconds: number | null
  participantCount: number | null
  lapObservationCount: number | null
  distinctLapCount: number | null
  eventCount: number | null
  mediaMarkerCount: number | null
  snapshotCount: number | null
  maxParticipantId: string | null
  maxBestLapSeconds: number | null
  maxAverageLapSeconds: number | null
  maxCompletedLaps: number | null
  fastestParticipantId: string | null
  fastestParticipantName: string | null
  fastestLapSeconds: number | null
  finalLeaderParticipantId: string | null
  finalLeaderName: string | null
  finalLeaderPosition: number | null
  source: string | null
  operationalContext: string | null
  factualEvidenceDomain: string | null
  eventContractVersion: string | null
  goldProcessedAt: string | null
}

/** Accepted operational records are journaled first and become serving data only after governed processing. */
export interface EventWriteAcknowledgement {
  id: string
  sessionId: string
  operation: string
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED'
  recordedAt: string
  message: string
}

export interface EventCaptureParticipantState {
  participantId: string
  displayName: string | null
  kartId: string | null
  participantType: string | null
  specialRole: string | null
  source: string | null
}

export interface EventCaptureActivity {
  id: string
  operation: string
  entityKind: string
  syncStatus: 'PENDING' | 'SYNCED' | 'FAILED'
  recordedAt: string
  participantId: string | null
  targetParticipantId: string | null
  lapNumber: number | null
  eventType: string | null
  title: string | null
}

export interface EventCaptureSessionState {
  sessionId: string
  eventId: string | null
  sessionType: string | null
  sessionName: string | null
  status: 'CREATED' | 'RECORDING' | 'COMPLETED'
  source: string | null
  operator: string | null
  createdAt: string
  startedAt: string | null
  endedAt: string | null
  participants: EventCaptureParticipantState[]
  recentCaptures: EventCaptureActivity[]
}

export interface EventSessionCreateRequest {
  sessionId?: string
  eventId: string
  sessionType: 'PRACTICE' | 'QUALIFYING' | 'RACE' | 'REPLAY'
  sessionName?: string
  operator?: string
  notes?: string
  idempotencyKey?: string
}

export interface EventParticipantCreateRequest {
  participantId?: string
  displayName?: string
  kartId?: string
  participantType: 'MAX' | 'CHALLENGER' | 'ORACLE_DRIVER'
  specialRole?: string
  idempotencyKey?: string
}

export interface EventLapCreateRequest {
  observationId?: string
  participantId: string
  lapNumber: number
  lapTimeSeconds?: number
  sector1Seconds?: number
  sector2Seconds?: number
  sector3Seconds?: number
  position?: number
  gapToMaxSeconds?: number
  gapToLeaderSeconds?: number
  observedAt?: string
  operatorNote?: string
  idempotencyKey?: string
}

export interface EventRaceEventCreateRequest {
  eventRecordId?: string
  raceTimeSeconds?: number
  lapNumber?: number
  participantId?: string
  targetParticipantId?: string
  eventType: 'SESSION_START' | 'SESSION_END' | 'LAP_COMPLETE' | 'TIMING_CATCH' | 'PASS' | 'JOKER' | 'INCIDENT' | 'SPIN' | 'PENALTY' | 'MAX_APPROACHING' | 'MAX_PASSES_DRIVER' | 'OPERATOR_NOTE'
  value?: string
  notes?: string
  recordedAt?: string
  idempotencyKey?: string
}

export interface EventMediaMarkerCreateRequest {
  markerId?: string
  raceTimeSeconds?: number
  lapNumber?: number
  participantId?: string
  markerType: 'MAX_CLOSES_ON_ORACLE_CAR' | 'MAX_PASSES_ORACLE_CAR' | 'BIG_PREDICTION_CHANGE' | 'BIGGEST_GAP_CHANGE' | 'BEST_DASHBOARD_MOMENT' | 'CARD_HIGHLIGHT' | 'DEBRIEF_MOMENT' | 'GENERAL'
  title: string
  notes?: string
  priority: 'LOW' | 'MEDIUM' | 'HIGH'
  idempotencyKey?: string
}

export type EventMomentType = 'PRE_RACE' | 'START' | 'MID_RACE' | 'POSITION_CHANGE' | 'GAP_CHANGE' | 'LEADER_CHANGE' | 'PREDICTION_CHANGE' | 'TARGET_CHANGE' | 'CONFIRMED_PASS' | 'FASTEST_LAP' | 'CHALLENGER_PERFORMANCE' | 'KEY_MOMENT' | 'CONTROL_ROOM_REACTION' | 'END_OF_CAPTURE' | 'FINISH' | 'MANUAL_MARKER'

/** Identity-safe operational moment. KART_NUMBER is joined externally by the authorised content team. */
export interface EventMoment {
  momentId: string
  sessionId: string
  momentType: EventMomentType
  title: string | null
  description: string | null
  triggerMode: 'AUTOMATIC' | 'OPERATOR'
  triggerRule: string | null
  observedAt: string
  recordedAt: string
  createdAt: string
  primaryParticipantId: string | null
  relatedParticipantId: string | null
  externalParticipantNumber: string | null
  relatedExternalParticipantNumber: string | null
  sourceSnapshotId: string | null
  priorValue: number | null
  currentValue: number | null
  deltaValue: number | null
  unit: string | null
  importance: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  socialPriority: 'LOW' | 'MEDIUM' | 'HIGH'
  operatorNote: string | null
  source: string
  operationalContext: string | null
  evidenceDomain: 'FACTUAL_OBSERVATION' | 'DERIVED_FACTUAL_METRIC' | 'MODELLED_SCENARIO' | string
  eventContractVersion: string
  syncStatus: 'PENDING' | 'SYNCED' | null
}

export interface EventMomentSnapshot {
  snapshotId: string
  momentId: string
  sessionId: string
  participantId: string
  externalParticipantNumber: string | null
  observedAt: string
  sourceSnapshotId: string | null
  position: number | null
  lapNumber: number | null
  gapFirstSeconds: number | null
  gapPreviousSeconds: number | null
  positionChange: number | null
  atLoop: string | null
  status: string | null
  startPosition: number | null
  peakPosition: number | null
  source: string
  operationalContext: string | null
  evidenceDomain: string
  eventContractVersion: string
}

export interface EventMomentCreateRequest {
  momentType: EventMomentType
  title?: string
  description?: string
  primaryParticipantId?: string
  relatedParticipantId?: string
  observedAt?: string
  importance?: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL'
  socialPriority?: 'LOW' | 'MEDIUM' | 'HIGH'
  operatorNote?: string
  idempotencyKey?: string
}

export interface LiveEventStanding { participantId: string | null; externalParticipantNumber: string | null; position: number | null; lapNumber: number | null; elapsedTimeSeconds: number | null; gapFirstSeconds: number | null; gapPreviousSeconds: number | null; status: string | null; positionChange: number | null; atLoop: string | null }
export interface LiveEventPosition { sourceEntityId: string; participantId: string | null; externalParticipantNumber: string | null; positionSource: 'GPS_CORRECTED' | 'RGPS_RAW'; latitude: number | null; longitude: number | null; rawStatusBits: number | null }
export interface LiveEventState {
  sourceEpoch?: number; sourceState?: 'READY' | 'REBUILDING'
  sessionId: string; stateVersion: number; updatedAt: string | null; lastMessageAt: string | null
  sourceMode?: 'REPLAY' | 'LIVE'; operationalContext?: string
  connection: { status: string; connectionId: number; reconnectCount: number; stale: boolean; lastUpdateAgeSeconds?: number | null; connectedAt?: string; disconnectedAt?: string; reconnectStartedAt?: string; reconnectedAt?: string; subscriptionsRestoredAt?: string }
  sessionState: Record<string, unknown>; standings: LiveEventStanding[]; participants: unknown[]; finishLine: unknown[]
  latestLaps?: Record<string, { lapNumber: number | null; lapTimeSeconds: number | null; lapValid: boolean | null }>
  positions: { GPS_CORRECTED: LiveEventPosition[]; RGPS_RAW?: LiveEventPosition[] }
  eventMomentCandidates?: { momentType: string; participantId: string; previous: number; current: number; observedAt: string }[]
}

export interface EventParticipantRaceSummary {
  sessionId: string | null
  participantId: string | null
  displayName: string | null
  kartId: string | null
  participantType: string | null
  specialRole: string | null
  externalParticipantNumber: string | null
  lapCount: number | null
  bestLapSeconds: number | null
  averageLapSeconds: number | null
  medianLapSeconds: number | null
  totalRecordedLapTimeSeconds: number | null
  initialPosition: number | null
  finalPosition: number | null
  positionChange: number | null
  firstObservedAt: string | null
  lastObservedAt: string | null
  timingCatchLap: number | null
  timingCatchTimeSeconds: number | null
  physicalPassLap: number | null
  physicalPassTimeSeconds: number | null
  jokerCount: number | null
  incidentCount: number | null
  spinCount: number | null
  penaltyCount: number | null
  mediaMarkerCount: number | null
  source: string | null
  operationalContext: string | null
  evidenceDomain: string | null
  eventContractVersion: string | null
  goldProcessedAt: string | null
}

export interface EventPredictionVsReality {
  sessionId: string | null
  scenarioSnapshotId: string | null
  snapshotType: string | null
  modelVersion: string | null
  gitCommit: string | null
  predictedVmFinishSeconds: number | null
  actualVmFinishSeconds: number | null
  finishTimeErrorSeconds: number | null
  predictedVmRank: number | null
  actualVmRank: number | null
  rankError: number | null
  predictedP1Lap: number | null
  actualP1Lap: number | null
  p1LapError: number | null
  predictedP1TimeSeconds: number | null
  actualP1TimeSeconds: number | null
  p1TimeErrorSeconds: number | null
  predictedFullFieldCatchLap: number | null
  actualFullFieldCatchLap: number | null
  fullFieldCatchLapError: number | null
  predictedFullFieldCatchTimeSeconds: number | null
  actualFullFieldCatchTimeSeconds: number | null
  fullFieldCatchTimeErrorSeconds: number | null
  predictedTimingCaught: number | null
  actualTimingCaught: number | null
  predictedCleared: number | null
  actualCleared: number | null
  predictionAvailable: boolean | null
  actualAvailable: boolean | null
  comparisonAvailable: boolean | null
  operationalContext: string | null
  predictionSource: string | null
  predictionEvidenceDomain: string | null
  actualEvidenceDomain: string | null
  eventContractVersion: string | null
  goldProcessedAt: string | null
}

export interface EventParticipantCard {
  sessionId: string | null
  participantId: string | null
  displayName: string | null
  kartId: string | null
  participantType: string | null
  specialRole: string | null
  externalParticipantNumber: string | null
  actualStartPosition: number | null
  actualFinalPosition: number | null
  positionChange: number | null
  actualBestLapSeconds: number | null
  actualAverageLapSeconds: number | null
  actualCompletedLaps: number | null
  heldMaxOffLaps: number | null
  heldMaxOffSeconds: number | null
  timingCatchLap: number | null
  timingCatchTimeSeconds: number | null
  physicalPassLap: number | null
  physicalPassTimeSeconds: number | null
  jokerCount: number | null
  predictedCatchLap: number | null
  predictedFinalPosition: number | null
  predictionErrorSeconds: number | null
  highlightTitle: string | null
  highlightText: string | null
  dataProvenance: 'ACTUAL_EVENT' | string | null
  cardDataStatus: 'COMPLETE' | 'PARTIAL' | 'INSUFFICIENT_DATA' | string | null
  operationalContext: string | null
  evidenceDomain: string | null
  eventContractVersion: string | null
  goldProcessedAt: string | null
}

export interface EventStorylineEntry {
  storylineId: string | null
  sessionId: string | null
  raceTimeSeconds: number | null
  lapNumber: number | null
  participantId: string | null
  targetParticipantId: string | null
  storyType: string | null
  storyCategory: string | null
  title: string | null
  description: string | null
  priority: string | null
  sourceRecordType: string | null
  sourceRecordId: string | null
  source: string | null
  operationalContext: string | null
  evidenceDomain: string | null
  eventContractVersion: string | null
  goldProcessedAt: string | null
}

/** A single observed AKS standings state; it is never a final classification. */
export interface StandingReplayRow {
  sessionId: string | null
  snapshotId: string | null
  sourceSnapshotKey: string | null
  participantId: string | null
  externalParticipantNumber: string | null
  observedAt: string | null
  sourceTimestamp: string | null
  recordedAt: string | null
  ingestedAt: string | null
  position: number | null
  lapNumber: number | null
  elapsedTimeSeconds: number | null
  gapFirstSeconds: number | null
  gapFirstLaps: number | null
  gapPreviousSeconds: number | null
  gapPreviousLaps: number | null
  status: string | null
  positionChange: number | null
  atLoop: string | null
  source: string | null
  operationalContext: string | null
  evidenceDomain: string | null
  eventContractVersion: string | null
}

/** Read-only, session-level counts and latest facts from the governed AKS replay evidence. */
export interface EventObservedReplaySummary {
  sessionId: string | null
  standingSnapshotCount: number | null
  standingRowCount: number | null
  latestStandingObservedAt: string | null
  latestStandingLap: number | null
  latestObservedLeaderParticipantId: string | null
  latestObservedLeaderExternalParticipantNumber: string | null
  latestFieldSpreadSeconds: number | null
  positionSampleCount: number | null
  gpsCorrectedSampleCount: number | null
  rgpsRawSampleCount: number | null
  scSourceSampleCount: number | null
  positionFirstObservedAt: string | null
  positionLastObservedAt: string | null
}

/** Stable, downsampled GPS reference derived from one observed full-session trajectory. */
export interface EventTrackGeometryPoint {
  latitude: number
  longitude: number
}

export interface EventTrackGeometry {
  source: string
  derivedFrom: string
  sourceEntityId: string | null
  pointCount: number
  observedFrom: string | null
  observedTo: string | null
  points: EventTrackGeometryPoint[]
}

/** A factual observed coordinate emitted by AKS, without inferred circuit geometry. */
export interface TrackReplayRow {
  sessionId: string | null
  sampleId: string | null
  sourceEntityId: string | null
  participantId: string | null
  externalParticipantNumber: string | null
  observedAt: string | null
  sourceTimestamp: string | null
  recordedAt: string | null
  positionSource: 'GPS_CORRECTED' | 'RGPS_RAW' | string | null
  latitude: number | null
  longitude: number | null
  rawStatusBits: number | null
  unknownStatusBits: number | null
  isOfficialCar: boolean | null
  isLeader: boolean | null
  isLapped: boolean | null
  isClassLeader: boolean | null
  isStopped: boolean | null
  isClassLapped: boolean | null
  isInPit: boolean | null
  isOutLap: boolean | null
  isPositionUnknown: boolean | null
  isRetired: boolean | null
  isLate: boolean | null
  isEntryListTarget: boolean | null
  isNoGps: boolean | null
  isChequered: boolean | null
  source: string | null
  operationalContext: string | null
  evidenceDomain: string | null
  eventContractVersion: string | null
}

/** Exact Toni marketing-sheet fields plus safe operational metadata. */
export interface BaseballCardDataRow {
  'Card No': number
  'Participant ID': string
  'Participant Name': null
  'Kart No': number | string
  'Kart Display': string
  'Laps When Max Passed': number | null
  'Time Spent Ahead of Max': number | null
  'Field Performance Rank': number | null
  'Field Performance Display': string | null
  'Start Position': number | null
  'Peak Position': number | null
  'Final Position': number | null
  'Position Change': number | null
  'Start Display': string | null
  'Peak Display': string | null
  'Final Display': string | null
  'Change Display': string | null
  'Primary Result Label': string | null
  'Primary Result Statement': string | null
  'Time Metric Label': string | null
  'Field Metric Label': string | null
  'Campaign': string | null
  'Campaign Subtitle': string | null
  'Photo Asset': null
  status: 'READY' | 'PARTIAL' | 'UNAVAILABLE'
  statusReasons: string[]
  evidenceDomain: 'FACTUAL_OBSERVATION' | 'MODELLED_SCENARIO'
  latestObservedPosition?: number | null
  observedLap?: number | null
  gapToLeaderSeconds?: number | null
  intervalSeconds?: number | null
  latestCompletedLap?: number | null
  bestLapSeconds?: number | null
  bestLapNumber?: number | null
}

export interface BaseballCardDataResponse {
  sessionId: string
  mode: 'event' | 'modelled'
  rows: BaseballCardDataRow[]
  metadata: Record<string, string | number | null | undefined>
}
