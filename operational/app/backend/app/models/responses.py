from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field, model_validator


class Thresholds(BaseModel):
    p50: Optional[float]
    p80: Optional[float]
    p90: Optional[float]


class ScenarioSummary(BaseModel):
    supportedFieldSize: int
    raceLaps: int
    simulations: int
    deterministicMaxDelaySeconds: float
    probabilityAtZeroDelay: float
    thresholds: Thresholds


class ProbabilityPoint(BaseModel):
    delaySeconds: float
    catchProbability: float


class SimulationRequest(BaseModel):
    raceFormat: Literal["FIXED_LAPS", "TIMED_RACE"] = "FIXED_LAPS"
    raceLaps: Optional[int] = Field(default=30, ge=5, le=100)
    raceDurationSeconds: Optional[float] = Field(default=None, ge=600, le=7200)
    timedFinishRule: Literal["COMPLETE_CURRENT_LAP"] = "COMPLETE_CURRENT_LAP"
    virtualMaxAdvantageSecondsPerLap: float = Field(default=0.195, gt=0, le=1.0)
    startingDelaySeconds: float = Field(default=1.5, ge=-120, le=120)
    simulations: int = Field(default=5000, ge=500, le=20000)
    fieldMode: Literal["historical", "synthetic_100"] = "historical"
    raceModelMode: Literal["PURE_TIMING", "TRAFFIC_ADJUSTED"] = "PURE_TIMING"
    paceProfile: Optional[list["PacePhase"]] = None
    trafficCostModel: Optional["TrafficCostModel"] = None
    fieldVariabilityMode: Literal["NOMINAL", "HISTORICAL_SEEDED"] = "NOMINAL"
    fieldVariabilitySeed: int = Field(default=42, ge=0, le=2_147_483_647)

    @model_validator(mode="after")
    def validate_race_format(self):
        if self.raceFormat == "FIXED_LAPS" and self.raceLaps is None:
            raise ValueError("FIXED_LAPS requires raceLaps.")
        if self.raceFormat == "TIMED_RACE" and self.raceDurationSeconds is None:
            raise ValueError("TIMED_RACE requires raceDurationSeconds.")
        return self


class PacePhase(BaseModel):
    startLap: int = Field(ge=1, le=100)
    endLap: Optional[int] = Field(default=None, ge=1, le=100)
    paceAdjustmentPercent: float = Field(ge=-20, le=20)


class TrafficCostModel(BaseModel):
    enabled: bool = True
    earlyCostSecondsPerKart: float = Field(default=1.0, ge=0, le=30)
    lateCostSecondsPerKart: float = Field(default=0.2, ge=0, le=30)
    transitionStartLap: int = Field(default=1, ge=1, le=100)
    transitionEndLap: int = Field(default=7, ge=1, le=100)
    interpolation: Literal["LINEAR"] = "LINEAR"


class CustomDriverResult(BaseModel):
    driverId: str
    driverPace: float
    deltaToFastest: float
    paceGainSecondsPerLap: float
    catchLapExact: Optional[float]
    catchLapDisplay: Optional[int]
    catchPossibleWithinRace: bool
    catchProbability: float


class ScenarioTiming(BaseModel):
    """Deterministic race-clock projections for a fixed-lap scenario."""

    raceFormat: Literal["FIXED_LAP", "TIMED_RACE"]
    projectedFinishTimeSeconds: float
    projectedFinishLap: int
    fullFieldCatchTimeSeconds: Optional[float]
    fullFieldCatchLap: Optional[int]
    fullFieldCaught: bool


class RaceModelSummary(BaseModel):
    projectedFinishTimeSeconds: float
    p1Lap: Optional[int]
    p1TimeSeconds: Optional[float]
    fullFieldClearLap: Optional[int]
    fullFieldClearTimeSeconds: Optional[float]
    cumulativeTrafficCostSeconds: float
    rankTrajectory: list[dict]
    timingCatchCount: int = 0
    clearedCount: int = 0
    stillToClearCount: int = 0
    currentlyClearingDriverId: Optional[str] = None
    currentClearCompletionTimeSeconds: Optional[float] = None
    clearanceEvents: list[dict] = []


