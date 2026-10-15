"""Bridge normalized AKS candidates through the existing EventCaptureService only."""
from __future__ import annotations

from copy import deepcopy
from dataclasses import dataclass, field
from datetime import datetime, timezone
import json
from typing import Any

from ...services.event_capture import EventCaptureConflict, EventCaptureNotFound, EventCaptureService
from .normalizer import (
    AksNormalizationResult, AksNormalizedLap, AksNormalizedLiveEvent,
    AksNormalizedParticipant, AksNormalizedPosition, AksNormalizedSession,
)


@dataclass
class AksBridgeResult:
    acknowledgements: list[dict[str, Any]] = field(default_factory=list)
    deferred: int = 0
    skipped: list[str] = field(default_factory=list)


class AksLivePositionCache:
    """Current GPS/RGPS state only; full-rate position streams are not journaled."""

    def __init__(self):
        self._positions: dict[str, dict[str, AksNormalizedPosition]] = {"GPS": {}, "RGPS": {}}
        self._last_update: datetime | None = None

    def update(self, positions: list[AksNormalizedPosition]) -> None:
        for position in positions:
            self._positions[position.source][position.participant_id] = position
            self._last_update = datetime.now(timezone.utc)

    def current_gps_positions(self) -> dict[str, AksNormalizedPosition]:
        return deepcopy(self._positions["GPS"])

    def current_rgps_positions(self) -> dict[str, AksNormalizedPosition]:
        return deepcopy(self._positions["RGPS"])

    @property
    def last_update_timestamp(self) -> datetime | None:
        return self._last_update


