"""Pure AKS-state normalizer; it deliberately does not persist Event Capture data."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping

from .models import decode_coordinates, decode_status
from .state import AksStateStore


def _value(record: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in record:
            return record[name]
    return None


def _records(value: Any) -> list[dict[str, Any]]:
    if isinstance(value, list):
        return [item for item in value if isinstance(item, dict)]
    if isinstance(value, dict):
        # AKS commonly keys snapshot maps by the participant number.  Preserve
        # that identity when a nested object does not repeat it in its payload.
        records: list[dict[str, Any]] = []
        for key, item in value.items():
            if isinstance(item, dict):
                record = dict(item)
                record.setdefault("participant", key)
                records.append(record)
        return records
    return []


def _seconds(milliseconds: Any) -> float | None:
    try:
        value = float(milliseconds)
    except (TypeError, ValueError):
        return None
    return value / 1000 if value > 0 else None


@dataclass(frozen=True)
class AksProvenance:
    source_system: str
    source_channel: str
    source_message_id: str | None
    normalized_at: datetime


@dataclass(frozen=True)
class AksNormalizedSession:
    event_id: str | None
    session_id: str | None
    session_name: str | None
    session_type: str | None
    status: str
    source_date: Any
    mapping_condition: str | None
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedParticipant:
    session_id: str | None
    participant_id: str
    external_participant_number: str
    display_name: str
    participant_type: str | None
    special_role: str | None
    metadata: dict[str, Any]
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedLap:
    session_id: str | None
    participant_id: str
    lap_number: int
    lap_time_seconds: float | None
    sector_1_seconds: float | None
    sector_2_seconds: float | None
    sector_3_seconds: float | None
    position: int | None
    observed_at: Any
    is_valid: bool | None
    metadata: dict[str, Any]
    dedupe_key: tuple[str | None, str, int]
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedStandingsEntry:
    session_id: str | None
    participant_id: str
    position: int | None
    lap_number: int | None
    elapsed_time_seconds: float | None
    gap_first_seconds: float | None
    gap_first_laps: int | None
    gap_previous_seconds: float | None
    gap_previous_laps: int | None
    status: Any
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedParticipantState:
    session_id: str | None
    participant_id: str
    current_lap: Any
    elapsed_laps: Any
    current_sector: Any
    current_loop: Any
    running: Any
    status: Any
    has_seen_checkered: Any
    current_lap_valid: Any
    metadata: dict[str, Any]
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedPosition:
    session_id: str | None
    participant_id: str
    source: str
    latitude: float | None
    longitude: float | None
    raw_status: int
    decoded_status_flags: list[str]
    unknown_status_bits: int
    observed_at: Any
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedSessionStatus:
    current_flag: Any
    current_lap: Any
    elapsed_laps: Any
    final_laps: Any
    final_time_seconds: float | None
    final_type: Any
    is_closed: bool
    is_finished: bool
    is_session_running: bool
    session_start_time: Any
    stopped_seconds: float | None
    provenance: AksProvenance


@dataclass(frozen=True)
class AksNormalizedLiveEvent:
    session_id: str | None
    participant_id: str
    lap_number: int
    event_type: str
    race_time_seconds: float | None
    lap_time_seconds: float | None
    lap_time_valid: bool | None
    is_pit: bool | None
    dedupe_key: tuple[str | None, str, int, str]
    provenance: AksProvenance


@dataclass(frozen=True)
class AksParticipantIdentity:
    participant_id: str | None = None
    participant_type: str | None = None
    special_role: str | None = None
    display_name: str | None = None
    kart_id: str | None = None


class AksIdentityMapper:
    """Event-specific identities are injected later; defaults stay source-safe."""

    def __init__(self, mappings: Mapping[str, AksParticipantIdentity] | None = None):
        self._mappings = dict(mappings or {})

    def map(self, participant_number: Any) -> AksParticipantIdentity:
        number = str(participant_number)
        configured = self._mappings.get(number)
        return configured or AksParticipantIdentity(participant_id=f"AKS_{number}", participant_type="UNCLASSIFIED")

    def is_explicit(self, participant_number: Any) -> bool:
        """Whether an operator/configuration supplied an identity mapping."""
        return str(participant_number) in self._mappings


@dataclass
class AksNormalizationResult:
    session: AksNormalizedSession | None = None
    session_status: AksNormalizedSessionStatus | None = None
    participants: list[AksNormalizedParticipant] = field(default_factory=list)
    laps: list[AksNormalizedLap] = field(default_factory=list)
    standings: list[AksNormalizedStandingsEntry] = field(default_factory=list)
    participant_states: list[AksNormalizedParticipantState] = field(default_factory=list)
    positions: list[AksNormalizedPosition] = field(default_factory=list)
    live_events: list[AksNormalizedLiveEvent] = field(default_factory=list)
    issues: list[str] = field(default_factory=list)


class AksStateNormalizer:
    """Deterministic AKS → internal Event Capture candidate conversion only."""

    def __init__(self, identity_mapper: AksIdentityMapper | None = None):
        self.identity_mapper = identity_mapper or AksIdentityMapper()

    def normalize(self, state: AksStateStore | Mapping[str, Any]) -> AksNormalizationResult:
        accessor = state if isinstance(state, AksStateStore) else None
        raw = state.get_state() if accessor else dict(state)
        result = AksNormalizationResult()
        info = self._path(raw, "timing.session.info")
        status = self._path(raw, "timing.session.status")
        session, session_status = self._normalize_session(info, status, self._provenance(accessor, "timing.session.info"), self._provenance(accessor, "timing.session.status"))
        result.session, result.session_status = session, session_status
        session_id = session.session_id if session else None
        entries = self._path(raw, "timing.session.entry")
        result.participants = self._normalize_participants(session_id, entries, self._provenance(accessor, "timing.session.entry"))
        lap_source = self._path(raw, "timing.analysis.laps")
        result.laps, lap_issues = self._normalize_laps(session_id, lap_source, self._provenance(accessor, "timing.analysis.laps"))
        result.issues.extend(lap_issues)
        result.live_events = self._normalize_live_events(session_id, self._path(raw, "timing.liveEvents.fl"), self._provenance(accessor, "timing.liveEvents.fl"))
        result.standings = self._normalize_standings(session_id, self._path(raw, "timing.session.standings.overall.active"), self._provenance(accessor, "timing.session.standings.overall.active"))
        result.standings.extend(self._normalize_standings(session_id, self._path(raw, "timing.session.standings.overall.finishLine"), self._provenance(accessor, "timing.session.standings.overall.finishLine")))
        result.participant_states = self._normalize_participant_states(session_id, self._path(raw, "timing.session.standings.overall.participantDetails"), self._provenance(accessor, "timing.session.standings.overall.participantDetails"))
        result.positions.extend(self._normalize_positions(session_id, self._path(raw, "gps"), "GPS", self._provenance(accessor, "gps")))
        result.positions.extend(self._normalize_positions(session_id, self._path(raw, "rgps"), "RGPS", self._provenance(accessor, "rgps")))
        return result

    @staticmethod
    def _path(raw: Mapping[str, Any], path: str) -> Any:
        value: Any = raw
        for part in path.split("."):
            if not isinstance(value, Mapping):
                return None
            value = value.get(part)
        return value

    @staticmethod
    def _provenance(store: AksStateStore | None, channel: str) -> AksProvenance:
        metadata = None
        if store:
            parts = channel.split(".")
            for size in range(len(parts), 0, -1):
                metadata = store.get_metadata(".".join(parts[:size]))
                if metadata:
                    break
        return AksProvenance("AKS", channel, metadata.get("message_id") if metadata else None, datetime.now(timezone.utc))

    def _participant(self, number: Any) -> tuple[str, AksParticipantIdentity]:
        number = str(number)
        return number, self.identity_mapper.map(number)

    def _normalize_session(self, info: Any, status: Any, info_provenance: AksProvenance, status_provenance: AksProvenance):
        info = info if isinstance(info, Mapping) else {}
        status = status if isinstance(status, Mapping) else {}
        raw_type = _value(info, "type", "sessionType")
        type_map = {"FREE_PRACTICE": "PRACTICE", "QUALIFYING_BEST_LAP": "QUALIFYING", "QUALIFYING_AVERAGE": "QUALIFYING", "RACE": "RACE"}
        mapped_type = type_map.get(str(raw_type)) if raw_type is not None else None
        condition = None if mapped_type or raw_type is None else f"UNSUPPORTED_SESSION_TYPE:{raw_type}"
        is_closed, is_finished, is_running = bool(_value(status, "isClosed", "is_closed")), bool(_value(status, "isFinished", "is_finished")), bool(_value(status, "isSessionRunning", "is_session_running"))
        normalized_status = "COMPLETED" if is_closed or is_finished else "RECORDING" if is_running else "CREATED"
        external_id = _value(info, "sessionId", "session_id", "sessionDbId", "id", "shortName")
        session_id = f"AKS_{external_id}" if external_id is not None else None
        session = AksNormalizedSession(_value(info, "eventName", "event_id"), session_id, _value(info, "name", "sessionName", "shortName"), mapped_type, normalized_status, _value(info, "date"), condition, info_provenance) if info or status else None
        session_status = AksNormalizedSessionStatus(_value(status, "currentFlag", "current_flag"), _value(status, "currentLap", "current_lap"), _value(status, "elapsedLaps", "elapsed_laps"), _value(status, "finalLaps", "final_laps"), _seconds(_value(status, "finalTime", "final_time")), _value(status, "finalType", "final_type"), is_closed, is_finished, is_running, _value(status, "sessionStartTime", "session_start_time"), _seconds(_value(status, "stopped", "stoppedSeconds")), status_provenance) if status else None
        return session, session_status

    def _normalize_participants(self, session_id, entries, provenance):
        output = []
        for entry in _records(entries):
            raw_number = _value(entry, "participant", "number", "participantNumber", "key")
            if raw_number is None:
                continue
            number, identity = self._participant(raw_number)
            driver = _value(entry, "currentDriver", "driver") or {}
            if not isinstance(driver, Mapping):
                driver = {}
            drivers = _value(entry, "drivers")
            if not driver and isinstance(drivers, list) and drivers and isinstance(drivers[0], Mapping):
                driver = drivers[0]
            source_display = _value(entry, "name", "participantName") or _value(driver, "shortName") or " ".join(filter(None, [_value(driver, "firstName"), _value(driver, "lastName")])) or None
            # Source display metadata is retained for review, but an unmapped
            # source number never becomes an asserted real-world identity.
            display = identity.display_name if self.identity_mapper.is_explicit(number) and identity.display_name else f"AKS_{number}"
            output.append(AksNormalizedParticipant(session_id, identity.participant_id or f"AKS_{number}", number, display, identity.participant_type, identity.special_role, {"kart_id": identity.kart_id if self.identity_mapper.is_explicit(number) else None, "source_display_name": source_display, "driver_id": _value(entry, "driverId"), "drivers": _value(entry, "drivers"), "transponders": _value(entry, "transponders"), "team": _value(entry, "team"), "vehicle": _value(entry, "vehicle")}, provenance))
        return output

    def _normalize_laps(self, session_id, laps, provenance):
        output, issues, seen = [], [], set()
        for lap in _records(laps):
            raw_number, lap_number = _value(lap, "participant"), _value(lap, "lapNum", "lapNumber")
            try:
                lap_number = int(lap_number)
            except (TypeError, ValueError):
                lap_number = 0
            if raw_number is None or lap_number <= 0:
                issues.append("Skipped AKS lap without a positive participant/lap identity.")
                continue
            number, identity = self._participant(raw_number)
            participant_id = identity.participant_id or f"AKS_{number}"
            dedupe_key = (session_id, participant_id, lap_number)
            if dedupe_key in seen:
                issues.append("Skipped duplicate AKS analysis lap identity.")
                continue
            seen.add(dedupe_key)
            sectors = _value(lap, "sectors") or []
            sector_values = [_seconds(_value(item, "time") if isinstance(item, Mapping) else None) for item in sectors[:3]] if isinstance(sectors, list) else []
            sector_values += [None] * (3 - len(sector_values))
            output.append(AksNormalizedLap(session_id, participant_id, lap_number, _seconds(_value(lap, "time")), *sector_values, _value(lap, "position"), _value(lap, "startTime"), _value(lap, "isValid"), {"track_limits": _value(lap, "trackLimits"), "raw_time_ms": _value(lap, "time")}, dedupe_key, provenance))
        return output, issues

    def _normalize_live_events(self, session_id, events, provenance):
        output, seen = [], set()
        for event in _records(events):
            raw_number, lap_number = _value(event, "participant"), _value(event, "lapNumber")
            if raw_number is None or not isinstance(lap_number, int) or lap_number <= 0:
                continue
            number, identity = self._participant(raw_number)
            participant_id = identity.participant_id or f"AKS_{number}"
            dedupe_key = (session_id, participant_id, lap_number, "LAP_COMPLETE")
            if dedupe_key not in seen:
                seen.add(dedupe_key)
                output.append(AksNormalizedLiveEvent(session_id, participant_id, lap_number, "LAP_COMPLETE", _seconds(_value(event, "elapsedTime")), _seconds(_value(event, "lapTime")), _value(event, "lapTimeValid"), _value(event, "isPit"), dedupe_key, provenance))
        return output

    def _normalize_standings(self, session_id, standings, provenance):
        output = []
        for row in _records(standings):
            raw_number = _value(row, "participant")
            if raw_number is None:
                continue
            number, identity = self._participant(raw_number)
            output.append(AksNormalizedStandingsEntry(session_id, identity.participant_id or f"AKS_{number}", _value(row, "position"), _value(row, "lapNumber"), _seconds(_value(row, "elapsedTime")), _seconds(_value(row, "gapFirstTime")), _value(row, "gapFirstLaps"), _seconds(_value(row, "gapPreviousTime")), _value(row, "gapPreviousLaps"), _value(row, "status"), provenance))
        return output

    def _normalize_participant_states(self, session_id, details, provenance):
        output = []
        for row in _records(details):
            raw_number = _value(row, "participant")
            if raw_number is None:
                continue
            number, identity = self._participant(raw_number)
            metadata_keys = ("currentLapTrackLimits", "lastLap", "lastSectors", "pitStops", "trackLimits", "trackLimitsInfractions", "penalties", "pendingPenalties", "transponderActive")
            output.append(AksNormalizedParticipantState(session_id, identity.participant_id or f"AKS_{number}", _value(row, "currentLap"), _value(row, "elapsedLaps"), _value(row, "currentSector"), _value(row, "currentLoop"), _value(row, "running"), _value(row, "status"), _value(row, "hasSeenCheckered"), _value(row, "currentLapValid"), {key: row.get(key) for key in metadata_keys}, provenance))
        return output

    def _normalize_positions(self, session_id, positions, source, provenance):
        output = []
        for row in _records(positions):
            raw_number = _value(row, "participant", "number", "participantNumber")
            if raw_number is None:
                continue
            number, identity = self._participant(raw_number)
            coords, status = decode_coordinates(_value(row, "lat", "latitude"), _value(row, "lon", "longitude")), decode_status(_value(row, "status"))
            output.append(AksNormalizedPosition(session_id, identity.participant_id or f"AKS_{number}", source, coords["latitude"], coords["longitude"], status["raw_status"], status["flags"], status["unknown_bits"], _value(row, "observedAt", "receivedAt", "time"), provenance))
        return output