class RaceModelResponse(BaseModel):
    mode: Literal["PURE_TIMING", "TRAFFIC_ADJUSTED"]
    paceProfile: list[PacePhase]
    trafficCostModel: TrafficCostModel


class SyntheticReplayDriver(BaseModel):
    driverId: str
    entityType: Literal["synthetic"]
    gridPosition: int
    paceSecondsPerLap: float
    lapTimeSeconds: float
    raceDurationSeconds: float
    gridOffsetMeters: float
    initialRaceDistanceMeters: float
    routeId: Literal["main"]
    replayDirection: Literal["reverse"]
    timingCatchTimeSeconds: Optional[float]
    lapTimes: Optional[list[float]] = None
    cumulativeLapTimes: Optional[list[float]] = None


class SyntheticReplayGrid(BaseModel):
    kind: Literal["ILLUSTRATIVE_SYNTHETIC_STARTING_GRID"]
    ordering: Literal["nominal_pace_ascending"]
    frontOffsetMeters: float
    spacingMeters: float
    lastOffsetMeters: float
    totalLengthMeters: float


class SyntheticReplay(BaseModel):
    method: Literal["constant_pace_lap_interpolation", "seeded_historical_lap_variability"]
    seed: int
    populationId: str
    scenarioId: str
    raceLaps: int
    fieldSize: int
    grid: SyntheticReplayGrid
    entities: list[SyntheticReplayDriver]
    caveat: str


class SimulationResponse(BaseModel):
    mode: Literal["custom"]
    scenarioType: Literal["SYNTHETIC WHAT-IF"]
    fieldMode: Literal["historical", "synthetic_100"]
    fieldLabel: str
    fieldSize: int
    fieldEvidenceType: Literal["OBSERVED", "SYNTHETIC"]
    raceLaps: int
    raceFormat: dict
    terminalState: Optional[dict] = None
    simulations: int
    fastestObservedPace: float
    virtualMaxAdvantageSecondsPerLap: float
    virtualMaxPace: float
    startingDelaySeconds: float
    deterministicMaxDelaySeconds: float
    fullFieldCatchProbability: float
    thresholds: Thresholds
    probabilityCurve: list[ProbabilityPoint]
    drivers: list[CustomDriverResult]
    timing: ScenarioTiming
    caveats: list[str]
    syntheticReplay: Optional[SyntheticReplay] = None
    raceModel: RaceModelResponse
    pureTiming: RaceModelSummary
    trafficAdjusted: Optional[RaceModelSummary] = None
    fieldVariability: dict


class JokerStrategyRequest(BaseModel):
    driverId: str = "VIRTUAL_MAX"
    routeId: Literal["joker_1", "joker_2"]
    lap: int = Field(ge=1, le=100)
    jokerSpeedFactor: float = Field(default=1.0, gt=0.1, le=1.5)
    scenario: SimulationRequest


class JokerStrategyResponse(BaseModel):
    driverId: str
    eventType: Literal["JOKER"] = "JOKER"
    status: Literal["PLANNED"] = "PLANNED"
    routeId: Literal["joker_1", "joker_2"]
    lap: int
    entryRaceTimeSeconds: float
    exitRaceTimeSeconds: float
    entryMainProgress: float
    exitMainProgress: float
    mainReplacedDistanceMeters: float
    alternateDistanceMeters: float
    mainReplacedTimeSeconds: float
    alternateRouteTimeSeconds: float
    timingDeltaSeconds: float
    speedFactor: float
    breakEvenSpeedFactor: float
    projectedRejoin: dict
    caveats: list[str]

class JokerComparisonOption(BaseModel):
    routeId: Literal["joker_1", "joker_2"]
    lap: int = Field(ge=1, le=100)
    jokerSpeedFactor: float = Field(gt=0.1, le=1.5)

class JokerComparisonRequest(BaseModel):
    driverId: str = "VIRTUAL_MAX"
    options: list[JokerComparisonOption] = Field(min_length=1, max_length=24)
    scenario: SimulationRequest


