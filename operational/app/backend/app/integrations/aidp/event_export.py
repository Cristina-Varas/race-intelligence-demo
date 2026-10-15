"""Export accepted Event Capture evidence as contract-validated JSONL bundles.

This module intentionally has no Spark, AIDP, database, or FastAPI dependency.
It is the durable file boundary that an operator can upload to the AIDP Bronze
validated landing volume after running ``verify`` locally.
"""
from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
import sys
import tempfile
from typing import Any, Iterable, Mapping

from ...config import AksSettings
from ...integrations.aks.client import AksTimingClient
from ...integrations.aks.event_capture_bridge import AksEventCaptureBridge
from ...integrations.aks.participant_mapping import identity_mapper as mapping_identity_mapper, load_mapping, validate_mapping
from ...integrations.aks.normalizer import AksIdentityMapper, AksParticipantIdentity, AksStateNormalizer
from ...integrations.aks.recording import AksPlaybackMode, AksRecordingLoader, AksRecordingReplay
from ...persistence.event_capture import UnavailableEventCaptureRepository
from ...services.event_capture import EventCaptureService
from ...services.event_journal import EventJournal


BUNDLE_FORMAT_VERSION = "event-ingestion-bundle.v1"
EVENT_CONTRACT_VERSION = "1.0"
ENTITY_FILES = {
    "sessions": "sessions.jsonl",
    "participants": "participants.jsonl",
    "laps": "laps.jsonl",
    "race_events": "race_events.jsonl",
    "media_markers": "media_markers.jsonl",
    "scenario_snapshots": "scenario_snapshots.jsonl",
}
ENTITY_KINDS = {
    "session": "sessions",
    "participant": "participants",
    "lap": "laps",
    "race_event": "race_events",
    "media_marker": "media_markers",
    "scenario_snapshot": "scenario_snapshots",
}
ALLOWED_CONTEXTS = {"REHEARSAL", "ACTUAL_EVENT"}
ALLOWED_SOURCES = {"AKS", "OPERATOR", "SYSTEM"}
FACTUAL_DOMAIN = "FACTUAL_OBSERVATION"
DERIVED_DOMAIN = "DERIVED_FACTUAL_METRIC"
MODELLED_DOMAIN = "MODELLED"
SAFE_NAME = re.compile(r"[^A-Za-z0-9_.-]+")


class BundleValidationError(ValueError):
    """A prospective or persisted Event Contract bundle is not safe to ingest."""


@dataclass(frozen=True)
class BundleResult:
    path: Path
    manifest: dict[str, Any]
    warnings: tuple[str, ...] = ()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _canonical_json(value: Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True, default=str)


def _sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _file_bytes(rows: list[dict[str, Any]]) -> bytes:
    return ("".join(_canonical_json(row) + "\n" for row in rows)).encode("utf-8")


def _iso(value: Any) -> str | None:
    if value is None or value == "":
        return None
    if isinstance(value, datetime):
        return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z") if value.tzinfo else value.replace(tzinfo=timezone.utc).isoformat().replace("+00:00", "Z")
    return str(value)


def _safe_segment(value: str) -> str:
    return SAFE_NAME.sub("-", value).strip(".-") or "session"


def _canonical_source(value: Any) -> str:
    source = str(value or "OPERATOR").upper()
    return "OPERATOR" if source == "RACE_OPERATIONS_API" else source


def _base_row(entry: Mapping[str, Any], record: Mapping[str, Any], *, operational_context: str, entity: str) -> dict[str, Any]:
    source = _canonical_source(record.get("source"))
    if source not in ALLOWED_SOURCES:
        raise BundleValidationError(f"{entity}: unsupported canonical source {source!r}.")
    evidence_domain = MODELLED_DOMAIN if entity == "scenario_snapshots" else FACTUAL_DOMAIN
    if entity == "race_events" and record.get("event_type") == "TIMING_CATCH":
        evidence_domain = DERIVED_DOMAIN
    capture_time = _iso(entry.get("recordedAt"))
    source_time = _iso(record.get("source_timestamp") or record.get("observed_at") or record.get("recorded_at"))
    return {
        "event_contract_version": EVENT_CONTRACT_VERSION,
        "operational_context": operational_context,
        "evidence_domain": evidence_domain,
        "source": source,
        "source_message_id": record.get("source_message_id"),
        "source_timestamp": source_time,
        # Acceptance time is distinct from Bronze ingestion time.  Notebook 10
        # writes ``ingested_at`` at the managed-table boundary.
        "recorded_at": capture_time,
        "idempotency_key": entry.get("idempotencyKey"),
        "delivery_id": entry.get("id"),
    }


