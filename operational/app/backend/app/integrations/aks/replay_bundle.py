"""Deterministic, source-safe AKS temporal replay extraction.

This module is deliberately separate from the terminal-state normalizer.  It
turns a raw-v1 recording into a *small governed replay bundle* for upload to
the AIDP landing Volume: reconstructed active standings and sampled GPS/RGPS
positions.  It never claims a finish, pass, catch, official lap, or identity.
"""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Any, Iterable, Mapping

from .models import GPS_STATUS_FLAGS
from .normalizer import AksIdentityMapper
from .protocol import parse_packet
from .recording import AksRecordedMessage
from .state import merge_delta


REPLAY_BUNDLE_VERSION = "aks-replay-bundle.v1"
EVENT_CONTRACT_VERSION = "1.0"
SOURCE = "AKS"
OPERATIONAL_CONTEXT = "REHEARSAL"
EVIDENCE_DOMAIN = "FACTUAL_OBSERVATION"
POSITION_SOURCES = {"gps": "GPS_CORRECTED", "rgps": "RGPS_RAW"}


def _canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), default=str)


def _stable_id(kind: str, value: Mapping[str, Any]) -> str:
    return f"{kind}-" + hashlib.sha256(_canonical(value).encode("utf-8")).hexdigest()[:24]


def _timestamp(value: datetime | None) -> str | None:
    if value is None:
        return None
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _value(record: Mapping[str, Any], *names: str) -> Any:
    for name in names:
        if name in record:
            return record[name]
    return None


def _records(value: Any) -> Iterable[tuple[str, dict[str, Any]]]:
    if isinstance(value, Mapping):
        for key, item in value.items():
            if isinstance(item, Mapping):
                row = dict(item)
                row.setdefault("participant", key)
                yield str(key), row
    elif isinstance(value, list):
        for index, item in enumerate(value):
            if isinstance(item, Mapping):
                row = dict(item)
                identifier = str(_value(row, "participant", "number", "id") or index)
                yield identifier, row


def _seconds(value: Any) -> float | None:
    """AKS milliseconds, retaining a factual zero as 0.0."""
    try:
        return float(value) / 1000.0
    except (TypeError, ValueError):
        return None


def _integer(value: Any) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _path(root: Mapping[str, Any], path: str) -> Any:
    value: Any = root
    for name in path.split("."):
        if not isinstance(value, Mapping):
            return None
        value = value.get(name)
    return value


def _payload(message: AksRecordedMessage) -> Mapping[str, Any] | None:
    if message.command != "JSON":
        return None
    try:
        packet = parse_packet(message.wire_line)
        value = json.loads(packet.data)
    except (ValueError, json.JSONDecodeError):
        return None
    return value if isinstance(value, Mapping) else None


def _base(session_id: str, recorded_at: datetime | None) -> dict[str, Any]:
    # Recorder envelope time is the only temporal source for real GPS/RGPS.
    recorded = _timestamp(recorded_at)
    return {
        "session_id": session_id,
        "observed_at": recorded,
        "source_timestamp": None,
        "recorded_at": recorded,
        "source": SOURCE,
        "operational_context": OPERATIONAL_CONTEXT,
        "evidence_domain": EVIDENCE_DOMAIN,
        "event_contract_version": EVENT_CONTRACT_VERSION,
    }


def _identity(source_entity_id: str, mapper: AksIdentityMapper) -> tuple[str | None, str | None]:
    if source_entity_id == "SC":
        return None, None
    identity = mapper.map(source_entity_id)
    return identity.participant_id, source_entity_id


def _status(raw_status: Any) -> dict[str, Any]:
    bits = _integer(raw_status)
    known_mask = 0
    for bit in GPS_STATUS_FLAGS:
        known_mask |= bit
    bits = bits if bits is not None else None
    result: dict[str, Any] = {
        "raw_status_bits": bits,
        "unknown_status_bits": (bits & ~known_mask) if bits is not None else None,
    }
    mapping = {
        "is_official_car": "OfficialCar", "is_leader": "Leader", "is_lapped": "Lapped",
        "is_class_leader": "ClassLeader", "is_stopped": "Stopped", "is_class_lapped": "ClassLapped",
        "is_in_pit": "InPit", "is_out_lap": "OutLap", "is_position_unknown": "PositionUnknown",
        "is_retired": "Retired", "is_late": "Late", "is_entry_list_target": "EntryListTarget",
        "is_no_gps": "NoGpsPosition", "is_chequered": "Chequered",
    }
    for column, label in mapping.items():
        bit = next(key for key, value in GPS_STATUS_FLAGS.items() if value == label)
        result[column] = bool(bits & bit) if bits is not None else None
    return result