class EventSessionSummary(BaseModel):
    sessionId: Optional[str] = None
    eventId: Optional[str] = None
    sessionType: Optional[str] = None
    sessionName: Optional[str] = None
    status: Optional[str] = None
    startedAt: Optional[datetime] = None
    endedAt: Optional[datetime] = None
    sessionDurationSeconds: Optional[float] = None
    participantCount: Optional[int] = None
    lapObservationCount: Optional[int] = None
    distinctLapCount: Optional[int] = None
    eventCount: Optional[int] = None
    mediaMarkerCount: Optional[int] = None
    snapshotCount: Optional[int] = None
    maxParticipantId: Optional[str] = None
    maxBestLapSeconds: Optional[float] = None
    maxAverageLapSeconds: Optional[float] = None
    maxCompletedLaps: Optional[int] = None
    fastestParticipantId: Optional[str] = None
    fastestParticipantName: Optional[str] = None
    fastestLapSeconds: Optional[float] = None
    finalLeaderParticipantId: Optional[str] = None
    finalLeaderName: Optional[str] = None
    finalLeaderPosition: Optional[int] = None
    source: Optional[str] = None
    operationalContext: Optional[str] = None
    factualEvidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None
    goldProcessedAt: Optional[datetime] = None


class EventParticipantRaceSummary(BaseModel):
    sessionId: Optional[str] = None
    participantId: Optional[str] = None
    displayName: Optional[str] = None
    kartId: Optional[str] = None
    participantType: Optional[str] = None
    specialRole: Optional[str] = None
    externalParticipantNumber: Optional[str] = None
    lapCount: Optional[int] = None
    bestLapSeconds: Optional[float] = None
    averageLapSeconds: Optional[float] = None
    medianLapSeconds: Optional[float] = None
    totalRecordedLapTimeSeconds: Optional[float] = None
    initialPosition: Optional[int] = None
    finalPosition: Optional[int] = None
    positionChange: Optional[int] = None
    firstObservedAt: Optional[datetime] = None
    lastObservedAt: Optional[datetime] = None
    timingCatchLap: Optional[int] = None
    timingCatchTimeSeconds: Optional[float] = None
    physicalPassLap: Optional[int] = None
    physicalPassTimeSeconds: Optional[float] = None
    jokerCount: Optional[int] = None
    incidentCount: Optional[int] = None
    spinCount: Optional[int] = None
    penaltyCount: Optional[int] = None
    mediaMarkerCount: Optional[int] = None
    source: Optional[str] = None
    operationalContext: Optional[str] = None
    evidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None
    goldProcessedAt: Optional[datetime] = None


class EventPredictionVsReality(BaseModel):
    sessionId: Optional[str] = None
    scenarioSnapshotId: Optional[str] = None
    snapshotType: Optional[str] = None
    modelVersion: Optional[str] = None
    gitCommit: Optional[str] = None
    predictedVmFinishSeconds: Optional[float] = None
    actualVmFinishSeconds: Optional[float] = None
    finishTimeErrorSeconds: Optional[float] = None
    predictedVmRank: Optional[int] = None
    actualVmRank: Optional[int] = None
    rankError: Optional[int] = None
    predictedP1Lap: Optional[int] = None
    actualP1Lap: Optional[int] = None
    p1LapError: Optional[int] = None
    predictedP1TimeSeconds: Optional[float] = None
    actualP1TimeSeconds: Optional[float] = None
    p1TimeErrorSeconds: Optional[float] = None
    predictedFullFieldCatchLap: Optional[int] = None
    actualFullFieldCatchLap: Optional[int] = None
    fullFieldCatchLapError: Optional[int] = None
    predictedFullFieldCatchTimeSeconds: Optional[float] = None
    actualFullFieldCatchTimeSeconds: Optional[float] = None
    fullFieldCatchTimeErrorSeconds: Optional[float] = None
    predictedTimingCaught: Optional[int] = None
    actualTimingCaught: Optional[int] = None
    predictedCleared: Optional[int] = None
    actualCleared: Optional[int] = None
    predictionAvailable: Optional[bool] = None
    actualAvailable: Optional[bool] = None
    comparisonAvailable: Optional[bool] = None
    operationalContext: Optional[str] = None
    predictionSource: Optional[str] = None
    predictionEvidenceDomain: Optional[str] = None
    actualEvidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None
    goldProcessedAt: Optional[datetime] = None