def _project_entry(entry: Mapping[str, Any], *, operational_context: str, session_id_override: str | None = None) -> tuple[str, dict[str, Any]] | None:
    kind = entry.get("entityKind")
    entity = ENTITY_KINDS.get(str(kind))
    record = entry.get("record")
    if not entity or not isinstance(record, Mapping):
        return None
    row = dict(record)
    row.update(_base_row(entry, record, operational_context=operational_context, entity=entity))
    if session_id_override:
        row["session_id"] = session_id_override
    elif entry.get("sessionId"):
        row["session_id"] = entry["sessionId"]
    # These values are assigned only at capture/landing boundaries, never
    # reconstructed from UI state. AIDP replaces ingested_at on actual ingest.
    row["created_at"] = _iso(record.get("created_at") or entry.get("recordedAt"))
    row.pop("ingested_at", None)
    if entity == "participants":
        row["external_participant_number"] = str(record.get("external_participant_number") or record.get("kart_id")) if (record.get("external_participant_number") or record.get("kart_id")) is not None else None
    if entity == "race_events":
        row["observed_at"] = _iso(record.get("observed_at"))
    if entity == "media_markers":
        row["observed_at"] = _iso(record.get("observed_at"))
    return entity, row


def _latest_accepted(journal: EventJournal, session_id: str) -> list[dict[str, Any]]:
    """Return latest durable record per delivery; PENDING is an accepted record."""
    entries = [entry for entry in journal.latest_entries().values() if entry.get("sessionId") == session_id]
    return sorted(entries, key=lambda entry: (str(entry.get("entityKind")), str(entry.get("idempotencyKey") or entry.get("id"))))


def _stable_rows(journal: EventJournal, session_id: str, operational_context: str, *, session_id_override: str | None = None) -> dict[str, list[dict[str, Any]]]:
    if operational_context not in ALLOWED_CONTEXTS:
        raise BundleValidationError("operational_context must be REHEARSAL or ACTUAL_EVENT.")
    rows = {entity: [] for entity in ENTITY_FILES}
    latest_by_entity_id: dict[tuple[str, str], tuple[str, dict[str, Any]]] = {}
    for entry in _latest_accepted(journal, session_id):
        projected = _project_entry(entry, operational_context=operational_context, session_id_override=session_id_override)
        if not projected:
            continue
        entity, row = projected
        stable_id = str(row.get(_id_column(entity)) or row.get("idempotency_key") or row.get("delivery_id"))
        key = (entity, stable_id)
        current = latest_by_entity_id.get(key)
        # A session lifecycle transition is represented by a new accepted
        # journal delivery.  Bronze receives its latest canonical state, while
        # the journal remains the immutable operational recovery evidence.
        if current is None or str(entry.get("recordedAt") or "") >= current[0]:
            latest_by_entity_id[key] = (str(entry.get("recordedAt") or ""), row)
    for (entity, _), (_, row) in latest_by_entity_id.items():
        rows[entity].append(row)
    for entity in rows:
        rows[entity].sort(key=lambda row: str(row.get(_id_column(entity)) or row.get("idempotency_key") or ""))
    return rows


def _id_column(entity: str) -> str:
    return {
        "sessions": "session_id", "participants": "participant_id", "laps": "observation_id",
        "race_events": "event_record_id", "media_markers": "marker_id", "scenario_snapshots": "scenario_snapshot_id",
    }[entity]


def _require(row: Mapping[str, Any], *fields: str) -> None:
    missing = [field for field in fields if row.get(field) in (None, "")]
    if missing:
        raise BundleValidationError(f"Missing required field(s): {', '.join(missing)}.")


