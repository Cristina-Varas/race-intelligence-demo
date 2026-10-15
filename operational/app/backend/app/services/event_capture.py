"""Validation-independent capture orchestration for Actual Event operations."""
from __future__ import annotations

from typing import Any
from uuid import NAMESPACE_URL, uuid4, uuid5

from ..persistence.event_capture import EventCaptureRepository, EventPersistenceUnavailable
from .event_journal import EventJournal, now_utc


class EventCaptureConflict(ValueError):
    pass


class EventCaptureNotFound(ValueError):
    pass


class EventCaptureService:
    def __init__(self, journal: EventJournal, repository: EventCaptureRepository):
        self.journal = journal
        self.repository = repository

    @staticmethod
    def new_id(prefix: str, idempotency_key: str | None = None) -> str:
        """Generate an opaque safe ID; an idempotency key makes it stable on retry."""
        value = uuid5(NAMESPACE_URL, f"race-intelligence-event:{prefix}:{idempotency_key}").hex if idempotency_key else uuid4().hex
        return f"{prefix}_{value}"

    def captured_session(self, session_id: str) -> dict[str, Any] | None:
        return self.journal.find_session(session_id)

    def idempotent_acknowledgement(
        self, *, idempotency_key: str | None, operation: str, session_id: str
    ) -> dict[str, Any] | None:
        if not idempotency_key:
            return None
        existing = self.journal.find_idempotency_key(idempotency_key)
        if existing is None:
            return None
        if existing["operation"] != operation or existing["sessionId"] != session_id:
            raise EventCaptureConflict("idempotencyKey is already associated with a different capture request.")
        return self._ack(existing, "Idempotent request returned its original capture acknowledgement.")

    def ensure_captured_session(self, session_id: str) -> dict[str, Any]:
        session = self.captured_session(session_id)
        if session is None:
            raise EventCaptureNotFound("Actual Event session was not found in the capture journal.")
        return session

    def ensure_session_writable(self, session_id: str) -> dict[str, Any]:
        session = self.ensure_captured_session(session_id)
        if session["record"].get("status") == "COMPLETED":
            raise EventCaptureConflict("Completed Actual Event sessions do not accept new capture records.")
        return session

    def ensure_captured_participant(self, session_id: str, participant_id: str) -> None:
        if not self.journal.has_participant(session_id, participant_id):
            raise EventCaptureNotFound("Actual Event participant was not found in the capture journal.")

    def recovery_sessions(self) -> list[dict[str, Any]]:
        """Read-only, contract-level recovery states; raw journal structure remains private."""
        return [self.recovery_session(entry["sessionId"]) for entry in self.journal.recovery_sessions()]

    def recovery_session(self, session_id: str) -> dict[str, Any]:
        session = self.ensure_captured_session(session_id)
        record = session["record"]
        participants = []
        for entry in self.journal.recovery_participants(session_id):
            participant = entry["record"]
            participants.append({
                "participantId": participant["participant_id"], "displayName": participant.get("display_name"),
                "kartId": participant.get("kart_id"), "participantType": participant.get("participant_type"),
                "specialRole": participant.get("special_role"), "source": participant.get("source"),
            })
        activities = []
        for entry in self.journal.recovery_activities(session_id):
            item = entry["record"]
            activities.append({
                "id": entry["id"], "operation": entry["operation"], "entityKind": entry["entityKind"],
                "syncStatus": entry["syncStatus"], "recordedAt": entry["recordedAt"],
                "participantId": item.get("participant_id"), "targetParticipantId": item.get("target_participant_id"),
                "lapNumber": item.get("lap_number"), "eventType": item.get("event_type"), "title": item.get("title"),
            })
        return {
            "sessionId": session_id, "eventId": record.get("event_id"), "sessionType": record.get("session_type"),
            "sessionName": record.get("session_name"), "status": record.get("status"), "source": record.get("source"),
            "operator": record.get("operator"), "createdAt": record.get("created_at"), "startedAt": record.get("started_at"),
            "endedAt": record.get("ended_at"), "participants": participants, "recentCaptures": activities,
        }

    def capture(
        self,
        *,
        operation: str,
        session_id: str,
        entity_kind: str,
        record: dict[str, Any],
        idempotency_key: str | None = None,
    ) -> dict[str, Any]:
        existing_acknowledgement = self.idempotent_acknowledgement(
            idempotency_key=idempotency_key, operation=operation, session_id=session_id
        )
        if existing_acknowledgement:
            return existing_acknowledgement

        entry = {
            "id": self.new_id("capture"),
            "sessionId": session_id,
            "operation": operation,
            "entityKind": entity_kind,
            "record": record,
            "idempotencyKey": idempotency_key,
            "syncStatus": "PENDING",
            "recordedAt": now_utc().isoformat(),
            "message": "Captured in the local recovery journal; awaiting governed AIDP Bronze ingestion.",
        }
        self.journal.append(entry)
        try:
            self.repository.persist(
                operation=operation, session_id=session_id, record=record, delivery_id=entry["id"]
            )
        except EventPersistenceUnavailable:
            return self._ack(entry)
        except Exception:
            # The journal is the durable system of acceptance until the approved
            # downstream adapter recovers; do not report a fictitious sync.
            return self._ack(entry, "Captured in the local recovery journal; downstream ingestion is temporarily unavailable.")

        synced = {
            **entry,
            "syncStatus": "SYNCED",
            "recordedAt": now_utc().isoformat(),
            "message": "Captured and synchronized with the configured governed persistence adapter.",
        }
        self.journal.append(synced)
        return self._ack(synced)

    def transition(self, session_id: str, target_status: str) -> dict[str, Any]:
        current = self.ensure_captured_session(session_id)
        current_status = current["record"].get("status")
        expected = {"RECORDING": "CREATED", "COMPLETED": "RECORDING"}[target_status]
        if current_status != expected:
            raise EventCaptureConflict(
                f"Invalid session transition: {current_status} cannot transition to {target_status}."
            )
        record = dict(current["record"])
        event_time = now_utc()
        record["status"] = target_status
        if target_status == "RECORDING":
            record["started_at"] = event_time.isoformat()
        else:
            record["ended_at"] = event_time.isoformat()
        record["ingested_at"] = event_time.isoformat()
        return self.capture(
            operation=f"SESSION_{target_status}",
            session_id=session_id,
            entity_kind="session",
            record=record,
        )

    def replay_pending(self) -> list[dict[str, Any]]:
        """Attempt idempotent delivery of journal entries left pending by an outage."""
        acknowledgements: list[dict[str, Any]] = []
        for entry in self.journal.pending_entries():
            try:
                self.repository.persist(
                    operation=entry["operation"], session_id=entry["sessionId"],
                    record=entry["record"], delivery_id=entry["id"],
                )
            except Exception:
                acknowledgements.append(self._ack(entry))
                continue
            synced = {
                **entry,
                "syncStatus": "SYNCED",
                "recordedAt": now_utc().isoformat(),
                "message": "Recovered from the local journal and synchronized with governed persistence.",
            }
            self.journal.append(synced)
            acknowledgements.append(self._ack(synced))
        return acknowledgements

    @staticmethod
    def _ack(entry: dict[str, Any], message: str | None = None) -> dict[str, Any]:
        return {
            "id": entry["id"],
            "sessionId": entry["sessionId"],
            "operation": entry["operation"],
            "syncStatus": entry["syncStatus"],
            "recordedAt": entry["recordedAt"],
            "message": message or entry["message"],
        }