class EventParticipantCard(BaseModel):
    sessionId: Optional[str] = None
    participantId: Optional[str] = None
    displayName: Optional[str] = None
    kartId: Optional[str] = None
    participantType: Optional[str] = None
    specialRole: Optional[str] = None
    externalParticipantNumber: Optional[str] = None
    actualStartPosition: Optional[int] = None
    actualFinalPosition: Optional[int] = None
    positionChange: Optional[int] = None
    actualBestLapSeconds: Optional[float] = None
    actualAverageLapSeconds: Optional[float] = None
    actualCompletedLaps: Optional[int] = None
    heldMaxOffLaps: Optional[float] = None
    heldMaxOffSeconds: Optional[float] = None
    timingCatchLap: Optional[int] = None
    timingCatchTimeSeconds: Optional[float] = None
    physicalPassLap: Optional[int] = None
    physicalPassTimeSeconds: Optional[float] = None
    jokerCount: Optional[int] = None
    predictedCatchLap: Optional[int] = None
    predictedFinalPosition: Optional[int] = None
    predictionErrorSeconds: Optional[float] = None
    highlightTitle: Optional[str] = None
    highlightText: Optional[str] = None
    dataProvenance: Optional[str] = None
    cardDataStatus: Optional[str] = None
    operationalContext: Optional[str] = None
    evidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None
    goldProcessedAt: Optional[datetime] = None


class EventStorylineEntry(BaseModel):
    storylineId: Optional[str] = None
    sessionId: Optional[str] = None
    raceTimeSeconds: Optional[float] = None
    lapNumber: Optional[int] = None
    participantId: Optional[str] = None
    targetParticipantId: Optional[str] = None
    storyType: Optional[str] = None
    storyCategory: Optional[str] = None
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    sourceRecordType: Optional[str] = None
    sourceRecordId: Optional[str] = None
    source: Optional[str] = None
    operationalContext: Optional[str] = None
    evidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None
    goldProcessedAt: Optional[datetime] = None


class EventStandingReplay(BaseModel):
    sessionId: Optional[str] = None
    snapshotId: Optional[str] = None
    sourceSnapshotKey: Optional[str] = None
    participantId: Optional[str] = None
    externalParticipantNumber: Optional[str] = None
    observedAt: Optional[datetime] = None
    sourceTimestamp: Optional[datetime] = None
    recordedAt: Optional[datetime] = None
    ingestedAt: Optional[datetime] = None
    position: Optional[int] = None
    lapNumber: Optional[int] = None
    elapsedTimeSeconds: Optional[float] = None
    gapFirstSeconds: Optional[float] = None
    gapFirstLaps: Optional[int] = None
    gapPreviousSeconds: Optional[float] = None
    gapPreviousLaps: Optional[int] = None
    status: Optional[str] = None
    positionChange: Optional[int] = None
    atLoop: Optional[str] = None
    source: Optional[str] = None
    operationalContext: Optional[str] = None
    evidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None


class EventObservedReplaySummary(BaseModel):
    """Factual aggregation of the persisted AKS replay evidence for one session."""
    sessionId: Optional[str] = None
    standingSnapshotCount: Optional[int] = None
    standingRowCount: Optional[int] = None
    latestStandingObservedAt: Optional[datetime] = None
    latestStandingLap: Optional[int] = None
    latestObservedLeaderParticipantId: Optional[str] = None
    latestObservedLeaderExternalParticipantNumber: Optional[str] = None
    latestFieldSpreadSeconds: Optional[float] = None
    positionSampleCount: Optional[int] = None
    gpsCorrectedSampleCount: Optional[int] = None
    rgpsRawSampleCount: Optional[int] = None
    scSourceSampleCount: Optional[int] = None
    positionFirstObservedAt: Optional[datetime] = None
    positionLastObservedAt: Optional[datetime] = None


class EventTrackGeometryPoint(BaseModel):
    latitude: float
    longitude: float


class EventTrackGeometry(BaseModel):
    source: str = "GPS_CORRECTED"
    derivedFrom: str = "FULL_SESSION_OBSERVED_POSITIONS"
    sourceEntityId: Optional[str] = None
    pointCount: int = 0
    observedFrom: Optional[datetime] = None
    observedTo: Optional[datetime] = None
    points: list[EventTrackGeometryPoint] = Field(default_factory=list)