def _validate_rows(rows: Mapping[str, list[dict[str, Any]]], *, expected_session_id: str | None = None) -> list[str]:
    warnings: list[str] = []
    session_ids = {row.get("session_id") for entity_rows in rows.values() for row in entity_rows if row.get("session_id")}
    if expected_session_id and session_ids and session_ids != {expected_session_id}:
        raise BundleValidationError("Bundle contains canonical rows for a different session.")
    for entity, entity_rows in rows.items():
        seen: set[str] = set()
        for row in entity_rows:
            _require(row, _id_column(entity), "session_id", "event_contract_version", "operational_context", "evidence_domain", "source", "created_at", "recorded_at", "delivery_id")
            if row["event_contract_version"] != EVENT_CONTRACT_VERSION:
                raise BundleValidationError(f"{entity}: unsupported Event Contract version.")
            if row["operational_context"] not in ALLOWED_CONTEXTS:
                raise BundleValidationError(f"{entity}: invalid operational context.")
            if row["source"] not in ALLOWED_SOURCES:
                raise BundleValidationError(f"{entity}: invalid source.")
            identifier = str(row[_id_column(entity)])
            if identifier in seen:
                raise BundleValidationError(f"{entity}: duplicate canonical identifier {identifier!r}.")
            seen.add(identifier)
            if entity == "sessions":
                _require(row, "event_id", "session_type", "status")
                if row["evidence_domain"] != FACTUAL_DOMAIN:
                    raise BundleValidationError("sessions must be factual observations.")
            elif entity == "participants":
                _require(row, "participant_type")
                if row["evidence_domain"] != FACTUAL_DOMAIN:
                    raise BundleValidationError("participants must be factual observations.")
            elif entity == "laps":
                _require(row, "participant_id", "lap_number")
                if int(row["lap_number"]) <= 0 or row["evidence_domain"] != FACTUAL_DOMAIN:
                    raise BundleValidationError("laps require a positive number and factual provenance.")
            elif entity == "race_events":
                _require(row, "event_type")
                event_type = row["event_type"]
                if event_type == "TIMING_CATCH":
                    if row["evidence_domain"] != DERIVED_DOMAIN or row["source"] not in {"AKS", "SYSTEM"}:
                        raise BundleValidationError("TIMING_CATCH requires a derived factual metric from AKS or SYSTEM.")
                elif event_type in {"PASS", "MAX_PASSES_DRIVER"}:
                    if row["evidence_domain"] != FACTUAL_DOMAIN:
                        raise BundleValidationError("Physical pass evidence must remain factual.")
                else:
                    warnings.append(f"race_event {identifier}: event type {event_type} is preserved without pass/timing-catch interpretation.")
            elif entity == "media_markers":
                _require(row, "marker_type", "title", "priority")
                if row["evidence_domain"] != FACTUAL_DOMAIN:
                    raise BundleValidationError("media markers must be factual observations.")
            elif entity == "scenario_snapshots":
                _require(row, "snapshot_type")
                if row["evidence_domain"] != MODELLED_DOMAIN:
                    raise BundleValidationError("scenario snapshots must remain modelled.")
    return warnings


def _manifest(rows: Mapping[str, list[dict[str, Any]]], *, session_id: str, operational_context: str, source_recording_reference: str | None = None) -> dict[str, Any]:
    file_hashes = {ENTITY_FILES[entity]: _sha256_bytes(_file_bytes(entity_rows)) for entity, entity_rows in rows.items()}
    canonical = {"contract": EVENT_CONTRACT_VERSION, "session": session_id, "context": operational_context, "hashes": file_hashes}
    bundle_id = "event-ingest-" + _sha256_bytes(_canonical_json(canonical).encode())[:20]
    source_counts = Counter(row["source"] for entity_rows in rows.values() for row in entity_rows)
    evidence_counts = Counter(row["evidence_domain"] for entity_rows in rows.values() for row in entity_rows)
    return {
        "bundle_format_version": BUNDLE_FORMAT_VERSION,
        "event_contract_version": EVENT_CONTRACT_VERSION,
        "bundle_id": bundle_id,
        "session_id": session_id,
        "operational_context": operational_context,
        "generated_at": _utc_now(),
        "export_completion_status": "COMPLETE",
        "entity_counts": {entity: len(entity_rows) for entity, entity_rows in rows.items()},
        "source_counts": dict(sorted(source_counts.items())),
        "evidence_domain_counts": dict(sorted(evidence_counts.items())),
        "files": {name: {"sha256": file_hashes[name], "row_count": len(rows[entity])} for entity, name in ENTITY_FILES.items()},
        "source_recording_reference": source_recording_reference,
    }


