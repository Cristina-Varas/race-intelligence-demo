"""Streaming replay support for recorded Al Kamel AKS session archives.

The currently supported recording format is ``maxv100.alkamel.raw.v1``: a ZIP
with a manifest and ordered ``raw/*.jsonl`` chunks.  Each JSONL envelope keeps
the original CRLF-delimited AKS wire line in ``line``.  No second wire parser is
introduced here; records are fed to :class:`AksTimingClient` unchanged.
"""
from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, dataclass, field
from datetime import datetime
from enum import Enum
import json
from pathlib import Path
import re
import time
from typing import Any, Callable, Iterator
from zipfile import ZIP_DEFLATED, ZipFile, ZipInfo

from .client import AksTimingClient
from .event_capture_bridge import AksBridgeResult, AksEventCaptureBridge
from .normalizer import AksNormalizationResult, AksStateNormalizer
from .protocol import CRLF, AksPacket, parse_packet


RAW_SCHEMA = "maxv100.alkamel.raw.v1"
RAW_FILE_PATTERN = re.compile(r"(?:^|/)raw/[^/]+-(\d+)\.jsonl$")
TRACKED_CHANNELS = (
    "gps", "rgps", "timing.session.info", "timing.session.entry",
    "timing.session.status", "timing.session.standings.overall.active",
    "timing.session.standings.overall.finishLine",
    "timing.session.standings.overall.participantDetails", "timing.analysis.laps",
    "timing.liveEvents.fl", "raceControl", "weather",
)


def _parse_timestamp(value: Any) -> datetime | None:
    if not isinstance(value, str):
        return None
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None


def _seconds_between(first: datetime | None, last: datetime | None) -> float | None:
    return (last - first).total_seconds() if first and last else None


def _leaf_paths(value: Any, prefix: str = "") -> Iterator[str]:
    """Yield useful AKS channel paths without treating participant maps as paths."""
    if not isinstance(value, dict):
        if prefix:
            yield prefix
        return
    if not value and prefix:
        yield prefix
        return
    for key, child in value.items():
        if not isinstance(key, str):
            continue
        next_path = f"{prefix}.{key}" if prefix else key
        if isinstance(child, dict):
            yield from _leaf_paths(child, next_path)
        else:
            yield next_path


def _known_channels(payload: Any) -> set[str]:
    if not isinstance(payload, dict):
        return set()
    leaves = set(_leaf_paths(payload))
    return {channel for channel in TRACKED_CHANNELS if channel in leaves or any(path.startswith(f"{channel}.") for path in leaves)}


@dataclass(frozen=True)
class AksRecordedMessage:
    raw_payload: str
    recorded_at: datetime | None
    source_file: str
    sequence_number: int
    command: str
    message_id: str
    channel: str
    envelope: dict[str, Any]

    @property
    def wire_line(self) -> str:
        return self.raw_payload if self.raw_payload.endswith(CRLF) else f"{self.raw_payload}{CRLF}"


@dataclass(frozen=True)
class ArchiveFile:
    name: str
    size: int
    compressed_size: int
    compression: str
    modified_at: datetime


@dataclass
class RecordingReport:
    archive_name: str
    archive_files: list[ArchiveFile]
    recording_format: str
    recording_duration: float | None = None
    messages_processed: int = 0
    malformed_messages: int = 0
    channels_observed: dict[str, dict[str, Any]] = field(default_factory=dict)
    session_count: int = 0
    participant_count: int = 0
    gps_updates: int = 0
    rgps_updates: int = 0
    authoritative_laps: int = 0
    finish_line_events: int = 0
    normalized_sessions: int = 0
    normalized_participants: int = 0
    normalized_laps: int = 0
    blocked_identity_mappings: int = 0
    journal_operations: int = 0
    journal_pending: int = 0
    journal_synced: int = 0
    duplicates_suppressed: int = 0
    first_message_at: datetime | None = None
    last_message_at: datetime | None = None
    metadata: dict[str, Any] = field(default_factory=dict)

    def as_dict(self) -> dict[str, Any]:
        result = asdict(self)
        for key in ("first_message_at", "last_message_at"):
            if result[key]:
                result[key] = result[key].isoformat()
        return result