class AksEventCaptureBridge:
    """Idempotent promotion of safe AKS candidates into the Event Capture journal."""

    def __init__(self, event_capture: EventCaptureService, *, max_pending: int = 1000):
        self.event_capture = event_capture
        self.live_positions = AksLivePositionCache()
        self.max_pending = max_pending
        self._pending_participants: dict[tuple[str | None, str], AksNormalizedParticipant] = {}
        self._pending_laps: dict[tuple[str | None, str, int], AksNormalizedLap] = {}
        self._pending_live_events: dict[tuple[str | None, str, int, str], AksNormalizedLiveEvent] = {}

    def apply(self, normalized: AksNormalizationResult) -> AksBridgeResult:
        result = AksBridgeResult()
        self.live_positions.update(normalized.positions)
        if normalized.session:
            self._apply_session(normalized.session, result)
        for participant in normalized.participants:
            self._safe(lambda: self._queue_or_apply_participant(participant, result), result)
        for lap in normalized.laps:
            self._safe(lambda: self._queue_or_apply_lap(lap, result), result)
        for event in normalized.live_events:
            self._safe(lambda: self._queue_or_apply_live_event(event, result), result)
        self._flush_pending(result)
        if normalized.session and normalized.session.status == "COMPLETED":
            self._safe(lambda: self._complete_session(normalized.session.session_id, result), result)
        result.deferred = len(self._pending_participants) + len(self._pending_laps) + len(self._pending_live_events)
        return result

    def _apply_session(self, session: AksNormalizedSession, result: AksBridgeResult) -> None:
        if not session.session_id:
            result.skipped.append("AKS session has no stable session identity; promotion deferred.")
            return
        if session.session_type is None:
            result.skipped.append(f"AKS session {session.session_id} has unsupported type; promotion blocked.")
            return
        current = self.event_capture.captured_session(session.session_id)
        if current is None:
            now = datetime.now(timezone.utc).isoformat()
            result.acknowledgements.append(self.event_capture.capture(
                operation="CREATE_SESSION", session_id=session.session_id, entity_kind="session",
                idempotency_key=f"aks:session:{session.session_id}:create",
                record={
                    "session_id": session.session_id, "event_id": session.event_id or session.session_id,
                    "session_type": session.session_type, "session_name": session.session_name,
                    "started_at": None, "ended_at": None, "status": "CREATED", "operator": None,
                    "notes": None, "source": "AKS", "created_at": now, "ingested_at": now,
                    **self._traceability(session.provenance),
                },
            ))
            current = self.event_capture.captured_session(session.session_id)
        target = session.status
        current_status = current["record"]["status"] if current else None
        if current_status == "CREATED" and target in {"RECORDING", "COMPLETED"}:
            result.acknowledgements.append(self.event_capture.transition(session.session_id, "RECORDING"))
            current_status = "RECORDING"
        # Completion is deliberately deferred until the same snapshot's known
        # children have passed the Event Capture parent checks.

    def _complete_session(self, session_id: str | None, result: AksBridgeResult) -> None:
        if not session_id:
            return
        current = self.event_capture.captured_session(session_id)
        if current and current["record"].get("status") == "RECORDING":
            result.acknowledgements.append(self.event_capture.transition(session_id, "COMPLETED"))

    def _queue_or_apply_participant(self, candidate: AksNormalizedParticipant, result: AksBridgeResult) -> None:
        if not self._session_exists(candidate.session_id):
            self._buffer(self._pending_participants, (candidate.session_id, candidate.participant_id), candidate, result)
            return
        self._apply_participant(candidate, result)

    def _apply_participant(self, candidate: AksNormalizedParticipant, result: AksBridgeResult) -> None:
        if candidate.participant_type not in {"MAX", "CHALLENGER", "ORACLE_DRIVER", "UNCLASSIFIED"}:
            result.skipped.append(f"AKS participant {candidate.participant_id} has unresolved participant type; promotion blocked.")
            return
        acknowledgement = self._idempotent_or_writable(
            operation="CREATE_PARTICIPANT", session_id=candidate.session_id, key=f"aks:participant:{candidate.session_id}:{candidate.participant_id}"
        )
        if acknowledgement:
            result.acknowledgements.append(acknowledgement)
            return
        now = datetime.now(timezone.utc).isoformat()
        result.acknowledgements.append(self.event_capture.capture(
            operation="CREATE_PARTICIPANT", session_id=candidate.session_id, entity_kind="participant",
            idempotency_key=f"aks:participant:{candidate.session_id}:{candidate.participant_id}",
            record={"session_id": candidate.session_id, "participant_id": candidate.participant_id,
                    "display_name": candidate.display_name, "kart_id": candidate.metadata.get("kart_id") or candidate.external_participant_number,
                    "participant_type": candidate.participant_type, "special_role": candidate.special_role,
                    "source": "AKS", "created_at": now, "ingested_at": now,
                    "external_participant_number": candidate.external_participant_number,
                    **self._traceability(candidate.provenance)},
        ))

    def _queue_or_apply_lap(self, candidate: AksNormalizedLap, result: AksBridgeResult) -> None:
        if not self._participant_exists(candidate.session_id, candidate.participant_id):
            self._buffer(self._pending_laps, candidate.dedupe_key, candidate, result)
            return
        self._apply_lap(candidate, result)

    def _apply_lap(self, candidate: AksNormalizedLap, result: AksBridgeResult) -> None:
        if candidate.is_valid is False:
            result.skipped.append(f"AKS invalid lap {candidate.dedupe_key} was not promoted.")
            return
        key = f"aks:lap:{candidate.session_id}:{candidate.participant_id}:{candidate.lap_number}"
        acknowledgement = self._idempotent_or_writable("CAPTURE_LAP", candidate.session_id, key)
        if acknowledgement:
            result.acknowledgements.append(acknowledgement)
            return
        now = datetime.now(timezone.utc).isoformat()
        result.acknowledgements.append(self.event_capture.capture(
            operation="CAPTURE_LAP", session_id=candidate.session_id, entity_kind="lap", idempotency_key=key,
            record={"observation_id": self._stable_id("lap", key), "session_id": candidate.session_id,
                    "participant_id": candidate.participant_id, "lap_number": candidate.lap_number,
                    "lap_time_seconds": candidate.lap_time_seconds, "sector_1_seconds": candidate.sector_1_seconds,
                    "sector_2_seconds": candidate.sector_2_seconds, "sector_3_seconds": candidate.sector_3_seconds,
                    "position": candidate.position, "gap_to_max_seconds": None, "gap_to_leader_seconds": None,
                    "source": "AKS", "observed_at": candidate.observed_at, "operator_note": None,
                    "created_at": now, "ingested_at": now,
                    **self._traceability(candidate.provenance)},
        ))

    def _queue_or_apply_live_event(self, candidate: AksNormalizedLiveEvent, result: AksBridgeResult) -> None:
        if not self._participant_exists(candidate.session_id, candidate.participant_id):
            self._buffer(self._pending_live_events, candidate.dedupe_key, candidate, result)
            return
        self._apply_live_event(candidate, result)

    def _apply_live_event(self, candidate: AksNormalizedLiveEvent, result: AksBridgeResult) -> None:
        key = f"aks:event:{candidate.session_id}:{candidate.participant_id}:{candidate.lap_number}:{candidate.event_type}"
        acknowledgement = self._idempotent_or_writable("CAPTURE_RACE_EVENT", candidate.session_id, key)
        if acknowledgement:
            result.acknowledgements.append(acknowledgement)
            return
        now = datetime.now(timezone.utc).isoformat()
        result.acknowledgements.append(self.event_capture.capture(
            operation="CAPTURE_RACE_EVENT", session_id=candidate.session_id, entity_kind="race_event", idempotency_key=key,
            record={"event_record_id": self._stable_id("event", key), "session_id": candidate.session_id,
                    "race_time_seconds": candidate.race_time_seconds, "lap_number": candidate.lap_number,
                    "participant_id": candidate.participant_id, "target_participant_id": None,
                    "event_type": "LAP_COMPLETE", "value": json.dumps({"source_channel": candidate.provenance.source_channel, "source_message_id": candidate.provenance.source_message_id}),
                    "notes": None, "source": "AKS", "recorded_at": None, "created_at": now, "ingested_at": now,
                    **self._traceability(candidate.provenance)},
        ))

    def _flush_pending(self, result: AksBridgeResult) -> None:
        for key, candidate in list(self._pending_participants.items()):
            if self._session_exists(candidate.session_id):
                del self._pending_participants[key]
                self._safe(lambda: self._apply_participant(candidate, result), result)
        for key, candidate in list(self._pending_laps.items()):
            if self._participant_exists(candidate.session_id, candidate.participant_id):
                del self._pending_laps[key]
                self._safe(lambda: self._apply_lap(candidate, result), result)
        for key, candidate in list(self._pending_live_events.items()):
            if self._participant_exists(candidate.session_id, candidate.participant_id):
                del self._pending_live_events[key]
                self._safe(lambda: self._apply_live_event(candidate, result), result)

    def _session_exists(self, session_id: str | None) -> bool:
        return bool(session_id and self.event_capture.captured_session(session_id))

    def _participant_exists(self, session_id: str | None, participant_id: str) -> bool:
        return bool(session_id and self.event_capture.journal.has_participant(session_id, participant_id))

    def _idempotent_or_writable(self, operation: str, session_id: str | None, key: str) -> dict[str, Any] | None:
        if not session_id:
            raise EventCaptureNotFound("AKS candidate has no session identity.")
        acknowledgement = self.event_capture.idempotent_acknowledgement(idempotency_key=key, operation=operation, session_id=session_id)
        if acknowledgement:
            return acknowledgement
        self.event_capture.ensure_session_writable(session_id)
        return None

    def _buffer(self, buffer: dict, key: tuple, candidate: Any, result: AksBridgeResult) -> None:
        if len(buffer) >= self.max_pending and key not in buffer:
            result.skipped.append("AKS dependency buffer is full; candidate was not promoted.")
            return
        buffer[key] = candidate

    @staticmethod
    def _safe(action, result: AksBridgeResult) -> None:
        try:
            action()
        except (EventCaptureConflict, EventCaptureNotFound) as exc:
            result.skipped.append(str(exc))

    def _stable_id(self, prefix: str, key: str) -> str:
        return self.event_capture.new_id(prefix, key)

    @staticmethod
    def _traceability(provenance) -> dict[str, str | None]:
        """Keep a compact source-evidence link without embedding wire payloads."""
        return {
            "source_message_id": provenance.source_message_id,
            "source_timestamp": provenance.normalized_at.isoformat(),
        }
