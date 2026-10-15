"""Read-only card projection from the existing normalized AKS event stream."""
from __future__ import annotations

import math
import os
import re
from typing import Any

from ..integrations.aks.live_events import NormalizedEvent


def configured_target() -> str | None:
    value = os.getenv('TARGET_KART_NUMBER', '').strip()
    if not value:
        return None
    if not re.fullmatch(r'[0-9]{1,6}', value):
        raise ValueError('TARGET_KART_NUMBER must be a numeric kart number.')
    return value


def eligible_challengers(karts: list[str], target: str | None) -> list[str]:
    return [kart for kart in karts if kart != target and kart.upper() != 'SC']


class CardEvidenceProjection:
    """One observed stint; a closed-to-running reset ends this capture window.

    The start gate requires an observed stationary pre-start state followed by
    a running state with a source start timestamp, before any completed laps.
    A first packet already reporting running never opens this gate.
    """
    def __init__(self, manage_source_boundaries=True):
        self.manage_source_boundaries = manage_source_boundaries
        self.records: dict[str, dict[str, Any]] = {}
        self.laps: dict[str, dict[int, dict[str, Any]]] = {}
        self.previous_status: dict[str, Any] | None = None
        self.governed_start: Any = None
        self.finished_observed = False
        self.closed_observed = False
        self.reset_observed = False

    def publish(self, event: NormalizedEvent) -> None:
        if self.reset_observed:
            return
        if event.source_channel == 'timing.session.status':
            state = event.payload
            if self.manage_source_boundaries and self.closed_observed and state.get('isClosed') is False and state.get('isFinished') is False:
                self.reset_observed = True
                return
            prior = self.previous_status
            if (prior and prior.get('isSessionRunning') is False and prior.get('isFinished') is False
                    and prior.get('isClosed') is False and prior.get('elapsedLaps') == 0
                    and state.get('isSessionRunning') is True and state.get('isFinished') is False
                    and state.get('isClosed') is False and state.get('elapsedLaps') == 0
                    and isinstance(state.get('sessionStartTime'), (int, float))
                    and state['sessionStartTime'] > 0):
                self.governed_start = state['sessionStartTime']
            self.previous_status = dict(state)
            self.finished_observed |= state.get('isFinished') is True
            self.closed_observed |= state.get('isClosed') is True
        if event.event_type == 'STANDINGS_UPDATE':
            snapshot = event.payload.get('rows', [])
            # A reset snapshot can precede its status frame. Do not let the
            # zero-lap next-stint grid replace the completed stint's evidence.
            if self.manage_source_boundaries and self.closed_observed and snapshot and all(row.get('lapNumber') == 0 for row in snapshot):
                self.reset_observed = True
                return
            for row in event.payload.get('rows', []):
                kart, participant, position = row.get('externalParticipantNumber'), row.get('participantId'), row.get('position')
                if not kart or kart.upper() == 'SC' or not participant or not isinstance(position, int) or position < 1:
                    continue
                record = self.records.setdefault(kart, {
                    'participantId': participant, 'kartNo': int(kart) if kart.isdigit() else kart,
                    'firstObservedPosition': position, 'peakPosition': position, 'startPosition': None,
                    'latestObservedPosition': position, 'latestObservedAt': event.observed_at,
                })
                if self.governed_start is not None and record['startPosition'] is None:
                    record['startPosition'] = position
                record.update(peakPosition=min(record['peakPosition'], position), latestObservedPosition=position,
                              latestObservedAt=event.observed_at, observedLap=row.get('lapNumber'),
                              gapToLeaderSeconds=row.get('gapFirstSeconds'), intervalSeconds=row.get('gapPreviousSeconds'))
        if event.event_type == 'LAP_UPDATE':
            # LAP_UPDATE already flattens participant -> laps -> lap and converts
            # AKS milliseconds. Replace corrections by stable participant/lap ID.
            for row in event.payload.get('rows', []):
                kart, lap = row.get('externalParticipantNumber'), row.get('lapNumber')
                if not kart or kart.upper() == 'SC' or not isinstance(lap, int) or lap <= 0:
                    continue
                self.laps.setdefault(kart, {})[lap] = {
                    'time': row.get('lapTimeSeconds'), 'valid': row.get('lapValid') is True,
                    'observedAt': event.observed_at,
                }

    def result(self) -> dict[str, dict[str, Any]]:
        for kart, record in self.records.items():
            valid = [(lap, row) for lap, row in self.laps.get(kart, {}).items()
                     if row['valid'] and isinstance(row['time'], (int, float)) and math.isfinite(row['time']) and row['time'] > 0]
            best = min(valid, key=lambda pair: (pair[1]['time'], pair[0])) if valid else None
            record.update(latestCompletedLap=max((lap for lap, _ in valid), default=None),
                          bestLapSeconds=best[1]['time'] if best else None,
                          bestLapNumber=best[0] if best else None,
                          bestLapObservedAt=best[1]['observedAt'] if best else None,
                          finishedStateObserved=self.finished_observed, resetBoundaryObserved=self.reset_observed)
        return self.records
