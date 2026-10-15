"""AKS protocol/state adapter for the transport-neutral operational hot path."""
from __future__ import annotations

from datetime import datetime, timezone
import hashlib
import time
from contextlib import nullcontext
from dataclasses import replace
from typing import Any, Callable, Optional

from .client import AksTimingClient
from .live_events import NormalizedEvent, NormalizedEventPublisher
from .normalizer import AksIdentityMapper
from .protocol import parse_json_payload


def _utc(value: Optional[datetime] = None) -> str:
    return (value or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat()


class AksLiveIngestAdapter:
    """Raw-first AKS frame -> reconstructed state -> normalized event(s).

    ``persist_raw`` is deliberately injected and called before parsing. A write
    exception prevents parser, state and publisher activity.
    """
    def __init__(self, *, session_id: str, client: AksTimingClient, publisher: NormalizedEventPublisher,
                 persist_raw: Callable[[bytes | str], None], identity_mapper: AksIdentityMapper | None = None,
                 operational_context: str = "REHEARSAL"):
        self.session_id, self.client, self.publisher, self.persist_raw = session_id, client, publisher, persist_raw
        self.identity_mapper, self.operational_context = identity_mapper or AksIdentityMapper(), operational_context
        self.sequence = 0
        self.connection_id = 0
        self._raw_persisted_at = 0.0
        self._lifecycle: dict[str, Any] = {}

    def connection_state(self, status: str, *, reconnect_count: int = 0) -> None:
        stamp = _utc()
        if status == "CONNECTED":
            self.connection_id += 1
            self._lifecycle["connectedAt"] = stamp
            if self.connection_id > 1: self._lifecycle["reconnectedAt"] = stamp
        if status in {"RECONNECTING", "DISCONNECTED"}:
            self._lifecycle["disconnectedAt"] = stamp
        if status == "RECONNECTING": self._lifecycle["reconnectStartedAt"] = stamp
        if status == "SUBSCRIPTIONS_RESTORED": self._lifecycle["subscriptionsRestoredAt"] = stamp
        self.publisher.publish(self._publish("CONNECTION_STATE", "connection", {
            **self._lifecycle, "status": "CONNECTED" if status == "SUBSCRIPTIONS_RESTORED" else status,
            "connectionId": self.connection_id, "reconnectCount": reconnect_count}, None))

    def process_line(self, line: bytes | str, *, recorded_at: Optional[datetime] = None) -> list[NormalizedEvent]:
        self.persist_raw(line)  # mandatory durability boundary
        self._raw_persisted_at = time.perf_counter()
        packet = self.client.handle_line(line)
        if not packet or packet.command != "JSON": return []
        try: payload = parse_json_payload(packet)
        except Exception: return []
        if not isinstance(payload, dict): return []
        output: list[NormalizedEvent] = []
        epochs = getattr(self.publisher, 'source_epochs', None)
        # Identity/status must precede data in a combined root frame. Epoch
        # detection belongs to the bus, not to this transport adapter.
        channels = self._changed_channels(payload, packet.channel)
        channels.sort(key=lambda c: 0 if c == 'timing.session.info' else 1 if c == 'timing.session.status' else 2)
        with epochs.lock if epochs else nullcontext():
            for channel in channels:
                event = self._event_for_channel(channel, recorded_at)
                if event:
                    if epochs:
                        event = self.publisher.prepare_event(event)
                        if event.source_boundary:
                            # This adapter owns its reconstruction cache, not the
                            # transport or recorder. Reapply only this raw frame;
                            # old cumulative lap/standing/GPS trees cannot leak.
                            for root in ('timing','gps','rgps'):
                                self.client.state_store.reset_channel(root)
                            kwargs = dict(message_id=packet.message_id,received_at=event.recorded_at,raw_payload=packet.data)
                            if packet.channel:
                                self.client.state_store.apply_channel(packet.channel,payload,**kwargs)
                            else:
                                self.client.state_store.apply_root_delta(payload,**kwargs)
                            fresh = self._event_for_channel(channel,recorded_at)
                            if fresh: event = replace(event,payload=fresh.payload)
                    self.publisher.publish(event); output.append(event)
        return output

    def _changed_channels(self, payload: dict[str, Any], packet_channel: Optional[str]) -> list[str]:
        if packet_channel: return [packet_channel]
        result: list[str] = []
        def visit(value: Any, prefix: str = ""):
            if not isinstance(value, dict): return
            for key, item in value.items():
                path = f"{prefix}.{key}" if prefix else str(key)
                if path in {"gps", "rgps", "raceControl", "weather", "timing.session.info", "timing.session.entry", "timing.session.status", "timing.session.standings.overall.active", "timing.session.standings.overall.finishLine", "timing.session.standings.overall.participantDetails", "timing.analysis.laps", "timing.liveEvents.fl"}: result.append(path)
                visit(item, path)
        visit(payload)
        return list(dict.fromkeys(result))

    def _path(self, path: str) -> Any:
        # Copy only the reconstructed channel, not the complete high-rate
        # GPS/timing tree for every incoming delta.
        return self.client.state_store.get_path(path)

    def _participant(self, value: Any) -> tuple[Optional[str], Optional[str]]:
        if value is None: return None, None
        number = str(value); identity = self.identity_mapper.map(number)
        return identity.participant_id or f"AKS_{number}", number

    def _rows(self, value: Any, *, position_source: Optional[str] = None) -> list[dict[str, Any]]:
        output=[]
        if not isinstance(value, dict): return output
        for key, raw in value.items():
            if not isinstance(raw, dict): continue
            if key == "SC":
                participant, external = None, None
            else:
                participant, external = self._participant(raw.get("participant", key))
            row={"participantId": participant, "externalParticipantNumber": external}
            if position_source:
                row.update({"sourceEntityId": str(key), "positionSource": position_source,
                            "latitude": raw.get("lat"), "longitude": raw.get("lon"), "rawStatusBits": raw.get("status")})
            else:
                row.update({"position": raw.get("position"), "lapNumber": raw.get("lapNumber"),
                            "elapsedTimeSeconds": self._seconds(raw.get("elapsedTime")),
                            "gapFirstSeconds": self._seconds(raw.get("gapFirstTime")),
                            "gapPreviousSeconds": self._seconds(raw.get("gapPreviousTime")), "status": raw.get("status"),
                            "positionChange": raw.get("positionChange"), "atLoop": raw.get("atLoop")})
            output.append({k:v for k,v in row.items() if k not in {"displayName", "name", "driver"}})
        return output

    @staticmethod
    def _seconds(value: Any) -> Optional[float]:
        try: return float(value) / 1000 if value is not None else None
        except (TypeError, ValueError): return None

    def _event_for_channel(self, channel: str, recorded_at: Optional[datetime]) -> Optional[NormalizedEvent]:
        value = self._path(channel)
        if value is None: return None
        if channel == "timing.session.status": return self._publish("SESSION_STATE", channel, dict(value) if isinstance(value, dict) else {}, recorded_at)
        if channel == "timing.session.info": return self._publish("SESSION_STATE", channel, {k:v for k,v in (value.items() if isinstance(value, dict) else []) if k in {"id", "laps", "duration", "type"}}, recorded_at)
        if channel == "timing.session.entry": return self._publish("PARTICIPANT_UPDATE", channel, {"rows": self._rows(value)}, recorded_at)
        if channel.endswith("overall.active"): return self._publish("STANDINGS_UPDATE", channel, {"rows": self._rows(value)}, recorded_at)
        if channel.endswith("overall.finishLine"): return self._publish("FINISH_LINE_UPDATE", channel, {"rows": self._rows(value)}, recorded_at)
        if channel.endswith("participantDetails"): return self._publish("PARTICIPANT_UPDATE", channel, {"rows": self._rows(value)}, recorded_at)
        if channel == "gps": return self._publish("POSITION_UPDATE", channel, {"positionSource":"GPS_CORRECTED", "rows":self._rows(value, position_source="GPS_CORRECTED")}, recorded_at)
        if channel == "rgps": return self._publish("POSITION_UPDATE", channel, {"positionSource":"RGPS_RAW", "rows":self._rows(value, position_source="RGPS_RAW")}, recorded_at)
        if channel == "raceControl": return self._publish("RACE_CONTROL_UPDATE", channel, dict(value) if isinstance(value,dict) else {}, recorded_at)
        if channel == "weather": return self._publish("WEATHER_UPDATE", channel, dict(value) if isinstance(value,dict) else {}, recorded_at)
        if channel == "timing.analysis.laps":
            rows=[]
            if isinstance(value,dict):
                for entity in value.values():
                    if not isinstance(entity,dict): continue
                    participant, external=self._participant(entity.get("participant"))
                    for lap in (entity.get("laps") or {}).values():
                        if isinstance(lap,dict): rows.append({"participantId":participant,"externalParticipantNumber":external,"lapNumber":lap.get("lapNum"),"lapTimeSeconds":self._seconds(lap.get("time")),"lapValid":lap.get("isValid"),"position":lap.get("position"),"sectors":lap.get("sectors"),"loopSectors":lap.get("loopSectors")})
            return self._publish("LAP_UPDATE", channel, {"rows":rows}, recorded_at)
        if channel == "timing.liveEvents.fl":
            participant, external=self._participant(value.get("participant") if isinstance(value,dict) else None)
            payload={"participantId":participant,"externalParticipantNumber":external,"lapNumber":value.get("lapNumber"),"elapsedTimeSeconds":self._seconds(value.get("elapsedTime")),"lapTimeSeconds":self._seconds(value.get("lapTime")),"lapTimeValid":value.get("lapTimeValid"),"isPit":value.get("isPit"),"dayTime":value.get("dayTime")} if isinstance(value,dict) else {}
            return self._publish("LIVE_EVENT_UPDATE", channel, payload, recorded_at, participant, external)
        return None

    def _publish(self, event_type: str, channel: str, payload: dict[str, Any], recorded_at: Optional[datetime],
                 participant_id: Optional[str] = None, external: Optional[str] = None) -> NormalizedEvent:
        self.sequence += 1; stamp=_utc(recorded_at)
        event_id=hashlib.sha256(f"{self.session_id}:{self.connection_id}:{self.sequence}:{channel}".encode()).hexdigest()[:32]
        timings = {"normalizedAt": time.perf_counter()}
        if channel != "connection": timings["rawPersistedAt"] = self._raw_persisted_at
        return NormalizedEvent(event_id, self.session_id, event_type, participant_id, external, stamp, stamp, "AKS", channel,
                               self.operational_context, "FACTUAL_OBSERVATION", "1.0", self.sequence, self.connection_id, payload, timings)
