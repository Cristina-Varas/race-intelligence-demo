"""Transport-neutral normalized events for the AKS operational hot path.

This module deliberately knows nothing about FastAPI, React, AIDP or a broker.
The in-process bus is a small development/event-day implementation; a Kafka or
OCI Streaming adapter can use the exact serialized ``NormalizedEvent`` contract.
"""
from __future__ import annotations

from collections import defaultdict, deque
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
import time
from typing import Any, Callable, Optional, Protocol, Union
from .source_epoch import SourceEpochs


def _iso(value: Optional[Union[datetime, str]]) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, str):
        return value
    return value.astimezone(timezone.utc).isoformat()


@dataclass(frozen=True)
class NormalizedEvent:
    event_id: str
    session_id: str
    event_type: str
    participant_id: str | None
    external_participant_number: str | None
    observed_at: str | None
    recorded_at: str
    source: str
    source_channel: str
    operational_context: str
    evidence_domain: str
    event_contract_version: str
    sequence: int
    connection_id: int
    payload: dict[str, Any]
    processing_times: dict[str, float] = field(default_factory=dict)
    source_epoch: int = 1
    source_process_id: str | None = None
    source_boundary: str | None = None

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, value: dict[str, Any]) -> "NormalizedEvent":
        return cls(**value)

    def wire_bytes(self) -> bytes:
        return json.dumps(self.to_dict(), sort_keys=True, separators=(",", ":")).encode("utf-8")


class NormalizedEventConsumer(Protocol):
    def consume(self, event: NormalizedEvent) -> None: ...


class NormalizedEventPublisher(Protocol):
    def publish(self, event: NormalizedEvent) -> None: ...


class InProcessEventBus:
    """Ordered, bounded, isolated consumer delivery.

    Non-position events are never discarded: if a consumer's bounded queue is
    full, delivery is recorded as an error instead of silently losing evidence.
    Position updates are render-only state updates and may coalesce to the most
    recent update for a consumer after the raw frame is already durable.
    """

    def __init__(self, max_queue_size: int = 512):
        self.max_queue_size = max_queue_size
        self._subscribers: list[NormalizedEventConsumer] = []
        self._queues: dict[int, deque[NormalizedEvent]] = {}
        self.consumer_errors: deque[str] = deque(maxlen=100)
        self.events_published = 0
        self.events_coalesced = 0
        self.events_rejected = 0
        self.source_epochs = SourceEpochs()

    def subscribe(self, consumer: NormalizedEventConsumer) -> None:
        self._subscribers.append(consumer)
        self._queues[id(consumer)] = deque()

    def publish(self, event: NormalizedEvent) -> None:
        with self.source_epochs.lock:
            self._publish(self.prepare_event(event))

    def prepare_event(self, event: NormalizedEvent) -> NormalizedEvent:
        return self.source_epochs.tag(event)

    def _publish(self, event: NormalizedEvent) -> None:
        event.processing_times["eventPublishedAt"] = time.perf_counter()
        self.events_published += 1
        for consumer in tuple(self._subscribers):
            queue = self._queues[id(consumer)]
            if len(queue) >= self.max_queue_size:
                if event.event_type == "POSITION_UPDATE":
                    for index in range(len(queue) - 1, -1, -1):
                        queued = queue[index]
                        if queued.event_type == "POSITION_UPDATE" and queued.session_id == event.session_id:
                            del queue[index]
                            self.events_coalesced += 1
                            break
                    else:
                        self.events_rejected += 1
                        self.consumer_errors.append("POSITION_QUEUE_FULL")
                        continue
                else:
                    self.events_rejected += 1
                    self.consumer_errors.append(f"QUEUE_FULL:{event.event_type}")
                    continue
            queue.append(event)
            self._drain(consumer, queue)

    def _drain(self, consumer: NormalizedEventConsumer, queue: deque[NormalizedEvent]) -> None:
        while queue:
            current = queue.popleft()
            try:
                consumer.consume(current)
            except Exception as exc:  # isolate optional consumers from ingestion
                self.consumer_errors.append(f"{type(consumer).__name__}:{type(exc).__name__}")