class AksRecordingFormatError(ValueError):
    pass


class AksPlaybackMode(str, Enum):
    AS_FAST_AS_POSSIBLE = "AS_FAST_AS_POSSIBLE"
    REAL_TIME = "REAL_TIME"
    ACCELERATED = "ACCELERATED"


class AksRecordingLoader:
    """Read Al Kamel raw-v1 ZIPs in manifest/chunk order without extraction."""

    def __init__(self, archive_path: str | Path):
        self.path = Path(archive_path)

    def _open(self) -> ZipFile:
        if self.path.is_dir():
            raise AksRecordingFormatError("This operation is only available for packaged AKS recordings.")
        if not self.path.is_file():
            raise FileNotFoundError(f"AKS recording archive does not exist: {self.path}")
        return ZipFile(self.path)

    @staticmethod
    def _archive_file(info: ZipInfo) -> ArchiveFile:
        compression = "deflate" if info.compress_type == ZIP_DEFLATED else "stored" if info.compress_type == 0 else str(info.compress_type)
        return ArchiveFile(info.filename, info.file_size, info.compress_size, compression, datetime(*info.date_time))

    def archive_files(self) -> list[ArchiveFile]:
        if self.path.is_dir():
            return [
                ArchiveFile(file.relative_to(self.path).as_posix(), file.stat().st_size, file.stat().st_size, "stored", datetime.fromtimestamp(file.stat().st_mtime))
                for file in sorted(self.path.rglob("*")) if file.is_file()
            ]
        with self._open() as archive:
            return [self._archive_file(info) for info in archive.infolist() if not info.is_dir() and not info.filename.startswith("__MACOSX/") and "/__MACOSX/" not in info.filename and not info.filename.endswith(".DS_Store")]

    def manifest(self) -> dict[str, Any]:
        if self.path.is_dir():
            manifest_path = self.path / "manifest.json"
            try:
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                raise AksRecordingFormatError("AKS recording manifest is unreadable JSON.") from exc
            if manifest.get("schema") != "maxv100.alkamel.session-manifest.v1":
                raise AksRecordingFormatError(f"Unsupported AKS recording manifest schema: {manifest.get('schema')!r}")
            return manifest
        with self._open() as archive:
            candidates = [name for name in archive.namelist() if name.endswith("/manifest.json")]
            if len(candidates) != 1:
                raise AksRecordingFormatError("AKS recording requires exactly one manifest.json.")
            try:
                manifest = json.load(archive.open(candidates[0]))
            except (OSError, json.JSONDecodeError) as exc:
                raise AksRecordingFormatError("AKS recording manifest is unreadable JSON.") from exc
        if manifest.get("schema") != "maxv100.alkamel.session-manifest.v1":
            raise AksRecordingFormatError(f"Unsupported AKS recording manifest schema: {manifest.get('schema')!r}")
        return manifest

    def _chunk_names(self, archive: ZipFile, manifest: dict[str, Any]) -> list[str]:
        chunks = manifest.get("chunks")
        if not isinstance(chunks, list) or not chunks:
            raise AksRecordingFormatError("AKS recording manifest has no raw JSONL chunks.")
        root = next(name.rsplit("/manifest.json", 1)[0] for name in archive.namelist() if name.endswith("/manifest.json"))
        names: list[str] = []
        for chunk in chunks:
            relative = chunk.get("file") if isinstance(chunk, dict) else None
            name = f"{root}/{relative}" if isinstance(relative, str) else ""
            if not name or name not in archive.namelist() or not RAW_FILE_PATTERN.search(name):
                raise AksRecordingFormatError(f"Manifest references an unsupported/missing raw chunk: {relative!r}")
            names.append(name)
        return names

    def iter_messages(self) -> Iterator[AksRecordedMessage]:
        """Yield every raw-v1 envelope in manifest order then JSONL line order."""
        if self.path.is_dir():
            manifest = self.manifest()
            chunks = manifest.get("chunks")
            if not isinstance(chunks, list) or not chunks:
                raise AksRecordingFormatError("AKS recording manifest has no raw JSONL chunks.")
            sequence = 0
            for chunk in chunks:
                relative = chunk.get("file") if isinstance(chunk, dict) else None
                source = self.path / relative if isinstance(relative, str) else None
                if source is None or not source.is_file() or not RAW_FILE_PATTERN.search(relative):
                    raise AksRecordingFormatError(f"Manifest references an unsupported/missing raw chunk: {relative!r}")
                with source.open("rb") as binary:
                    for line_number, raw_line in enumerate(binary, start=1):
                        if not raw_line.strip():
                            continue
                        yield self._record_from_jsonl(raw_line, relative, line_number, sequence + 1)
                        sequence += 1
            return
        with self._open() as archive:
            manifest = self.manifest()
            sequence = 0
            for source_file in self._chunk_names(archive, manifest):
                with archive.open(source_file) as binary:
                    for line_number, raw_line in enumerate(binary, start=1):
                        if not raw_line.strip():
                            continue
                        sequence += 1
                        yield self._record_from_jsonl(raw_line, source_file, line_number, sequence)

    @staticmethod
    def _record_from_jsonl(raw_line: bytes, source_file: str, line_number: int, sequence: int) -> AksRecordedMessage:
        try:
            envelope = json.loads(raw_line)
        except json.JSONDecodeError as exc:
            raise AksRecordingFormatError(f"Malformed JSONL envelope in {source_file}:{line_number}") from exc
        if not isinstance(envelope, dict) or envelope.get("schema") != RAW_SCHEMA:
            raise AksRecordingFormatError(f"Unsupported recording envelope in {source_file}:{line_number}")
        raw_payload = envelope.get("line")
        if not isinstance(raw_payload, str):
            raise AksRecordingFormatError(f"Recording envelope has no AKS wire line in {source_file}:{line_number}")
        try:
            packet = parse_packet(raw_payload if raw_payload.endswith(CRLF) else f"{raw_payload}{CRLF}")
            command, message_id, channel = packet.command, packet.message_id, packet.channel
        except Exception:
            # Capture-first recordings intentionally retain unparseable evidence.
            command, message_id, channel = "UNKNOWN", "", ""
        return AksRecordedMessage(raw_payload, _parse_timestamp(envelope.get("recordedAt")), source_file, sequence, command, message_id, channel, envelope)

    def inspect(self) -> RecordingReport:
        manifest = self.manifest()
        report = RecordingReport(self.path.name, self.archive_files(), RAW_SCHEMA)
        report.metadata["manifest"] = {key: manifest.get(key) for key in ("eventId", "sessionId", "eventName", "sessionName", "sessionType", "openedAt", "closedAt")}
        for message in self.iter_messages():
            report.messages_processed += 1
            report.first_message_at = report.first_message_at or message.recorded_at
            report.last_message_at = message.recorded_at or report.last_message_at
            if message.command != "JSON":
                continue
            try:
                payload = json.loads(parse_packet(message.wire_line).data)
            except Exception:
                report.malformed_messages += 1
                continue
            for channel in _known_channels(payload):
                details = report.channels_observed.setdefault(channel, {"updates": 0, "first_at": None, "last_at": None})
                details["updates"] += 1
                details["first_at"] = details["first_at"] or (message.recorded_at.isoformat() if message.recorded_at else None)
                details["last_at"] = message.recorded_at.isoformat() if message.recorded_at else details["last_at"]
        report.recording_duration = _seconds_between(report.first_message_at, report.last_message_at)
        return report