def export_journal(*, journal_dir: str | Path, session_id: str, output_dir: str | Path, operational_context: str, source_recording_reference: str | None = None, source_session_id: str | None = None) -> BundleResult:
    """Project accepted journal records into a deterministic canonical bundle."""
    rows = _stable_rows(EventJournal(Path(journal_dir)), source_session_id or session_id, operational_context, session_id_override=session_id if source_session_id else None)
    warnings = _validate_rows(rows, expected_session_id=session_id)
    manifest = _manifest(rows, session_id=session_id, operational_context=operational_context, source_recording_reference=source_recording_reference)
    destination = Path(output_dir) / manifest["bundle_id"]
    destination.mkdir(parents=True, exist_ok=True)
    for entity, filename in ENTITY_FILES.items():
        (destination / filename).write_bytes(_file_bytes(rows[entity]))
    (destination / "manifest.json").write_text(_canonical_json(manifest) + "\n", encoding="utf-8")
    verify_bundle(destination)
    return BundleResult(destination, manifest, tuple(warnings))


def _read_bundle(path: str | Path) -> tuple[Path, dict[str, Any], dict[str, list[dict[str, Any]]]]:
    directory = Path(path)
    manifest_path = directory / "manifest.json"
    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BundleValidationError("Bundle manifest is missing or invalid JSON.") from exc
    rows: dict[str, list[dict[str, Any]]] = {}
    for entity, filename in ENTITY_FILES.items():
        file_path = directory / filename
        try:
            content = file_path.read_text(encoding="utf-8")
        except OSError as exc:
            raise BundleValidationError(f"Missing required entity file: {filename}.") from exc
        try:
            rows[entity] = [json.loads(line) for line in content.splitlines() if line.strip()]
        except json.JSONDecodeError as exc:
            raise BundleValidationError(f"{filename} contains invalid JSONL.") from exc
        if not all(isinstance(row, dict) for row in rows[entity]):
            raise BundleValidationError(f"{filename} must contain JSON objects.")
    return directory, manifest, rows


def verify_bundle(path: str | Path) -> BundleResult:
    directory, manifest, rows = _read_bundle(path)
    for field, expected in (("bundle_format_version", BUNDLE_FORMAT_VERSION), ("event_contract_version", EVENT_CONTRACT_VERSION), ("export_completion_status", "COMPLETE")):
        if manifest.get(field) != expected:
            raise BundleValidationError(f"Manifest {field} is invalid.")
    session_id, context = manifest.get("session_id"), manifest.get("operational_context")
    if not isinstance(session_id, str) or not session_id:
        raise BundleValidationError("Manifest session_id is required.")
    if context not in ALLOWED_CONTEXTS:
        raise BundleValidationError("Manifest operational_context is invalid.")
    expected_counts = manifest.get("entity_counts")
    if expected_counts != {entity: len(entity_rows) for entity, entity_rows in rows.items()}:
        raise BundleValidationError("Manifest entity counts do not match JSONL contents.")
    files = manifest.get("files") if isinstance(manifest.get("files"), Mapping) else {}
    for entity, filename in ENTITY_FILES.items():
        metadata = files.get(filename) if isinstance(files, Mapping) else None
        if not isinstance(metadata, Mapping) or metadata.get("sha256") != _sha256_bytes(_file_bytes(rows[entity])):
            raise BundleValidationError(f"Manifest checksum does not match {filename}.")
    warnings = _validate_rows(rows, expected_session_id=session_id)
    return BundleResult(directory, manifest, tuple(warnings))


def inspect_bundle(path: str | Path) -> str:
    result = verify_bundle(path)
    counts = result.manifest["entity_counts"]
    lines = [
        f"Session: {result.manifest['session_id']}", f"Contract: {result.manifest['event_contract_version']}",
        f"Context: {result.manifest['operational_context']}", "",
        f"Sessions: {counts['sessions']}", f"Participants: {counts['participants']}", f"Laps: {counts['laps']}",
        f"Race events: {counts['race_events']}", f"Media markers: {counts['media_markers']}", f"Scenario snapshots: {counts['scenario_snapshots']}",
        "", "Sources:", *[f"{key}: {value}" for key, value in result.manifest.get("source_counts", {}).items()],
        "Evidence:", *[f"{key}: {value}" for key, value in result.manifest.get("evidence_domain_counts", {}).items()],
    ]
    if result.warnings:
        lines.extend(["", "Quality warnings:", *result.warnings])
    return "\n".join(lines)