class EventTrackReplay(BaseModel):
    sessionId: Optional[str] = None
    sampleId: Optional[str] = None
    sourceEntityId: Optional[str] = None
    participantId: Optional[str] = None
    externalParticipantNumber: Optional[str] = None
    observedAt: Optional[datetime] = None
    sourceTimestamp: Optional[datetime] = None
    recordedAt: Optional[datetime] = None
    positionSource: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    rawStatusBits: Optional[int] = None
    unknownStatusBits: Optional[int] = None
    isOfficialCar: Optional[bool] = None
    isLeader: Optional[bool] = None
    isLapped: Optional[bool] = None
    isClassLeader: Optional[bool] = None
    isStopped: Optional[bool] = None
    isClassLapped: Optional[bool] = None
    isInPit: Optional[bool] = None
    isOutLap: Optional[bool] = None
    isPositionUnknown: Optional[bool] = None
    isRetired: Optional[bool] = None
    isLate: Optional[bool] = None
    isEntryListTarget: Optional[bool] = None
    isNoGps: Optional[bool] = None
    isChequered: Optional[bool] = None
    source: Optional[str] = None
    operationalContext: Optional[str] = None
    evidenceDomain: Optional[str] = None
    eventContractVersion: Optional[str] = None


# Event Moments are event-day operational records. They intentionally carry no
# driver names, photos, media URLs, handles, or other personal identity data.
class EventMomentCreateRequest(BaseModel):
    momentType: Literal[
        "PRE_RACE", "START", "MID_RACE", "POSITION_CHANGE", "GAP_CHANGE", "LEADER_CHANGE",
        "PREDICTION_CHANGE", "TARGET_CHANGE", "CONFIRMED_PASS", "FASTEST_LAP",
        "CHALLENGER_PERFORMANCE", "KEY_MOMENT", "CONTROL_ROOM_REACTION", "END_OF_CAPTURE",
        "FINISH", "MANUAL_MARKER",
    ]
    title: Optional[str] = Field(default=None, max_length=512)
    description: Optional[str] = Field(default=None, max_length=4000)
    primaryParticipantId: Optional[str] = Field(default=None, max_length=128)
    relatedParticipantId: Optional[str] = Field(default=None, max_length=128)
    observedAt: Optional[datetime] = None
    importance: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"] = "MEDIUM"
    socialPriority: Literal["LOW", "MEDIUM", "HIGH"] = "MEDIUM"
    operatorNote: Optional[str] = Field(default=None, max_length=4000)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def confirmed_pass_requires_explicit_operator_evidence(self):
        if self.momentType == "CONFIRMED_PASS" and (not self.primaryParticipantId or not self.relatedParticipantId):
            raise ValueError("CONFIRMED_PASS requires primaryParticipantId and relatedParticipantId from explicit operator evidence.")
        return self


class EventMoment(BaseModel):
    momentId: str
    sessionId: str
    momentType: str
    title: Optional[str] = None
    description: Optional[str] = None
    triggerMode: Literal["AUTOMATIC", "OPERATOR"]
    triggerRule: Optional[str] = None
    observedAt: datetime
    recordedAt: datetime
    createdAt: datetime
    primaryParticipantId: Optional[str] = None
    relatedParticipantId: Optional[str] = None
    externalParticipantNumber: Optional[str] = None
    relatedExternalParticipantNumber: Optional[str] = None
    sourceSnapshotId: Optional[str] = None
    priorValue: Optional[float] = None
    currentValue: Optional[float] = None
    deltaValue: Optional[float] = None
    unit: Optional[str] = None
    importance: str
    socialPriority: str
    operatorNote: Optional[str] = None
    source: str = "RACE_OPERATIONS"
    operationalContext: Optional[str] = None
    evidenceDomain: str
    eventContractVersion: str = "1.0"
    syncStatus: Optional[str] = None


