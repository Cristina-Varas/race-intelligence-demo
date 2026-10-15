"""Explicit downstream boundary for governed Actual Event Bronze persistence.

The serving API's Oracle connection is deliberately read-only and points at
Autonomous serving views. It is not an AIDP Delta write path. A deployment can
provide a concrete adapter here (for example an approved AIDP ingestion API),
without changing request validation or the local recovery journal.
"""
from __future__ import annotations

from typing import Any, Protocol


# Canonical AIDP Bronze contracts. The default adapter intentionally does not
# connect to these Delta tables; a future approved adapter uses this mapping.
BRONZE_EVENT_TABLES = {
    "CREATE_SESSION": "race_intelligence.bronze.event_session_raw",
    "SESSION_RECORDING": "race_intelligence.bronze.event_session_raw",
    "SESSION_COMPLETED": "race_intelligence.bronze.event_session_raw",
    "CREATE_PARTICIPANT": "race_intelligence.bronze.event_participant_raw",
    "CAPTURE_LAP": "race_intelligence.bronze.event_lap_raw",
    "CAPTURE_RACE_EVENT": "race_intelligence.bronze.event_race_event_raw",
    "CAPTURE_MEDIA_MARKER": "race_intelligence.bronze.event_media_marker_raw",
    "CAPTURE_SCENARIO_SNAPSHOT": "race_intelligence.bronze.event_scenario_snapshot_raw",
}


class EventPersistenceUnavailable(RuntimeError):
    """Raised when the governed AIDP Bronze write adapter is not configured."""


class EventCaptureRepository(Protocol):
    def persist(
        self, *, operation: str, session_id: str, record: dict[str, Any], delivery_id: str
    ) -> None:
        """Persist one record idempotently by delivery_id and its stable raw ID."""


class UnavailableEventCaptureRepository:
    """Safe default: retain the capture locally rather than misusing ADB views."""

    def persist(self, *, operation: str, session_id: str, record: dict[str, Any], delivery_id: str) -> None:
        raise EventPersistenceUnavailable(
            "No AIDP Bronze write adapter is configured. The accepted capture remains "
            "in the local recovery journal and awaits governed ingestion."
        )