def _replay_aks_recording(*, recording: Path, journal_dir: Path, identity_mapper: AksIdentityMapper | None = None) -> tuple[str, Any, Any, Any]:
    service = EventCaptureService(EventJournal(journal_dir), UnavailableEventCaptureRepository())
    replay = AksRecordingReplay(
        AksRecordingLoader(recording), AksTimingClient(AksSettings(host="offline")),
        AksStateNormalizer(identity_mapper), AksEventCaptureBridge(service),
    )
    report, normalized, bridge = replay.replay(mode=AksPlaybackMode.AS_FAST_AS_POSSIBLE)
    if not normalized or not normalized.session or not normalized.session.session_id:
        raise BundleValidationError("AKS recording did not provide a materializable session identity.")
    return normalized.session.session_id, report, bridge, normalized


def export_aks_recording(*, recording: str | Path, session_id: str, output_dir: str | Path, operational_context: str, journal_dir: str | Path, identity_mapper: AksIdentityMapper | None = None, participant_mapping_path: str | Path | None = None) -> tuple[BundleResult, Any, Any]:
    """Replay through the existing parser/state/normalizer/bridge, then export."""
    recording_path = Path(recording)
    mappings = load_mapping(participant_mapping_path) if participant_mapping_path else []
    mapper = identity_mapper or (mapping_identity_mapper(mappings) if mappings else None)
    source_session_id, report, bridge, normalized = _replay_aks_recording(recording=recording_path, journal_dir=Path(journal_dir), identity_mapper=mapper)
    mapping_result = validate_mapping(mappings, discovered_numbers=[item.external_participant_number for item in normalized.participants])
    if mapping_result.errors:
        raise BundleValidationError("Participant mapping validation failed: " + " ".join(mapping_result.errors))
    result = export_journal(
        journal_dir=journal_dir, session_id=session_id, source_session_id=source_session_id,
        output_dir=output_dir, operational_context=operational_context,
        source_recording_reference=recording_path.name,
    )
    return BundleResult(result.path, result.manifest, result.warnings + mapping_result.warnings), report, bridge


def _cli_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Event Capture → AIDP Event Contract bundle bridge")
    sub = parser.add_subparsers(dest="command", required=True)
    export = sub.add_parser("export", help="Export accepted Event Capture journal records")
    export.add_argument("--session", required=True)
    export.add_argument("--journal-dir", required=True)
    export.add_argument("--output-dir", required=True)
    export.add_argument("--operational-context", choices=sorted(ALLOWED_CONTEXTS), required=True)
    aks = sub.add_parser("from-aks-recording", help="Replay an AKS raw recording then export its trusted candidates")
    aks.add_argument("--recording", required=True)
    aks.add_argument("--session-id", required=True)
    aks.add_argument("--journal-dir", default=str(Path(tempfile.gettempdir()) / "race-intelligence-aks-bundle-journal"), help="Local temporary/recovery journal directory; never a repository path")
    aks.add_argument("--output-dir", required=True)
    aks.add_argument("--operational-context", choices=sorted(ALLOWED_CONTEXTS), required=True)
    aks.add_argument("--participant-mapping", help="Optional approved participant mapping CSV")
    verify = sub.add_parser("verify", help="Validate a completed bundle")
    verify.add_argument("bundle_dir")
    inspect = sub.add_parser("inspect", help="Print concise completed-bundle metadata")
    inspect.add_argument("bundle_dir")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = _cli_parser().parse_args(argv)
    try:
        if args.command == "export":
            result = export_journal(journal_dir=args.journal_dir, session_id=args.session, output_dir=args.output_dir, operational_context=args.operational_context)
            print(result.path)
        elif args.command == "from-aks-recording":
            result, report, bridge = export_aks_recording(recording=args.recording, session_id=args.session_id, output_dir=args.output_dir, operational_context=args.operational_context, journal_dir=args.journal_dir, participant_mapping_path=args.participant_mapping)
            print(result.path)
            print(f"AKS normalized: sessions={report.normalized_sessions} participants={report.normalized_participants} laps={report.normalized_laps}")
            print(f"AKS bridge: operations={report.journal_operations} blocked_identity_mappings={report.blocked_identity_mappings} deferred={bridge.deferred if bridge else 0}")
            for warning in result.warnings:
                print(f"WARNING: {warning}")
        elif args.command == "verify":
            verify_bundle(args.bundle_dir)
            print("Bundle verification: PASS")
        else:
            print(inspect_bundle(args.bundle_dir))
    except BundleValidationError as exc:
        print(f"Bundle verification: FAIL — {exc}", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