class OperationalMetricsConsumer:
    def __init__(self):
        self.events_received = 0
        self.events_published = 0
        self.normalization_errors = 0
        self.consumer_errors = 0
        self.latest_event_timestamp: str | None = None
        self.processing_latency_ms: deque[float] = deque(maxlen=10000)
        self.segments = defaultdict(lambda: deque(maxlen=10000))
        self.started = time.perf_counter()
        self.websocket_messages = 0
        self.gps_publications = 0

    def measure(self, times: dict[str, float]) -> None:
        names = ["rawPersistedAt", "normalizedAt", "eventPublishedAt", "liveStateUpdatedAt", "websocketEmittedAt"]
        for left, right in zip(names, names[1:]):
            if left in times and right in times:
                self.segments[f"{left}->{right}"].append(max(0, (times[right] - times[left]) * 1000))

    def consume(self, event: NormalizedEvent) -> None:
        self.events_published += 1
        self.latest_event_timestamp = event.recorded_at
        self.measure(event.processing_times)

    def snapshot(self) -> dict[str, Any]:
        values = sorted(self.processing_latency_ms)
        def p(percent: float) -> float | None:
            return values[round((len(values) - 1) * percent)] if values else None
        def distribution(samples):
            ordered = sorted(samples)
            return {key: ordered[round((len(ordered)-1)*fraction)] if ordered else None
                    for key, fraction in [("p50", .5), ("p95", .95), ("p99", .99), ("max", 1)]}
        elapsed = max(.001, time.perf_counter() - self.started)
        return {"eventsReceived": self.events_received, "eventsPublished": self.events_published,
                "elapsedSeconds": elapsed, "rawPerSecond": self.events_received / elapsed,
                "normalizedPerSecond": self.events_published / elapsed,
                "websocketMessages": self.websocket_messages, "websocketPerSecond": self.websocket_messages / elapsed,
                "gpsPublications": self.gps_publications, "gpsPublicationsPerSecond": self.gps_publications / elapsed,
                "internalLatencyMs": {key: distribution(value) for key, value in self.segments.items()},
                "normalizationErrors": self.normalization_errors, "consumerErrors": self.consumer_errors,
                "latestEventTimestamp": self.latest_event_timestamp,
                "processingLatencyMs": {"p50": p(.5), "p95": p(.95), "p99": p(.99)}}


class EventMomentCandidateConsumer:
    """Safe live candidates only; never creates a physical-pass or final-result claim."""
    def __init__(self):
        self._previous: dict[tuple[str, str], dict[str, Any]] = {}
        self._leaders = {}
        self._epochs = {}
        self._sequences = {}
        self.candidates: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=100))

    def consume(self, event: NormalizedEvent) -> None:
        if event.sequence <= self._sequences.get(event.session_id,-1): return
        self._sequences[event.session_id] = event.sequence
        epoch = getattr(event, 'source_epoch', 1)
        if self._epochs.get(event.session_id) != epoch:
            self._epochs[event.session_id] = epoch
            self._previous = {key:value for key,value in self._previous.items() if key[0] != event.session_id}
            self._leaders.pop(event.session_id, None)
            self.candidates[event.session_id].clear()
        if event.event_type != "STANDINGS_UPDATE": return
        leader = next((r.get("participantId") for r in event.payload.get("rows", []) if r.get("position") == 1), None)
        old_leader = self._leaders.get(event.session_id)
        for row in event.payload.get("rows", []):
            participant = row.get("participantId")
            if not participant: continue
            key=(event.session_id, participant); previous=self._previous.get(key)
            if previous:
                if row.get("position") is not None and previous.get("position") is not None and row["position"] != previous["position"]:
                    self._add(event, "POSITION_CHANGE", participant, previous.get("position"), row.get("position"), "positions")
                if row.get("gapFirstSeconds") is not None and previous.get("gapFirstSeconds") is not None and row["gapFirstSeconds"] != previous["gapFirstSeconds"]:
                    self._add(event, "GAP_CHANGE", participant, previous.get("gapFirstSeconds"), row.get("gapFirstSeconds"), "seconds")
            self._previous[key]=dict(row)
        if old_leader and leader and old_leader != leader:
            self._add(event, "LEADER_CHANGE", leader, old_leader, leader, "participant")
        if leader: self._leaders[event.session_id] = leader

    def _add(self, event: NormalizedEvent, kind: str, participant: str, previous: Any, current: Any, unit: str) -> None:
        self.candidates[event.session_id].append({"sourceEpoch":getattr(event,'source_epoch',1),"candidateId":f"{event.event_id}:{event.observed_at}:{getattr(event,'source_epoch',1)}:{kind}:{participant}","eventId":event.event_id,"momentType":kind,"participantId":participant,"previous":previous,"current":current,
            "unit":unit,"observedAt":event.observed_at,"recordedAt":event.recorded_at,"source":"AKS","evidenceDomain":"FACTUAL_OBSERVATION"})
