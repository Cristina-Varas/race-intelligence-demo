"""Actual Event serving reads plus validated operational capture endpoints."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Optional

import asyncio
from fastapi import APIRouter, HTTPException, Request, Response, WebSocket, WebSocketDisconnect

from ..models.responses import (
    EventParticipantCard,
    EventParticipantCreateRequest,
    EventParticipantRaceSummary,
    EventLapCreateRequest,
    EventMediaMarkerCreateRequest,
    EventPredictionVsReality,
    EventRaceEventCreateRequest,
    EventScenarioSnapshotCreateRequest,
    EventSessionCreateRequest,
    EventCaptureSessionState,
    EventObservedReplaySummary,
    EventTrackGeometry,
    EventSessionSummary,
    EventStandingReplay,
    EventStorylineEntry,
    EventTrackReplay,
    EventWriteAcknowledgement,
    EventMoment,
    EventMomentCreateRequest,
    EventParticipantSnapshot,
)
from ..serializers import event_row_response
from ..services.event_capture import EventCaptureConflict, EventCaptureNotFound
from ..services.event_moment_export import build_social_data_workbook
from ..services.event_moments import EventMomentService, automatic_moment_candidates, moment_evidence_domain
from ..services.baseball_card_data import build_card_data_csv, build_card_data_workbook, card_data, modelled_export_payload


router = APIRouter(prefix="/api/event", tags=["event"])

_SESSION_VIEW = "V_EVENT_RACE_SUMMARY"


@router.get("/live-source")
def live_source(request: Request):
    return request.app.state.live_source.metadata()


@router.get("/live-metrics")
def live_metrics(request: Request):
    result = request.app.state.live_event_metrics.snapshot()
    result["consumerErrors"] = list(request.app.state.live_event_bus.consumer_errors)
    result["eventsRejected"] = request.app.state.live_event_bus.events_rejected
    return result


def _live_snapshot(app, session_id, include_rgps=False):
    result = app.state.live_event_state.snapshot(session_id, include_rgps=include_rgps)
    if result is not None:
        result["sourceMode"] = app.state.live_source.mode.upper()
        result["eventMomentCandidates"] = list(app.state.live_event_moments.candidates.get(session_id, ()))
    return result


@router.get("/sessions/{session_id}/live-state")
def live_state(session_id: str, request: Request, include_rgps: bool = False) -> dict[str, Any]:
    """Latest normalized operational state. It never reads raw AKS frames."""
    result = _live_snapshot(request.app, session_id, include_rgps)
    if result is None:
        raise HTTPException(status_code=404, detail="No live operational state is available for this session.")
    result["eventMomentCandidates"] = list(request.app.state.live_event_moments.candidates.get(session_id, ()))
    return result


@router.websocket("/sessions/{session_id}/live")
async def live_socket(websocket: WebSocket, session_id: str) -> None:
    """Latest-state revisions at <=5 Hz, not a lossless domain-event transport.

    All normalized events reach consumers. Only presentation snapshots coalesce;
    there is no per-client event backlog and no raw evidence is discarded.
    """
    await websocket.accept()
    state = websocket.app.state.live_event_state
    metrics = websocket.app.state.live_event_metrics
    import time
    last_version = -1
    # Receiving concurrently detects disconnect even when the source is silent.
    async def receive_disconnect():
        while True:
            message = await websocket.receive()
            if message["type"] == "websocket.disconnect": return
    disconnect = asyncio.create_task(receive_disconnect(), name="event-websocket-disconnect")
    try:
        snapshot = _live_snapshot(websocket.app, session_id)
        await websocket.send_json({"type":"SNAPSHOT", "sessionId":session_id,
                                   "stateVersion": snapshot.get("stateVersion", 0) if snapshot else 0,
                                   "payload":snapshot})
        last_version = snapshot["stateVersion"] if snapshot else 0
        heartbeat = time.monotonic()
        while not disconnect.done():
            # Wake immediately on closure, including during an idle heartbeat interval.
            # Unlike wait_for, wait does not cancel the receiver on each timeout.
            await asyncio.wait({disconnect}, timeout=.2)
            if disconnect.done():
                await disconnect  # Propagate unexpected receive failures.
                break
            current = _live_snapshot(websocket.app, session_id)
            version = current["stateVersion"] if current else 0
            changed = version > last_version
            if not changed and time.monotonic() - heartbeat < 1: continue
            await websocket.send_json({"type": "STATE_UPDATE" if changed else "HEARTBEAT",
                "sessionId": session_id, "stateVersion": version, "payload": current})
            metrics.websocket_messages += 1
            if changed:
                if current and current["positions"]["GPS_CORRECTED"]: metrics.gps_publications += 1
                stamps = state.processing_times.get(session_id, {})
                if "liveStateUpdatedAt" in stamps:
                    metrics.measure({"liveStateUpdatedAt": stamps["liveStateUpdatedAt"], "websocketEmittedAt": time.perf_counter()})
            last_version = version
            heartbeat = time.monotonic()
    except WebSocketDisconnect:
        return
    except RuntimeError as exc:
        # Starlette/Uvicorn can report a send/close race as RuntimeError rather
        # than WebSocketDisconnect. Match only their explicit closed-send errors.
        # Arbitrary RuntimeErrors (serialization, snapshot bugs, etc.) must escape.
        message = str(exc)
        closed_send = (
            message == 'Cannot call "send" once a close message has been sent.'
            or message.startswith("Unexpected ASGI message 'websocket.send', after sending 'websocket.close'")
        )
        if not closed_send:
            raise
    finally:
        if not disconnect.done():
            disconnect.cancel()
        try:
            await disconnect
        except (asyncio.CancelledError, WebSocketDisconnect):
            pass
        # No per-client registry, bus subscription, outbound queue or heartbeat
        # task is allocated: the request owns its receiver and heartbeat loop.
        # The ASGI server closes transports during shutdown; don't send a second close.


def _require_session(request: Request, session_id: str) -> dict:
    rows = request.app.state.database.fetch_all(
        f"SELECT * FROM {_SESSION_VIEW} WHERE session_id = :session_id",
        {"session_id": session_id},
    )
    if not rows:
        raise HTTPException(status_code=404, detail="Actual Event session was not found.")
    return event_row_response(rows[0])


def _capture_service(request: Request):
    return request.app.state.event_capture


def _moment_service(request: Request) -> EventMomentService:
    return EventMomentService(_capture_service(request))


def _camel(record: dict[str, Any]) -> dict[str, Any]:
    """Map only local journal contract keys at the API boundary."""
    aliases = {
        "moment_id": "momentId", "session_id": "sessionId", "moment_type": "momentType",
        "trigger_mode": "triggerMode", "trigger_rule": "triggerRule", "observed_at": "observedAt",
        "recorded_at": "recordedAt", "created_at": "createdAt", "primary_participant_id": "primaryParticipantId",
        "related_participant_id": "relatedParticipantId", "external_participant_number": "externalParticipantNumber",
        "related_external_participant_number": "relatedExternalParticipantNumber", "source_snapshot_id": "sourceSnapshotId",
        "prior_value": "priorValue", "current_value": "currentValue", "delta_value": "deltaValue",
        "social_priority": "socialPriority", "operator_note": "operatorNote", "operational_context": "operationalContext",
        "evidence_domain": "evidenceDomain", "event_contract_version": "eventContractVersion",
        "snapshot_id": "snapshotId", "participant_id": "participantId", "lap_number": "lapNumber",
        "gap_first_seconds": "gapFirstSeconds", "gap_previous_seconds": "gapPreviousSeconds",
        "position_change": "positionChange", "at_loop": "atLoop", "start_position": "startPosition", "peak_position": "peakPosition",
        "sync_status": "syncStatus",
    }
    return event_row_response({aliases.get(key, key): value for key, value in record.items() if key != "captureId"})


def _standing_snapshot_rows(request: Request, session_id: str, at: datetime) -> list[dict[str, Any]]:
    """Read the latest factual state at or before a moment. Never read future evidence."""
    sql = """
        WITH chosen AS (
            SELECT snapshot_id
            FROM V_EVENT_STANDING_REPLAY
            WHERE session_id = :session_id AND observed_at <= :observed_at
            ORDER BY observed_at DESC NULLS LAST, snapshot_id DESC NULLS LAST
            FETCH FIRST 1 ROW ONLY
        ), participant_history AS (
            SELECT participant_id,
                   MIN(position) KEEP (DENSE_RANK FIRST ORDER BY observed_at, snapshot_id) AS start_position,
                   MIN(position) AS peak_position
            FROM V_EVENT_STANDING_REPLAY
            WHERE session_id = :session_id AND observed_at <= :observed_at AND participant_id IS NOT NULL
            GROUP BY participant_id
        )
        SELECT standing.*, history.start_position, history.peak_position
        FROM V_EVENT_STANDING_REPLAY standing
        LEFT JOIN participant_history history ON history.participant_id = standing.participant_id
        WHERE standing.session_id = :session_id AND standing.snapshot_id = (SELECT snapshot_id FROM chosen)
        ORDER BY standing.position NULLS LAST, standing.participant_id
    """
    return request.app.state.database.fetch_all(sql, {"session_id": session_id, "observed_at": at})


def _external_number(rows: list[dict[str, Any]], participant_id: Optional[str]) -> Optional[str]:
    if participant_id is None:
        return None
    row = next((item for item in rows if item.get("participantId") == participant_id), None)
    return row.get("externalParticipantNumber") if row else None


def _snapshots_from_factual_rows(*, session_id: str, moment_id: str, moment_at: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    snapshots = []
    for row in rows:
        participant_id = row.get("participantId")
        if not participant_id:
            continue
        snapshots.append({
            "snapshot_id": f"snapshot_{moment_id}_{participant_id}", "moment_id": moment_id, "session_id": session_id,
            "participant_id": participant_id, "external_participant_number": row.get("externalParticipantNumber"),
            "observed_at": moment_at, "source_snapshot_id": row.get("snapshotId"), "position": row.get("position"),
            "lap_number": row.get("lapNumber"), "gap_first_seconds": row.get("gapFirstSeconds"),
            "gap_previous_seconds": row.get("gapPreviousSeconds"), "position_change": row.get("positionChange"),
            "at_loop": row.get("atLoop"), "status": row.get("status"), "start_position": row.get("startPosition"),
            "peak_position": row.get("peakPosition"), "source": row.get("source") or "AKS",
            "operational_context": row.get("operationalContext"), "evidence_domain": row.get("evidenceDomain") or "FACTUAL_OBSERVATION",
            "event_contract_version": row.get("eventContractVersion") or "1.0",
        })
    return snapshots


def _filtered_moments(*, request: Request, session_id: str, moment_type: Optional[str] = None,
                      participant_id: Optional[str] = None, trigger_mode: Optional[str] = None,
                      priority: Optional[str] = None, from_time: Optional[datetime] = None,
                      to_time: Optional[datetime] = None) -> list[dict[str, Any]]:
    """The table and workbook share this exact local, append-only projection."""
    rows = _moment_service(request).moments(session_id)
    if moment_type: rows = [row for row in rows if row.get("moment_type") == moment_type]
    if participant_id: rows = [row for row in rows if participant_id in {row.get("primary_participant_id"), row.get("related_participant_id")}]
    if trigger_mode: rows = [row for row in rows if row.get("trigger_mode") == trigger_mode]
    if priority: rows = [row for row in rows if row.get("social_priority") == priority or row.get("importance") == priority]
    def instant(row: dict[str, Any]) -> datetime:
        value = str(row.get("observed_at") or row.get("created_at"))
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)
    if from_time: rows = [row for row in rows if instant(row) >= _utc_event_time(from_time)]
    if to_time: rows = [row for row in rows if instant(row) <= _utc_event_time(to_time)]
    return rows


@router.get("/capture/sessions", response_model=list[EventCaptureSessionState])
def capture_sessions(request: Request):
    """Recoverable sessions accepted by the Event Capture boundary, not serving views."""
    return _capture_service(request).recovery_sessions()


@router.get("/capture/sessions/{session_id}", response_model=EventCaptureSessionState)
def capture_session_detail(session_id: str, request: Request):
    try:
        return _capture_service(request).recovery_session(session_id)
    except EventCaptureNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _require_capture_session(request: Request, session_id: str) -> None:
    try:
        _capture_service(request).ensure_captured_session(session_id)
    except EventCaptureNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _require_capture_participant(request: Request, session_id: str, participant_id: str | None) -> None:
    if participant_id is None:
        return
    try:
        _capture_service(request).ensure_captured_participant(session_id, participant_id)
    except EventCaptureNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc


def _require_capture_session_writable(request: Request, session_id: str) -> None:
    try:
        _capture_service(request).ensure_session_writable(session_id)
    except EventCaptureNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EventCaptureConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc


def _write_response(response: Response, acknowledgement: dict[str, Any]) -> dict[str, Any]:
    response.status_code = 201 if acknowledgement["syncStatus"] == "SYNCED" else 202
    return acknowledgement


def _idempotent_response(
    service, response: Response, *, key: str | None, operation: str, session_id: str
) -> dict[str, Any] | None:
    try:
        acknowledgement = service.idempotent_acknowledgement(
            idempotency_key=key, operation=operation, session_id=session_id
        )
    except EventCaptureConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _write_response(response, acknowledgement) if acknowledgement else None


def _server_timestamps() -> tuple[str, str]:
    now = datetime.now(timezone.utc).isoformat()
    return now, now


@router.post("/sessions", response_model=EventWriteAcknowledgement)
def create_session(payload: EventSessionCreateRequest, request: Request, response: Response):
    service = _capture_service(request)
    session_id = payload.sessionId or service.new_id("session", payload.idempotencyKey)
    existing = _idempotent_response(
        service, response, key=payload.idempotencyKey, operation="CREATE_SESSION", session_id=session_id
    )
    if existing:
        return existing
    if service.captured_session(session_id):
        raise HTTPException(status_code=409, detail="An Actual Event session with this sessionId already exists.")
    created_at, ingested_at = _server_timestamps()
    record = {
        "session_id": session_id,
        "event_id": payload.eventId,
        "session_type": payload.sessionType,
        "session_name": payload.sessionName,
        "started_at": None,
        "ended_at": None,
        "status": "CREATED",
        "operator": payload.operator,
        "notes": payload.notes,
        "source": "RACE_OPERATIONS_API",
        "created_at": created_at,
        "ingested_at": ingested_at,
    }
    acknowledgement = service.capture(
        operation="CREATE_SESSION", session_id=session_id, entity_kind="session", record=record,
        idempotency_key=payload.idempotencyKey,
    )
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/start", response_model=EventWriteAcknowledgement)
def start_session(session_id: str, request: Request, response: Response):
    try:
        acknowledgement = _capture_service(request).transition(session_id, "RECORDING")
    except EventCaptureNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EventCaptureConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/complete", response_model=EventWriteAcknowledgement)
def complete_session(session_id: str, request: Request, response: Response):
    try:
        acknowledgement = _capture_service(request).transition(session_id, "COMPLETED")
    except EventCaptureNotFound as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except EventCaptureConflict as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/participants", response_model=EventWriteAcknowledgement)
def create_participant(
    session_id: str, payload: EventParticipantCreateRequest, request: Request, response: Response,
):
    _require_capture_session(request, session_id)
    service = _capture_service(request)
    existing = _idempotent_response(
        service, response, key=payload.idempotencyKey, operation="CREATE_PARTICIPANT", session_id=session_id
    )
    if existing:
        return existing
    _require_capture_session_writable(request, session_id)
    participant_id = payload.participantId or service.new_id("participant", payload.idempotencyKey)
    if service.journal.has_participant(session_id, participant_id):
        raise HTTPException(status_code=409, detail="An Actual Event participant with this participantId already exists.")
    created_at, ingested_at = _server_timestamps()
    acknowledgement = service.capture(
        operation="CREATE_PARTICIPANT", session_id=session_id, entity_kind="participant",
        idempotency_key=payload.idempotencyKey,
        record={
            "session_id": session_id, "participant_id": participant_id,
            "display_name": payload.displayName, "kart_id": payload.kartId,
            "participant_type": payload.participantType, "special_role": payload.specialRole,
            "source": "RACE_OPERATIONS_API", "created_at": created_at, "ingested_at": ingested_at,
        },
    )
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/laps", response_model=EventWriteAcknowledgement)
def create_lap(session_id: str, payload: EventLapCreateRequest, request: Request, response: Response):
    _require_capture_session(request, session_id)
    _require_capture_participant(request, session_id, payload.participantId)
    service = _capture_service(request)
    existing = _idempotent_response(
        service, response, key=payload.idempotencyKey, operation="CAPTURE_LAP", session_id=session_id
    )
    if existing:
        return existing
    _require_capture_session_writable(request, session_id)
    observation_id = payload.observationId or service.new_id("lap", payload.idempotencyKey)
    created_at, ingested_at = _server_timestamps()
    acknowledgement = service.capture(
        operation="CAPTURE_LAP", session_id=session_id, entity_kind="lap", idempotency_key=payload.idempotencyKey,
        record={
            "observation_id": observation_id, "session_id": session_id, "participant_id": payload.participantId,
            "lap_number": payload.lapNumber, "lap_time_seconds": payload.lapTimeSeconds,
            "sector_1_seconds": payload.sector1Seconds, "sector_2_seconds": payload.sector2Seconds,
            "sector_3_seconds": payload.sector3Seconds, "position": payload.position,
            "gap_to_max_seconds": payload.gapToMaxSeconds, "gap_to_leader_seconds": payload.gapToLeaderSeconds,
            "source": "RACE_OPERATIONS_API", "observed_at": payload.observedAt.isoformat() if payload.observedAt else None,
            "operator_note": payload.operatorNote, "created_at": created_at, "ingested_at": ingested_at,
        },
    )
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/events", response_model=EventWriteAcknowledgement)
def create_event(session_id: str, payload: EventRaceEventCreateRequest, request: Request, response: Response):
    _require_capture_session(request, session_id)
    _require_capture_participant(request, session_id, payload.participantId)
    _require_capture_participant(request, session_id, payload.targetParticipantId)
    service = _capture_service(request)
    existing = _idempotent_response(
        service, response, key=payload.idempotencyKey, operation="CAPTURE_RACE_EVENT", session_id=session_id
    )
    if existing:
        return existing
    _require_capture_session_writable(request, session_id)
    event_record_id = payload.eventRecordId or service.new_id("event", payload.idempotencyKey)
    created_at, ingested_at = _server_timestamps()
    acknowledgement = service.capture(
        operation="CAPTURE_RACE_EVENT", session_id=session_id, entity_kind="race_event", idempotency_key=payload.idempotencyKey,
        record={
            "event_record_id": event_record_id, "session_id": session_id, "race_time_seconds": payload.raceTimeSeconds,
            "lap_number": payload.lapNumber, "participant_id": payload.participantId,
            "target_participant_id": payload.targetParticipantId, "event_type": payload.eventType,
            "value": payload.value, "notes": payload.notes, "source": "RACE_OPERATIONS_API",
            "recorded_at": payload.recordedAt.isoformat() if payload.recordedAt else None,
            "created_at": created_at, "ingested_at": ingested_at,
        },
    )
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/media-markers", response_model=EventWriteAcknowledgement)
def create_media_marker(
    session_id: str, payload: EventMediaMarkerCreateRequest, request: Request, response: Response,
):
    _require_capture_session(request, session_id)
    _require_capture_participant(request, session_id, payload.participantId)
    service = _capture_service(request)
    existing = _idempotent_response(
        service, response, key=payload.idempotencyKey, operation="CAPTURE_MEDIA_MARKER", session_id=session_id
    )
    if existing:
        return existing
    _require_capture_session_writable(request, session_id)
    marker_id = payload.markerId or service.new_id("marker", payload.idempotencyKey)
    created_at, ingested_at = _server_timestamps()
    acknowledgement = service.capture(
        operation="CAPTURE_MEDIA_MARKER", session_id=session_id, entity_kind="media_marker", idempotency_key=payload.idempotencyKey,
        record={
            "marker_id": marker_id, "session_id": session_id, "race_time_seconds": payload.raceTimeSeconds,
            "lap_number": payload.lapNumber, "participant_id": payload.participantId,
            "marker_type": payload.markerType, "title": payload.title, "notes": payload.notes,
            "priority": payload.priority, "created_at": created_at, "ingested_at": ingested_at,
        },
    )
    return _write_response(response, acknowledgement)


@router.post("/sessions/{session_id}/scenario-snapshots", response_model=EventWriteAcknowledgement)
def create_scenario_snapshot(
    session_id: str, payload: EventScenarioSnapshotCreateRequest, request: Request, response: Response,
):
    _require_capture_session(request, session_id)
    service = _capture_service(request)
    existing = _idempotent_response(
        service, response, key=payload.idempotencyKey, operation="CAPTURE_SCENARIO_SNAPSHOT", session_id=session_id
    )
    if existing:
        return existing
    _require_capture_session_writable(request, session_id)
    snapshot_id = payload.scenarioSnapshotId or service.new_id("snapshot", payload.idempotencyKey)
    created_at, ingested_at = _server_timestamps()
    record = payload.model_dump(by_alias=False, exclude={"scenarioSnapshotId", "snapshotType", "idempotencyKey"})
    snake_case = {
        "field_mode": record.pop("fieldMode"), "race_format": record.pop("raceFormat"),
        "race_laps": record.pop("raceLaps"), "race_duration_seconds": record.pop("raceDurationSeconds"),
        "virtual_max_pace_seconds": record.pop("virtualMaxPaceSeconds"),
        "virtual_max_gain_seconds_per_lap": record.pop("virtualMaxGainSecondsPerLap"),
        "starting_delay_seconds": record.pop("startingDelaySeconds"), "race_model_mode": record.pop("raceModelMode"),
        "field_variability_mode": record.pop("fieldVariabilityMode"), "field_variability_seed": record.pop("fieldVariabilitySeed"),
        "pace_profile_json": record.pop("paceProfileJson"), "traffic_model_json": record.pop("trafficModelJson"),
        "joker_config_json": record.pop("jokerConfigJson"), "vm_projected_finish_seconds": record.pop("vmProjectedFinishSeconds"),
        "vm_projected_rank": record.pop("vmProjectedRank"), "predicted_p1_lap": record.pop("predictedP1Lap"),
        "predicted_p1_time_seconds": record.pop("predictedP1TimeSeconds"),
        "predicted_full_field_catch_lap": record.pop("predictedFullFieldCatchLap"),
        "predicted_full_field_catch_time_seconds": record.pop("predictedFullFieldCatchTimeSeconds"),
        "timing_caught": record.pop("timingCaught"), "still_to_clear": record.pop("stillToClear"),
        "model_version": record.pop("modelVersion"), "git_commit": record.pop("gitCommit"),
    }
    acknowledgement = service.capture(
        operation="CAPTURE_SCENARIO_SNAPSHOT", session_id=session_id, entity_kind="scenario_snapshot",
        idempotency_key=payload.idempotencyKey,
        record={
            "scenario_snapshot_id": snapshot_id, "session_id": session_id, "snapshot_type": payload.snapshotType,
            **snake_case, "cleared": record.pop("cleared"), "created_at": created_at, "ingested_at": ingested_at,
        },
    )
    return _write_response(response, acknowledgement)


def _create_event_moment(
    *, session_id: str, request: Request, moment_type: str, trigger_mode: str,
    observed_at: datetime | None, primary_participant_id: str | None, related_participant_id: str | None,
    title: str | None, description: str | None, importance: str, social_priority: str,
    operator_note: str | None, trigger_rule: str | None = None, source_snapshot_id: str | None = None,
    prior_value: float | None = None, current_value: float | None = None, delta_value: float | None = None,
    unit: str | None = None, idempotency_key: str | None = None,
) -> dict[str, Any]:
    _require_session(request, session_id)
    service = _moment_service(request)
    moment_id = service.capture.new_id("moment", idempotency_key)
    existing = service.moment(session_id, moment_id)
    if existing:
        return _camel(existing)
    instant = observed_at or datetime.now(timezone.utc)
    instant = instant.replace(tzinfo=timezone.utc) if instant.tzinfo is None else instant.astimezone(timezone.utc)
    factual_rows = _standing_snapshot_rows(request, session_id, instant)
    created_at = datetime.now(timezone.utc).isoformat()
    record = {
        "moment_id": moment_id, "session_id": session_id, "moment_type": moment_type,
        "title": title, "description": description, "trigger_mode": trigger_mode, "trigger_rule": trigger_rule,
        "observed_at": instant.isoformat(), "recorded_at": created_at, "created_at": created_at,
        "primary_participant_id": primary_participant_id, "related_participant_id": related_participant_id,
        "external_participant_number": _external_number(factual_rows, primary_participant_id),
        "related_external_participant_number": _external_number(factual_rows, related_participant_id),
        "source_snapshot_id": source_snapshot_id or (factual_rows[0].get("snapshotId") if factual_rows else None),
        "prior_value": prior_value, "current_value": current_value, "delta_value": delta_value, "unit": unit,
        "importance": importance, "social_priority": social_priority, "operator_note": operator_note,
        "source": "RACE_OPERATIONS", "operational_context": (factual_rows[0].get("operationalContext") if factual_rows else None),
        "evidence_domain": moment_evidence_domain(moment_type), "event_contract_version": "1.0",
    }
    snapshots = _snapshots_from_factual_rows(session_id=session_id, moment_id=moment_id,
                                             moment_at=instant.isoformat(), rows=factual_rows)
    return _camel(service.create(session_id=session_id, record=record, snapshots=snapshots, idempotency_key=idempotency_key))


@router.get("/sessions/{session_id}/moments", response_model=list[EventMoment])
def event_moments(
    session_id: str, request: Request, moment_type: Optional[str] = None, participant_id: Optional[str] = None,
    trigger_mode: Optional[str] = None, priority: Optional[str] = None, from_time: Optional[datetime] = None,
    to_time: Optional[datetime] = None, limit: int = 100, offset: int = 0,
):
    _require_session(request, session_id)
    rows = _filtered_moments(request=request, session_id=session_id, moment_type=moment_type,
                             participant_id=participant_id, trigger_mode=trigger_mode, priority=priority,
                             from_time=from_time, to_time=to_time)
    return [_camel(row) for row in rows[offset:max(offset, 0) + max(1, min(limit, 500))]]


@router.post("/sessions/{session_id}/moments", response_model=EventMoment)
def create_event_moment(session_id: str, payload: EventMomentCreateRequest, request: Request):
    return _create_event_moment(
        session_id=session_id, request=request, moment_type=payload.momentType, trigger_mode="OPERATOR",
        observed_at=payload.observedAt, primary_participant_id=payload.primaryParticipantId,
        related_participant_id=payload.relatedParticipantId, title=payload.title, description=payload.description,
        importance=payload.importance, social_priority=payload.socialPriority, operator_note=payload.operatorNote,
        trigger_rule="OPERATOR_MARKER", idempotency_key=payload.idempotencyKey,
    )


@router.get("/sessions/{session_id}/moments/{moment_id}", response_model=EventMoment)
def event_moment_detail(session_id: str, moment_id: str, request: Request):
    _require_session(request, session_id)
    moment = _moment_service(request).moment(session_id, moment_id)
    if moment is None:
        raise HTTPException(status_code=404, detail="Event Moment was not found.")
    return _camel(moment)


@router.get("/sessions/{session_id}/moments/{moment_id}/snapshots", response_model=list[EventParticipantSnapshot])
def event_moment_snapshots(session_id: str, moment_id: str, request: Request):
    _require_session(request, session_id)
    if _moment_service(request).moment(session_id, moment_id) is None:
        raise HTTPException(status_code=404, detail="Event Moment was not found.")
    return [_camel(row) for row in _moment_service(request).snapshots(session_id, moment_id)]


@router.post("/sessions/{session_id}/moments/detect", response_model=list[EventMoment])
def detect_event_moments(session_id: str, request: Request, limit: int = 1000):
    """Explicit server-side replay/backfill detector, never called per browser frame."""
    _require_session(request, session_id)
    rows = request.app.state.database.fetch_all(
        "SELECT * FROM V_EVENT_STANDING_REPLAY WHERE session_id = :session_id "
        "ORDER BY observed_at, snapshot_id, participant_id FETCH FIRST :limit ROWS ONLY",
        {"session_id": session_id, "limit": max(1, min(limit, 10000))},
    )
    created = []
    for candidate in automatic_moment_candidates(rows):
        stable_key = f"auto:{session_id}:{candidate['momentType']}:{candidate.get('sourceSnapshotId')}:{candidate.get('primaryParticipantId')}"
        created.append(_create_event_moment(
            session_id=session_id, request=request, moment_type=candidate["momentType"], trigger_mode="AUTOMATIC",
            observed_at=datetime.fromisoformat(candidate["observedAt"].replace("Z", "+00:00")),
            primary_participant_id=candidate.get("primaryParticipantId"), related_participant_id=candidate.get("relatedParticipantId"),
            title=None, description=None, importance="MEDIUM", social_priority="MEDIUM", operator_note=None,
            trigger_rule=candidate.get("triggerRule"), source_snapshot_id=candidate.get("sourceSnapshotId"),
            prior_value=candidate.get("priorValue"), current_value=candidate.get("currentValue"),
            delta_value=candidate.get("deltaValue"), unit=candidate.get("unit"), idempotency_key=stable_key,
        ))
    return created


@router.get("/sessions/{session_id}/social-data-export.xlsx")
def social_data_export(session_id: str, request: Request, moment_type: Optional[str] = None,
                       participant_id: Optional[str] = None, trigger_mode: Optional[str] = None,
                       priority: Optional[str] = None, from_time: Optional[datetime] = None,
                       to_time: Optional[datetime] = None):
    _require_session(request, session_id)
    service = _moment_service(request)
    moments = _filtered_moments(request=request, session_id=session_id, moment_type=moment_type,
                                participant_id=participant_id, trigger_mode=trigger_mode, priority=priority,
                                from_time=from_time, to_time=to_time)
    snapshots = [snapshot for moment in moments for snapshot in service.snapshots(session_id, moment["moment_id"])]
    try:
        payload = build_social_data_workbook(session_id=session_id, moments=moments, snapshots=snapshots)
    except ImportError as exc:
        raise HTTPException(status_code=503, detail="XLSX export dependency is not installed.") from exc
    return Response(content=payload,
                    media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                    headers={"Content-Disposition": f'attachment; filename="{session_id}_social_data.xlsx"'})


@router.get("/sessions", response_model=list[EventSessionSummary])
def sessions(request: Request):
    rows = request.app.state.database.fetch_all(
        "SELECT * FROM V_EVENT_RACE_SUMMARY "
        "ORDER BY started_at DESC NULLS LAST, session_id DESC"
    )
    return [event_row_response(row) for row in rows]


@router.get("/sessions/{session_id}", response_model=EventSessionSummary)
def session_detail(session_id: str, request: Request):
    return _require_session(request, session_id)


@router.get("/sessions/{session_id}/participants", response_model=list[EventParticipantRaceSummary])
def participants(session_id: str, request: Request):
    _require_session(request, session_id)
    rows = request.app.state.database.fetch_all(
        "SELECT * FROM V_EVENT_PARTICIPANT_RACE_SUMMARY WHERE session_id = :session_id "
        "ORDER BY final_position ASC NULLS LAST, best_lap_seconds ASC NULLS LAST, participant_id ASC",
        {"session_id": session_id},
    )
    return [event_row_response(row) for row in rows]


@router.get("/sessions/{session_id}/storyline", response_model=list[EventStorylineEntry])
def storyline(session_id: str, request: Request):
    _require_session(request, session_id)
    rows = request.app.state.database.fetch_all(
        "SELECT * FROM V_EVENT_STORYLINE WHERE session_id = :session_id "
        "ORDER BY race_time_seconds ASC NULLS LAST, lap_number ASC NULLS LAST, source_record_id ASC",
        {"session_id": session_id},
    )
    return [event_row_response(row) for row in rows]


@router.get("/sessions/{session_id}/prediction-vs-reality", response_model=list[EventPredictionVsReality])
def prediction_vs_reality(session_id: str, request: Request):
    _require_session(request, session_id)
    rows = request.app.state.database.fetch_all(
        "SELECT * FROM V_EVENT_PREDICTION_VS_REALITY WHERE session_id = :session_id "
        "ORDER BY snapshot_type ASC NULLS LAST, scenario_snapshot_id ASC",
        {"session_id": session_id},
    )
    return [event_row_response(row) for row in rows]


@router.get("/sessions/{session_id}/cards", response_model=list[EventParticipantCard])
def cards(session_id: str, request: Request):
    _require_session(request, session_id)
    rows = request.app.state.database.fetch_all(
        "SELECT * FROM V_EVENT_PARTICIPANT_CARD_FEED WHERE session_id = :session_id "
        "ORDER BY actual_final_position ASC NULLS LAST, participant_id ASC",
        {"session_id": session_id},
    )
    return [event_row_response(row) for row in rows]


def _baseball_source(request: Request, session_id: str, mode: str, source: str):
    if source not in {"auto", "live", "replay"}:
        raise ValueError("Unsupported EVENT card source.")
    if mode == "event" and source != "replay":
        tracked = session_id in request.app.state.live_baseball_cards.sessions
        if tracked or source == "live":
            return request.app.state.live_baseball_cards.snapshot(session_id, request.app.state.live_source.mode.upper())
    # Explicit post-session cutover; no change to LIVE selection or modelled methodology.
    import os
    if mode == "event" and os.getenv("EVENT_POST_SESSION_SOURCE") == "aidp":
        from ..services.baseball_card_data import build_serving_card_data
        return build_serving_card_data(session_id, request.app.state.database)
    return card_data(session_id, mode)


@router.get("/sessions/{session_id}/baseball-card-data")
def baseball_card_data(session_id: str, request: Request, mode: str = "event", source: str = "auto") -> dict[str, Any]:
    """Identity-safe operational card-data preview.

    Selects a detached hot-path snapshot or the explicit approved recording.
    No ADB/AIDP writes, source mixing, or participant names.
    """
    try:
        return _baseball_source(request, session_id, mode, source)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post('/modelled-card-data/export/{format}')
def export_modelled_card_data(format: str, payload: dict[str, Any]) -> Response:
    """Transient formatting only; no Event writes or simulation execution."""
    if format not in {'xlsx', 'csv'}:
        raise HTTPException(status_code=422, detail='Unsupported export format.')
    try:
        safe = modelled_export_payload(payload)
    except (ValueError, TypeError, AttributeError) as exc:
        raise HTTPException(status_code=422, detail='Invalid anonymous MODELLED card projection.') from exc
    return Response(build_card_data_workbook(safe) if format == 'xlsx' else build_card_data_csv(safe),
                    media_type='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' if format == 'xlsx' else 'text/csv; charset=utf-8',
                    headers={'Content-Disposition': f'attachment; filename="Synthetic100_card_data.{format}"'})


@router.get("/sessions/{session_id}/baseball-card-data.xlsx")
def baseball_card_data_xlsx(session_id: str, request: Request, mode: str = "event", source: str = "auto") -> Response:
    try:
        payload = _baseball_source(request, session_id, mode, source)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        build_card_data_workbook(payload),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{session_id}_card_data.xlsx"'},
    )


@router.get("/sessions/{session_id}/baseball-card-data.csv")
def baseball_card_data_csv(session_id: str, request: Request, mode: str = "event", source: str = "auto") -> Response:
    try:
        payload = _baseball_source(request, session_id, mode, source)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return Response(
        build_card_data_csv(payload), media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{session_id}_card_data.csv"'},
    )


@router.get("/sessions/{session_id}/standings", response_model=list[EventStandingReplay])
def standings(
    session_id: str, request: Request, from_time: Optional[datetime] = None, to_time: Optional[datetime] = None,
    participant_id: Optional[str] = None, snapshot_id: Optional[str] = None, at_time: Optional[datetime] = None, limit: int = 100,
):
    """Observed AKS standings state only; never a final classification."""
    _require_session(request, session_id)
    limit = max(1, min(limit, 500))
    where, params = ["session_id = :session_id"], {"session_id": session_id, "limit": limit}
    if snapshot_id:
        where.append("snapshot_id = :snapshot_id"); params["snapshot_id"] = snapshot_id
    elif at_time is not None:
        where.append("snapshot_id = (SELECT snapshot_id FROM V_EVENT_STANDING_REPLAY WHERE session_id = :session_id AND observed_at <= :at_time ORDER BY observed_at DESC NULLS LAST, snapshot_id DESC NULLS LAST FETCH FIRST 1 ROW ONLY)")
        params["at_time"] = at_time
    elif from_time is None and to_time is None and participant_id is None:
        where.append("snapshot_id = (SELECT MAX(snapshot_id) KEEP (DENSE_RANK LAST ORDER BY observed_at, snapshot_id) FROM V_EVENT_STANDING_REPLAY WHERE session_id = :session_id)")
    if from_time: where.append("observed_at >= :from_time"); params["from_time"] = from_time
    if to_time: where.append("observed_at <= :to_time"); params["to_time"] = to_time
    if participant_id: where.append("participant_id = :participant_id"); params["participant_id"] = participant_id
    sql = "SELECT * FROM V_EVENT_STANDING_REPLAY WHERE " + " AND ".join(where) + " ORDER BY observed_at, position NULLS LAST, participant_id FETCH FIRST :limit ROWS ONLY"
    return [event_row_response(row) for row in request.app.state.database.fetch_all(sql, params)]


@router.get("/sessions/{session_id}/standings-series", response_model=list[EventStandingReplay])
def standings_series(
    session_id: str, request: Request, from_time: Optional[datetime] = None, to_time: Optional[datetime] = None,
    participant_id: Optional[str] = None, top_n: int = 5, resolution_seconds: int = 30, limit: int = 1500,
):
    """Bounded factual standings samples for temporal operational charts; no interpolation."""
    _require_session(request, session_id)
    top_n = max(1, min(top_n, 10))
    resolution_seconds = max(5, min(resolution_seconds, 3600))
    limit = max(1, min(limit, 3000))
    where, params = ["session_id = :session_id"], {
        "session_id": session_id, "participant_id": participant_id, "top_n": top_n,
        "resolution_seconds": resolution_seconds, "limit": limit,
    }
    if from_time is not None:
        where.append("observed_at >= :from_time"); params["from_time"] = from_time
    if to_time is not None:
        where.append("observed_at <= :to_time"); params["to_time"] = to_time
    if from_time is None and to_time is None:
        where.append("observed_at >= (SELECT MAX(observed_at) - NUMTODSINTERVAL(900, 'SECOND') FROM V_EVENT_STANDING_REPLAY WHERE session_id = :session_id)")
    filters = " AND ".join(where)
    sql = f"""
        WITH latest_per_participant AS (
            SELECT participant_id, position,
                   ROW_NUMBER() OVER (PARTITION BY participant_id ORDER BY observed_at DESC NULLS LAST, snapshot_id DESC NULLS LAST) AS rank_at_end
            FROM V_EVENT_STANDING_REPLAY
            WHERE {filters} AND participant_id IS NOT NULL
        ), selected_participants AS (
            SELECT participant_id
            FROM latest_per_participant
            WHERE rank_at_end = 1
            ORDER BY position NULLS LAST, participant_id
            FETCH FIRST :top_n ROWS ONLY
        ), bucketed AS (
            SELECT feed.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY participant_id,
                         TRUNC((CAST(observed_at AS DATE) - DATE '1970-01-01') * 86400 / :resolution_seconds)
                       ORDER BY observed_at DESC NULLS LAST, snapshot_id DESC NULLS LAST
                   ) AS sample_rank
            FROM V_EVENT_STANDING_REPLAY feed
            WHERE {filters}
              AND (:participant_id IS NOT NULL OR participant_id IN (SELECT participant_id FROM selected_participants))
              AND (:participant_id IS NULL OR participant_id = :participant_id)
        )
        SELECT * FROM bucketed
        WHERE sample_rank = 1
        ORDER BY observed_at, position NULLS LAST, participant_id
        FETCH FIRST :limit ROWS ONLY
    """
    return [event_row_response(row) for row in request.app.state.database.fetch_all(sql, params)]


@router.get("/sessions/{session_id}/observed-replay-summary", response_model=EventObservedReplaySummary)
def observed_replay_summary(session_id: str, request: Request):
    """Read-only aggregation of factual AKS standings and positional evidence."""
    _require_session(request, session_id)
    sql = """
        WITH latest_snapshot AS (
            SELECT snapshot_id
            FROM V_EVENT_STANDING_REPLAY
            WHERE session_id = :session_id
            ORDER BY observed_at DESC NULLS LAST, snapshot_id DESC NULLS LAST
            FETCH FIRST 1 ROW ONLY
        ),
        latest_standings AS (
            SELECT *
            FROM V_EVENT_STANDING_REPLAY
            WHERE session_id = :session_id
              AND snapshot_id = (SELECT snapshot_id FROM latest_snapshot)
        )
        SELECT
            :session_id AS session_id,
            (SELECT COUNT(DISTINCT snapshot_id) FROM V_EVENT_STANDING_REPLAY WHERE session_id = :session_id) AS standing_snapshot_count,
            (SELECT COUNT(*) FROM V_EVENT_STANDING_REPLAY WHERE session_id = :session_id) AS standing_row_count,
            (SELECT MAX(observed_at) FROM latest_standings) AS latest_standing_observed_at,
            (SELECT MAX(lap_number) FROM latest_standings) AS latest_standing_lap,
            (SELECT participant_id FROM latest_standings WHERE position = 1 FETCH FIRST 1 ROW ONLY) AS latest_observed_leader_participant_id,
            (SELECT external_participant_number FROM latest_standings WHERE position = 1 FETCH FIRST 1 ROW ONLY) AS latest_observed_leader_external_participant_number,
            (SELECT MAX(gap_first_seconds) FROM latest_standings) AS latest_field_spread_seconds,
            (SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY WHERE session_id = :session_id) AS position_sample_count,
            (SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY WHERE session_id = :session_id AND position_source = 'GPS_CORRECTED') AS gps_corrected_sample_count,
            (SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY WHERE session_id = :session_id AND position_source = 'RGPS_RAW') AS rgps_raw_sample_count,
            (SELECT COUNT(*) FROM V_EVENT_TRACK_REPLAY WHERE session_id = :session_id AND source_entity_id = 'SC') AS sc_source_sample_count,
            (SELECT MIN(observed_at) FROM V_EVENT_TRACK_REPLAY WHERE session_id = :session_id) AS position_first_observed_at,
            (SELECT MAX(observed_at) FROM V_EVENT_TRACK_REPLAY WHERE session_id = :session_id) AS position_last_observed_at
        FROM dual
    """
    rows = request.app.state.database.fetch_all(sql, {"session_id": session_id})
    return event_row_response(rows[0]) if rows else {"sessionId": session_id}


def _geometry_distance_meters(left: dict, right: dict) -> float:
    from math import atan2, cos, radians, sin, sqrt
    latitude = radians(float(right["latitude"]) - float(left["latitude"]))
    longitude = radians(float(right["longitude"]) - float(left["longitude"]))
    first = radians(float(left["latitude"]))
    second = radians(float(right["latitude"]))
    a = sin(latitude / 2) ** 2 + cos(first) * cos(second) * sin(longitude / 2) ** 2
    return 6371000 * 2 * atan2(sqrt(a), sqrt(1 - a))


def _utc_event_time(value: Optional[datetime]) -> Optional[datetime]:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _adaptive_replay_resolution_seconds(from_time: Optional[datetime], to_time: Optional[datetime]) -> int:
    """One factual sample per source entity/bucket, sized for a <=5k-row replay."""
    if from_time is None or to_time is None:
        return 1
    duration_seconds = max(1, (to_time - from_time).total_seconds())
    if duration_seconds <= 60:
        return 1
    if duration_seconds <= 300:
        return 3
    return 10


@router.get("/sessions/{session_id}/track-geometry", response_model=EventTrackGeometry)
def track_geometry(session_id: str, request: Request):
    """Stable, compact GPS reference from one high-coverage participant trajectory."""
    _require_session(request, session_id)
    candidate_sql = """
        SELECT source_entity_id
        FROM V_EVENT_TRACK_REPLAY
        WHERE session_id = :session_id
          AND position_source = 'GPS_CORRECTED'
          AND source_entity_id <> 'SC'
          AND participant_id IS NOT NULL
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND (is_no_gps = 0 OR is_no_gps IS NULL)
        GROUP BY source_entity_id
        ORDER BY COUNT(*) DESC, source_entity_id ASC
        FETCH FIRST 1 ROW ONLY
    """
    candidates = request.app.state.database.fetch_all(candidate_sql, {"session_id": session_id})
    if not candidates:
        return {"sourceEntityId": None, "points": []}
    # Database.fetch_all() applies the shared Oracle-to-API camelCase row contract.
    entity = candidates[0]["sourceEntityId"]
    rows = request.app.state.database.fetch_all(
        """
        SELECT latitude, longitude, observed_at
        FROM V_EVENT_TRACK_REPLAY
        WHERE session_id = :session_id
          AND position_source = 'GPS_CORRECTED'
          AND source_entity_id = :source_entity_id
          AND latitude IS NOT NULL
          AND longitude IS NOT NULL
          AND (is_no_gps = 0 OR is_no_gps IS NULL)
        ORDER BY observed_at
        """,
        {"session_id": session_id, "source_entity_id": entity},
    )
    segments: list[list[dict]] = []
    segment: list[dict] = []
    previous: Optional[dict] = None
    for row in rows:
        if previous is None or _geometry_distance_meters(previous, row) <= 85:
            segment.append(row)
        else:
            if segment:
                segments.append(segment)
            segment = [row]
        previous = row
    if segment:
        segments.append(segment)
    # Do not reconnect across a GPS discontinuity: use the best continuous source segment.
    continuous = max(segments, key=len, default=[])
    # A few hundred chronological points are sufficient for a stable display reference.
    stride = max(1, len(continuous) // 360)
    points = continuous[::stride][:400]
    return event_row_response({
        "sourceEntityId": entity,
        "pointCount": len(points),
        "observedFrom": rows[0]["observedAt"] if rows else None,
        "observedTo": rows[-1]["observedAt"] if rows else None,
        "points": [{"latitude": row["latitude"], "longitude": row["longitude"]} for row in points],
    })


@router.get("/sessions/{session_id}/track-replay", response_model=list[EventTrackReplay])
def track_replay(
    session_id: str, request: Request, from_time: Optional[datetime] = None, to_time: Optional[datetime] = None,
    participant_id: Optional[str] = None, source_entity_id: Optional[str] = None,
    position_source: str = "GPS_CORRECTED", resolution_seconds: Optional[int] = None, limit: int = 5000,
):
    _require_session(request, session_id)
    if position_source not in {"GPS_CORRECTED", "RGPS_RAW"}:
        raise HTTPException(status_code=422, detail="position_source must be GPS_CORRECTED or RGPS_RAW.")
    from_time, to_time = _utc_event_time(from_time), _utc_event_time(to_time)
    limit = max(1, min(limit, 5000))
    resolution_seconds = max(1, min(resolution_seconds or _adaptive_replay_resolution_seconds(from_time, to_time), 60))
    filters, params = [], {
        "session_id": session_id, "position_source": position_source, "from_time": from_time,
        "to_time": to_time, "resolution_seconds": resolution_seconds, "limit": limit,
    }
    if participant_id: filters.append("feed.participant_id = :participant_id"); params["participant_id"] = participant_id
    if source_entity_id: filters.append("feed.source_entity_id = :source_entity_id"); params["source_entity_id"] = source_entity_id
    requested_start = "CASE WHEN :from_time IS NULL OR :from_time < bounds.first_observed_at THEN bounds.first_observed_at ELSE :from_time END"
    requested_end = "CASE WHEN :to_time IS NULL OR :to_time > bounds.last_observed_at THEN bounds.last_observed_at ELSE :to_time END"
    if from_time is None and to_time is None:
        requested_start = "GREATEST(bounds.first_observed_at, bounds.last_observed_at - NUMTODSINTERVAL(60, 'SECOND'))"
        requested_end = "bounds.last_observed_at"
    optional_filters = (" AND " + " AND ".join(filters)) if filters else ""
    sql = f"""
        WITH bounds AS (
            SELECT MIN(observed_at) AS first_observed_at, MAX(observed_at) AS last_observed_at
            FROM V_EVENT_TRACK_REPLAY
            WHERE session_id = :session_id AND position_source = :position_source
        ), bounded_rows AS (
            SELECT feed.*
            FROM V_EVENT_TRACK_REPLAY feed CROSS JOIN bounds
            WHERE feed.session_id = :session_id
              AND feed.position_source = :position_source
              AND feed.observed_at >= {requested_start}
              AND feed.observed_at <= {requested_end}{optional_filters}
        ), sampled_rows AS (
            SELECT bounded_rows.*,
                   ROW_NUMBER() OVER (
                       PARTITION BY source_entity_id,
                         FLOOR((CAST(observed_at AS DATE) - DATE '1970-01-01') * 86400 / :resolution_seconds)
                       ORDER BY observed_at DESC NULLS LAST, sample_id ASC
                   ) AS sample_rank
            FROM bounded_rows
        )
        SELECT * FROM sampled_rows
        WHERE sample_rank = 1
        ORDER BY observed_at, source_entity_id
        FETCH FIRST :limit ROWS ONLY
    """
    return [event_row_response(row) for row in request.app.state.database.fetch_all(sql, params)]