def extract_replay_rows(
    messages: Iterable[AksRecordedMessage], *, session_id: str, identity_mapper: AksIdentityMapper | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Reconstruct change-driven standings and source-distinct position rows.

    Message iteration order is authoritative (recording manifest order followed
    by JSONL line order).  No sort is applied before reconstruction.
    """
    mapper = identity_mapper or AksIdentityMapper()
    state: dict[str, Any] = {}
    standings: list[dict[str, Any]] = []
    positions: list[dict[str, Any]] = []
    previous_standings: str | None = None
    snapshot_number = 0
    for message in messages:
        payload = _payload(message)
        if payload is None:
            continue
        # Replay standings requires only the timing branch.  Retaining every
        # high-frequency GPS/RGPS object in this differential tree would turn
        # a linear recording pass into repeated full-state copies.
        timing_delta = payload.get("timing")
        if isinstance(timing_delta, Mapping):
            state = merge_delta(state, {"timing": dict(timing_delta)})
        active = _path(state, "timing.session.standings.overall.active")
        active_key = _canonical(active) if isinstance(active, (Mapping, list)) else None
        if active_key is not None and active_key != previous_standings:
            snapshot_number += 1
            source_snapshot_key = f"{message.sequence_number}:{message.source_file}:{message.message_id}"
            for _, entry in _records(active):
                source_entity_id = str(_value(entry, "participant", "number", "id") or "")
                participant_id, external_number = _identity(source_entity_id, mapper)
                row = _base(session_id, message.recorded_at)
                row.update({
                    "source_snapshot_key": source_snapshot_key,
                    "participant_id": participant_id,
                    "external_participant_number": external_number,
                    "position": _integer(_value(entry, "position")),
                    "lap_number": _integer(_value(entry, "lapNumber", "lap_number")),
                    "elapsed_time_seconds": _seconds(_value(entry, "elapsedTime", "elapsed_time")),
                    "gap_first_seconds": _seconds(_value(entry, "gapFirstTime", "gap_first_time")),
                    "gap_first_laps": _integer(_value(entry, "gapFirstLaps", "gap_first_laps")),
                    "gap_previous_seconds": _seconds(_value(entry, "gapPreviousTime", "gap_previous_time")),
                    "gap_previous_laps": _integer(_value(entry, "gapPreviousLaps", "gap_previous_laps")),
                    "status": _value(entry, "status"),
                    "position_change": _integer(_value(entry, "positionChange", "position_change")),
                    "at_loop": _value(entry, "atLoop", "at_loop"),
                })
                row["snapshot_id"] = _stable_id("standing-snapshot", {"session": session_id, "key": source_snapshot_key})
                standings.append(row)
            previous_standings = active_key
        # Only entities present in the incoming source delta are raw samples;
        # state reconstruction must not emit every unchanged GPS entity.
        for channel, position_source in POSITION_SOURCES.items():
            delta = payload.get(channel)
            for source_entity_id, entry in _records(delta):
                lat, lon = _value(entry, "lat", "latitude"), _value(entry, "lon", "longitude")
                participant_id, external_number = _identity(source_entity_id, mapper)
                row = _base(session_id, message.recorded_at)
                row.update({
                    "source_entity_id": source_entity_id,
                    "participant_id": participant_id,
                    "external_participant_number": external_number,
                    "position_source": position_source,
                    "latitude": (float(lat) / 1_000_000.0) if lat is not None else None,
                    "longitude": (float(lon) / 1_000_000.0) if lon is not None else None,
                })
                row.update(_status(_value(entry, "status")))
                row["sample_id"] = _stable_id("position-sample", {"session": session_id, "source": position_source, "entity": source_entity_id, "sequence": message.sequence_number, "message": message.message_id})
                positions.append(row)
    return standings, positions


def sample_position_rows(rows: Iterable[Mapping[str, Any]], *, interval_milliseconds: int = 500) -> list[dict[str, Any]]:
    """Keep valid-coordinate rows at deterministic 500ms source/entity cadence.

    A status change is retained even within an interval so replay renderers do
    not lose factual status transitions.  Invalid coordinates remain Bronze
    evidence but are excluded from this projection-ready sampled output.
    """
    if interval_milliseconds <= 0:
        raise ValueError("interval_milliseconds must be positive")
    def time_key(row: Mapping[str, Any]) -> datetime:
        value = str(row.get("recorded_at") or "")
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return datetime.min.replace(tzinfo=timezone.utc)

    ordered = sorted((dict(row) for row in rows), key=lambda row: (str(row.get("position_source")), str(row.get("source_entity_id")), time_key(row), str(row.get("sample_id"))))
    retained: list[dict[str, Any]] = []
    prior_time: dict[tuple[str, str], datetime] = {}
    prior_status: dict[tuple[str, str], tuple[Any, Any]] = {}
    for row in ordered:
        if row.get("latitude") is None or row.get("longitude") is None:
            continue
        key = (str(row.get("position_source")), str(row.get("source_entity_id")))
        recorded = str(row.get("recorded_at") or "")
        try:
            current = datetime.fromisoformat(recorded.replace("Z", "+00:00"))
        except ValueError:
            continue
        status = (row.get("raw_status_bits"), row.get("unknown_status_bits"))
        prior = prior_time.get(key)
        elapsed_ms = (current - prior).total_seconds() * 1000 if prior else None
        changed = key not in prior_status or prior_status[key] != status
        if prior is None or elapsed_ms is None or elapsed_ms >= interval_milliseconds or changed:
            sampled = dict(row)
            sampled["sample_id"] = _stable_id("position-sample-500ms", {"source_id": row.get("sample_id"), "interval_ms": interval_milliseconds})
            retained.append(sampled)
            prior_time[key] = current
            prior_status[key] = status
    return retained


def materialize_replay_bundle(
    *, standings: Iterable[Mapping[str, Any]], positions: Iterable[Mapping[str, Any]], session_id: str, output_dir: str | Path,
) -> Path:
    """Write a local uploadable bundle outside Git; caller chooses its location."""
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    files = {"standings": [dict(row) for row in standings], "positions": [dict(row) for row in positions]}
    manifest = {
        "bundle_format_version": REPLAY_BUNDLE_VERSION, "session_id": session_id,
        "event_contract_version": EVENT_CONTRACT_VERSION, "operational_context": OPERATIONAL_CONTEXT,
        "evidence_domain": EVIDENCE_DOMAIN, "position_sampling_milliseconds": 500,
        "entity_counts": {name: len(rows) for name, rows in files.items()},
        "timestamp_semantics": "observed_at and recorded_at are recorder envelope recordedAt; source_timestamp is null.",
    }
    for name, rows in files.items():
        (target / f"{name}.jsonl").write_text("".join(_canonical(row) + "\n" for row in rows), encoding="utf-8")
    (target / "manifest.json").write_text(_canonical(manifest) + "\n", encoding="utf-8")
    return target


def materialize_recording_replay_bundle(
    *, recording_path: str | Path, session_id: str, output_dir: str | Path, identity_mapper: AksIdentityMapper | None = None,
) -> tuple[Path, dict[str, int]]:
    """Convenience boundary for an operator's local, untracked recording ZIP.

    The return value is deliberately only a local upload directory and counts;
    it performs no AIDP, database, network, or repository write.
    """
    from .recording import AksRecordingLoader

    standings, raw_positions = extract_replay_rows(
        AksRecordingLoader(recording_path).iter_messages(), session_id=session_id, identity_mapper=identity_mapper,
    )
    positions = sample_position_rows(raw_positions, interval_milliseconds=500)
    target = materialize_replay_bundle(standings=standings, positions=positions, session_id=session_id, output_dir=output_dir)
    return target, {"standings": len(standings), "positions": len(positions)}