class EventParticipantSnapshot(BaseModel):
    snapshotId: str
    momentId: str
    sessionId: str
    participantId: str
    externalParticipantNumber: Optional[str] = None
    observedAt: datetime
    sourceSnapshotId: Optional[str] = None
    position: Optional[int] = None
    lapNumber: Optional[int] = None
    gapFirstSeconds: Optional[float] = None
    gapPreviousSeconds: Optional[float] = None
    positionChange: Optional[int] = None
    atLoop: Optional[str] = None
    status: Optional[str] = None
    startPosition: Optional[int] = None
    peakPosition: Optional[int] = None
    source: str = "AKS"
    operationalContext: Optional[str] = None
    evidenceDomain: str = "FACTUAL_OBSERVATION"
    eventContractVersion: str = "1.0"


# Actual Event capture write contracts. These are intentionally separate from
# the serving response models above: accepted records are journaled locally and
# are only visible through ADB after the governed Bronze-to-serving pipeline.
class EventWriteAcknowledgement(BaseModel):
    id: str
    sessionId: str
    operation: str
    syncStatus: Literal["PENDING", "SYNCED", "FAILED"]
    recordedAt: datetime
    message: str


# Read-only operational recovery models. They intentionally expose a stable
# projection of accepted Event Capture records, never raw JSONL journal rows.
class EventCaptureParticipantState(BaseModel):
    participantId: str
    displayName: Optional[str] = None
    kartId: Optional[str] = None
    participantType: Optional[str] = None
    specialRole: Optional[str] = None
    source: Optional[str] = None


class EventCaptureActivity(BaseModel):
    id: str
    operation: str
    entityKind: str
    syncStatus: Literal["PENDING", "SYNCED", "FAILED"]
    recordedAt: datetime
    participantId: Optional[str] = None
    targetParticipantId: Optional[str] = None
    lapNumber: Optional[int] = None
    eventType: Optional[str] = None
    title: Optional[str] = None


class EventCaptureSessionState(BaseModel):
    sessionId: str
    eventId: Optional[str] = None
    sessionType: Optional[str] = None
    sessionName: Optional[str] = None
    status: Literal["CREATED", "RECORDING", "COMPLETED"]
    source: Optional[str] = None
    operator: Optional[str] = None
    createdAt: datetime
    startedAt: Optional[datetime] = None
    endedAt: Optional[datetime] = None
    participants: list[EventCaptureParticipantState] = []
    recentCaptures: list[EventCaptureActivity] = []


class EventSessionCreateRequest(BaseModel):
    sessionId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    eventId: str = Field(min_length=1, max_length=128)
    sessionType: Literal["PRACTICE", "QUALIFYING", "RACE", "REPLAY"]
    sessionName: Optional[str] = Field(default=None, max_length=256)
    operator: Optional[str] = Field(default=None, max_length=256)
    notes: Optional[str] = Field(default=None, max_length=4000)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)


class EventParticipantCreateRequest(BaseModel):
    participantId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    displayName: Optional[str] = Field(default=None, max_length=256)
    kartId: Optional[str] = Field(default=None, max_length=128)
    participantType: Literal["MAX", "CHALLENGER", "ORACLE_DRIVER", "UNCLASSIFIED"]
    specialRole: Optional[str] = Field(default=None, max_length=128)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)


class EventLapCreateRequest(BaseModel):
    observationId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    participantId: str = Field(min_length=1, max_length=128)
    lapNumber: int = Field(ge=1, le=10000)
    lapTimeSeconds: Optional[float] = Field(default=None, gt=0, le=36000)
    sector1Seconds: Optional[float] = Field(default=None, gt=0, le=36000)
    sector2Seconds: Optional[float] = Field(default=None, gt=0, le=36000)
    sector3Seconds: Optional[float] = Field(default=None, gt=0, le=36000)
    position: Optional[int] = Field(default=None, ge=1, le=10000)
    gapToMaxSeconds: Optional[float] = Field(default=None, ge=-36000, le=36000)
    gapToLeaderSeconds: Optional[float] = Field(default=None, ge=-36000, le=36000)
    observedAt: Optional[datetime] = None
    operatorNote: Optional[str] = Field(default=None, max_length=4000)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)

    @model_validator(mode="after")
    def validate_sector_sum(self):
        sectors = [self.sector1Seconds, self.sector2Seconds, self.sector3Seconds]
        if self.lapTimeSeconds is not None and all(value is not None for value in sectors):
            if sum(sectors) > self.lapTimeSeconds + 0.001:
                raise ValueError("Sector times cannot exceed lapTimeSeconds.")
        return self


