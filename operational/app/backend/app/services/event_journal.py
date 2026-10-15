"""Append-only local recovery journal for Actual Event capture requests."""
from __future__ import annotations

from datetime import datetime, timezone
import json
import os
from pathlib import Path
from threading import Lock
from typing import Any


class EventJournalError(RuntimeError):
    """The capture cannot be accepted safely because its recovery record failed."""


class EventJournal:
    """Durable JSONL journal with status updates represented as new append-only rows."""

    def __init__(self, directory: Path):
        self.directory = Path(directory)
        self.path = self.directory / "event_capture.jsonl"
        self._lock = Lock()

    def append(self, entry: dict[str, Any]) -> None:
        try:
            self.directory.mkdir(mode=0o700, parents=True, exist_ok=True)
            line = json.dumps(entry, separators=(",", ":"), sort_keys=True, default=str)
            with self._lock, self.path.open("a", encoding="utf-8") as handle:
                handle.write(line + "\n")
                handle.flush()
                os.fsync(handle.fileno())
        except (OSError, TypeError, ValueError) as exc:
            raise EventJournalError("Unable to record the capture in the local recovery journal.") from exc

    def latest_entries(self) -> dict[str, dict[str, Any]]:
        if not self.path.exists():
            return {}
        latest: dict[str, dict[str, Any]] = {}
        try:
            with self.path.open(encoding="utf-8") as handle:
                for line in handle:
                    if line.strip():
                        entry = json.loads(line)
                        latest[entry["id"]] = entry
        except (OSError, KeyError, json.JSONDecodeError) as exc:
            raise EventJournalError("Unable to read the local recovery journal.") from exc
        return latest

    def find_idempotency_key(self, key: str) -> dict[str, Any] | None:
        for entry in reversed(list(self.latest_entries().values())):
            if entry.get("idempotencyKey") == key:
                return entry
        return None

    def find_session(self, session_id: str) -> dict[str, Any] | None:
        candidates = [
            entry for entry in self.latest_entries().values()
            if entry.get("sessionId") == session_id and entry.get("entityKind") == "session"
        ]
        return max(candidates, key=lambda entry: entry["recordedAt"], default=None)

    def recovery_sessions(self) -> list[dict[str, Any]]:
        """Latest accepted session record per ID, suitable for a safe recovery projection."""
        by_session: dict[str, dict[str, Any]] = {}
        for entry in self.latest_entries().values():
            if entry.get("entityKind") != "session" or not entry.get("sessionId"):
                continue
            session_id = entry["sessionId"]
            current = by_session.get(session_id)
            if current is None or entry.get("recordedAt", "") > current.get("recordedAt", ""):
                by_session[session_id] = entry
        return sorted(by_session.values(), key=lambda entry: entry.get("recordedAt", ""), reverse=True)

    def recovery_participants(self, session_id: str) -> list[dict[str, Any]]:
        """Latest known participant registration by explicit internal participant ID."""
        participants: dict[str, dict[str, Any]] = {}
        for entry in self.latest_entries().values():
            record = entry.get("record", {})
            participant_id = record.get("participant_id")
            if entry.get("sessionId") != session_id or entry.get("entityKind") != "participant" or not participant_id:
                continue
            current = participants.get(participant_id)
            if current is None or entry.get("recordedAt", "") > current.get("recordedAt", ""):
                participants[participant_id] = entry
        return sorted(participants.values(), key=lambda entry: entry["record"].get("participant_id", ""))

    def recovery_activities(self, session_id: str, *, limit: int = 20) -> list[dict[str, Any]]:
        """Sanitized capture metadata for operator continuity; raw journal envelopes stay private."""
        entries = [
            entry for entry in self.latest_entries().values()
            if entry.get("sessionId") == session_id and entry.get("entityKind") in {"participant", "lap", "race_event", "media_marker"}
        ]
        return sorted(entries, key=lambda entry: entry.get("recordedAt", ""), reverse=True)[:limit]

    def has_participant(self, session_id: str, participant_id: str) -> bool:
        return any(
            entry.get("sessionId") == session_id
            and entry.get("entityKind") == "participant"
            and entry.get("record", {}).get("participant_id") == participant_id
            for entry in self.latest_entries().values()
        )

    def participant_entry(self, session_id: str, participant_id: str) -> dict[str, Any] | None:
        return next((
            entry for entry in self.latest_entries().values()
            if entry.get("sessionId") == session_id
            and entry.get("entityKind") == "participant"
            and entry.get("record", {}).get("participant_id") == participant_id
        ), None)

    def pending_entries(self) -> list[dict[str, Any]]:
        return [entry for entry in self.latest_entries().values() if entry.get("syncStatus") == "PENDING"]


def now_utc() -> datetime:
    return datetime.now(timezone.utc)
