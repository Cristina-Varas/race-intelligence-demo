"""Bounded operational live state; raw AKS evidence remains durable elsewhere."""
from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timedelta, timezone
from typing import Any, Callable
import time
from threading import RLock

from .live_events import NormalizedEvent


class LiveEventStateStore:
    def __init__(self, stale_after_seconds: float = 15.0, source_epochs=None):
        self.lock = source_epochs.lock if source_epochs else RLock()
        self.stale_after_seconds = stale_after_seconds
        self._states: dict[str, dict[str, Any]] = {}
        self._listeners: list[Callable[[NormalizedEvent], None]] = []
        self.processing_times: dict[str, dict[str, float]] = {}

    def subscribe(self, listener: Callable[[NormalizedEvent], None]):
        self._listeners.append(listener)
        def unsubscribe():
            if listener in self._listeners: self._listeners.remove(listener)
        return unsubscribe

    def consume(self, event: NormalizedEvent) -> None:
        with self.lock:
            self._consume(event)

    def _consume(self, event: NormalizedEvent) -> None:
        state = self._states.setdefault(event.session_id, self._empty(event.session_id))
        if event.sequence <= state["lastSequence"]:
            return
        epoch = getattr(event, 'source_epoch', 1)
        if state['sourceEpoch'] != epoch:
            fresh = self._empty(event.session_id)
            fresh.update(stateVersion=state['stateVersion'],lastSequence=state['lastSequence'],connection=deepcopy(state['connection']),sourceEpoch=epoch)
            self._states[event.session_id] = state = fresh
        state["stateVersion"] += 1
        state["lastSequence"] = event.sequence
        state["source"] = event.source
        state["operationalContext"] = event.operational_context
        state["evidenceDomain"] = event.evidence_domain
        state["eventContractVersion"] = event.event_contract_version
        if event.event_type != "CONNECTION_STATE":
            state["updatedAt"] = event.recorded_at
            state["lastMessageAt"] = datetime.now(timezone.utc).isoformat()
            state["lastJsonAt"] = event.recorded_at
            state["connection"].update(connectionId=event.connection_id, status="LIVE", stale=False)
        if event.event_type == "CONNECTION_STATE":
            state["connection"].update(event.payload)
        elif event.event_type == "SESSION_STATE":
            state["sessionState"].update(deepcopy(event.payload))
        elif event.event_type == "STANDINGS_UPDATE":
            for row in event.payload.get("rows", []):
                participant = row.get("participantId")
                if participant:
                    state["standings"][participant] = deepcopy(row)
        elif event.event_type == "FINISH_LINE_UPDATE":
            state["finishLine"] = deepcopy(event.payload.get("rows", []))
        elif event.event_type == "PARTICIPANT_UPDATE":
            for row in event.payload.get("rows", []):
                participant = row.get("participantId")
                if participant: state["participants"][participant] = deepcopy(row)
        elif event.event_type == "POSITION_UPDATE":
            target = state["positions"][event.payload.get("positionSource", "GPS_CORRECTED")]
            for row in event.payload.get("rows", []):
                entity = row.get("sourceEntityId")
                if entity: target[entity] = deepcopy(row)
        elif event.event_type in {"RACE_CONTROL_UPDATE", "WEATHER_UPDATE"}:
            state[event.event_type] = deepcopy(event.payload)
        elif event.event_type == "LAP_UPDATE":
            for row in event.payload.get("rows", []):
                participant = row.get("participantId")
                prior = state["latestLaps"].get(participant)
                if participant and (prior is None or (row.get("lapNumber") or 0) >= (prior.get("lapNumber") or 0)):
                    state["latestLaps"][participant] = deepcopy(row)
        elif event.event_type == "LIVE_EVENT_UPDATE":
            state["latestLiveEvent"] = deepcopy(event.payload)
        event.processing_times["liveStateUpdatedAt"] = time.perf_counter()
        state['sourceState'] = 'READY' if state['standings'] else 'REBUILDING'
        self.processing_times[event.session_id] = event.processing_times
        for listener in tuple(self._listeners): listener(event)

    def _empty(self, session_id: str) -> dict[str, Any]:
        return {"sessionId": session_id, "sourceEpoch": 1, "sourceState": "REBUILDING", "stateVersion": 0, "lastSequence": 0, "updatedAt": None,
                "lastMessageAt": None, "lastJsonAt": None,
                "connection": {"status": "CONNECTING", "connectionId": 0, "reconnectCount": 0, "lastMessageAt": None, "stale": False},
                "sessionState": {}, "standings": {}, "participants": {}, "finishLine": [], "latestLaps": {},
                "positions": {"GPS_CORRECTED": {}, "RGPS_RAW": {}}}

    def snapshot(self, session_id: str, include_rgps: bool = False) -> dict[str, Any] | None:
        with self.lock:
            return self._snapshot(session_id, include_rgps)

    def _snapshot(self, session_id: str, include_rgps: bool = False) -> dict[str, Any] | None:
        state = self._states.get(session_id)
        if state is None: return None
        result = deepcopy(state)
        result["connection"]["stale"] = self._is_stale(result)
        stamp = result.get("lastMessageAt")
        result["connection"]["lastUpdateAgeSeconds"] = max(0, (datetime.now(timezone.utc) - datetime.fromisoformat(stamp)).total_seconds()) if stamp else None
        if result["connection"]["stale"] and result["connection"]["status"] != "RECONNECTING": result["connection"]["status"] = "STALE"
        result["standings"] = sorted(result["standings"].values(), key=lambda r: (r.get("position") is None, r.get("position") or 999999, r.get("participantId") or ""))
        result["participants"] = sorted(result["participants"].values(), key=lambda r: r.get("participantId") or "")
        result["positions"] = {"GPS_CORRECTED": list(result["positions"]["GPS_CORRECTED"].values())}
        if include_rgps: result["positions"]["RGPS_RAW"] = list(state["positions"]["RGPS_RAW"].values())
        return result

    def _is_stale(self, state: dict[str, Any]) -> bool:
        value = state.get("lastMessageAt")
        if not value: return True
        try: stamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError: return True
        return datetime.now(timezone.utc) - stamp > timedelta(seconds=self.stale_after_seconds)