class EventRaceEventCreateRequest(BaseModel):
    eventRecordId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    raceTimeSeconds: Optional[float] = Field(default=None, ge=0, le=86400)
    lapNumber: Optional[int] = Field(default=None, ge=1, le=10000)
    participantId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    targetParticipantId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    eventType: Literal[
        "SESSION_START", "SESSION_END", "LAP_COMPLETE", "TIMING_CATCH", "PASS",
        "JOKER", "INCIDENT", "SPIN", "PENALTY", "MAX_APPROACHING",
        "MAX_PASSES_DRIVER", "OPERATOR_NOTE",
    ]
    value: Optional[str] = Field(default=None, max_length=4000)
    notes: Optional[str] = Field(default=None, max_length=4000)
    recordedAt: Optional[datetime] = None
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)


class EventMediaMarkerCreateRequest(BaseModel):
    markerId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    raceTimeSeconds: Optional[float] = Field(default=None, ge=0, le=86400)
    lapNumber: Optional[int] = Field(default=None, ge=1, le=10000)
    participantId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    markerType: Literal[
        "MAX_CLOSES_ON_ORACLE_CAR", "MAX_PASSES_ORACLE_CAR", "BIG_PREDICTION_CHANGE",
        "BIGGEST_GAP_CHANGE", "BEST_DASHBOARD_MOMENT", "CARD_HIGHLIGHT",
        "DEBRIEF_MOMENT", "GENERAL",
    ]
    title: str = Field(min_length=1, max_length=512)
    notes: Optional[str] = Field(default=None, max_length=4000)
    priority: Literal["LOW", "MEDIUM", "HIGH"]
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)


class EventScenarioSnapshotCreateRequest(BaseModel):
    scenarioSnapshotId: Optional[str] = Field(default=None, min_length=1, max_length=128)
    snapshotType: str = Field(min_length=1, max_length=128)
    fieldMode: Optional[str] = Field(default=None, max_length=128)
    raceFormat: Optional[str] = Field(default=None, max_length=128)
    raceLaps: Optional[int] = Field(default=None, ge=1, le=10000)
    raceDurationSeconds: Optional[float] = Field(default=None, gt=0, le=86400)
    virtualMaxPaceSeconds: Optional[float] = Field(default=None, gt=0, le=36000)
    virtualMaxGainSecondsPerLap: Optional[float] = Field(default=None, ge=-36000, le=36000)
    startingDelaySeconds: Optional[float] = Field(default=None, ge=-36000, le=36000)
    raceModelMode: Optional[str] = Field(default=None, max_length=128)
    fieldVariabilityMode: Optional[str] = Field(default=None, max_length=128)
    fieldVariabilitySeed: Optional[int] = Field(default=None, ge=0)
    paceProfileJson: Optional[str] = Field(default=None, max_length=100000)
    trafficModelJson: Optional[str] = Field(default=None, max_length=100000)
    jokerConfigJson: Optional[str] = Field(default=None, max_length=100000)
    vmProjectedFinishSeconds: Optional[float] = Field(default=None, ge=0, le=86400)
    vmProjectedRank: Optional[int] = Field(default=None, ge=1, le=10000)
    predictedP1Lap: Optional[int] = Field(default=None, ge=1, le=10000)
    predictedP1TimeSeconds: Optional[float] = Field(default=None, ge=0, le=86400)
    predictedFullFieldCatchLap: Optional[int] = Field(default=None, ge=1, le=10000)
    predictedFullFieldCatchTimeSeconds: Optional[float] = Field(default=None, ge=0, le=86400)
    timingCaught: Optional[int] = Field(default=None, ge=0, le=100000)
    cleared: Optional[int] = Field(default=None, ge=0, le=100000)
    stillToClear: Optional[int] = Field(default=None, ge=0, le=100000)
    modelVersion: Optional[str] = Field(default=None, max_length=256)
    gitCommit: Optional[str] = Field(default=None, max_length=128)
    idempotencyKey: Optional[str] = Field(default=None, min_length=1, max_length=128)