class AksRecordingReplay:
    """Schedule archive records independently from the shared AKS parser/state path."""

    def __init__(self, loader: AksRecordingLoader, client: AksTimingClient, normalizer: AksStateNormalizer, bridge: AksEventCaptureBridge | None = None):
        self.loader, self.client, self.normalizer, self.bridge = loader, client, normalizer, bridge

    @staticmethod
    def _delay(previous: datetime | None, current: datetime | None, mode: AksPlaybackMode, speed: float) -> float:
        if mode == AksPlaybackMode.AS_FAST_AS_POSSIBLE or previous is None or current is None:
            return 0.0
        if speed <= 0:
            raise ValueError("Accelerated playback speed must be positive.")
        return max(0.0, (current - previous).total_seconds()) / (speed if mode == AksPlaybackMode.ACCELERATED else 1.0)

    def replay(self, *, mode: AksPlaybackMode = AksPlaybackMode.AS_FAST_AS_POSSIBLE, speed: float = 10.0, sleep: Callable[[float], None] | None = None, include_inventory: bool = True) -> tuple[RecordingReport, AksNormalizationResult | None, AksBridgeResult | None]:
        manifest = self.loader.manifest()
        report = RecordingReport(self.loader.path.name, self.loader.archive_files(), RAW_SCHEMA)
        report.metadata["manifest"] = {key: manifest.get(key) for key in ("eventId", "sessionId", "eventName", "sessionName", "sessionType", "openedAt", "closedAt")}
        previous: datetime | None = None
        sleeper = sleep or time.sleep
        for message in self.loader.iter_messages():
            delay = self._delay(previous, message.recorded_at, mode, speed)
            if delay:
                sleeper(delay)
            previous = message.recorded_at or previous
            if self.client.handle_line(message.wire_line) is None:
                report.malformed_messages += 1
            elif include_inventory and message.command == "JSON":
                try:
                    payload = json.loads(parse_packet(message.wire_line).data)
                    for channel in _known_channels(payload):
                        details = report.channels_observed.setdefault(channel, {"updates": 0, "first_at": None, "last_at": None})
                        details["updates"] += 1
                        details["first_at"] = details["first_at"] or (message.recorded_at.isoformat() if message.recorded_at else None)
                        details["last_at"] = message.recorded_at.isoformat() if message.recorded_at else details["last_at"]
                except Exception:
                    # The client has already counted malformed protocol JSON;
                    # this defensive branch only protects optional diagnostics.
                    pass
            report.messages_processed += 1
            report.first_message_at = report.first_message_at or message.recorded_at
            report.last_message_at = message.recorded_at or report.last_message_at
        normalized = self.normalizer.normalize(self.client.state_store)
        bridge_result = self.bridge.apply(normalized) if self.bridge else None
        report.recording_duration = _seconds_between(report.first_message_at, report.last_message_at)
        report.session_count = int(normalized.session is not None)
        report.participant_count = len(normalized.participants)
        # ``inspect`` already performed the one streaming inventory pass; do
        # not reopen a potentially large archive merely to copy these counts.
        report.gps_updates = int(report.channels_observed.get("gps", {}).get("updates", 0))
        report.rgps_updates = int(report.channels_observed.get("rgps", {}).get("updates", 0))
        report.authoritative_laps = len(normalized.laps)
        report.finish_line_events = len(normalized.live_events)
        report.normalized_sessions = report.session_count
        report.normalized_participants = report.participant_count
        report.normalized_laps = len(normalized.laps)
        if bridge_result:
            report.blocked_identity_mappings = sum("unresolved participant type" in item for item in bridge_result.skipped)
            report.journal_operations = len(bridge_result.acknowledgements)
            report.journal_pending = sum(ack.get("syncStatus") == "PENDING" for ack in bridge_result.acknowledgements)
            report.journal_synced = sum(ack.get("syncStatus") == "SYNCED" for ack in bridge_result.acknowledgements)
            report.duplicates_suppressed = sum(ack.get("idempotent") is True for ack in bridge_result.acknowledgements)
        return report, normalized, bridge_result
