"""Differential JSON state reconstruction for AKS snapshot-plus-delta channels."""
from __future__ import annotations

from copy import deepcopy
from threading import RLock
from typing import Any


def merge_delta(existing: dict[str, Any], delta: dict[str, Any]) -> dict[str, Any]:
    """Merge AKS changes recursively; null explicitly deletes the target key."""
    result = deepcopy(existing)
    for key, value in delta.items():
        if value is None:
            result.pop(key, None)
        elif isinstance(value, dict):
            child = result.get(key)
            result[key] = merge_delta(child if isinstance(child, dict) else {}, value)
        else:
            result[key] = deepcopy(value)
    return result


def _merge_delta_in_place(existing: dict[str, Any], delta: dict[str, Any]) -> None:
    """Apply a delta without repeatedly copying the full live state tree."""
    for key, value in delta.items():
        if value is None:
            existing.pop(key, None)
        elif isinstance(value, dict):
            child = existing.get(key)
            if not isinstance(child, dict):
                child = {}
                existing[key] = child
            _merge_delta_in_place(child, value)
        else:
            existing[key] = deepcopy(value)


class AksStateStore:
    def __init__(self):
        self._state: dict[str, Any] = {}
        self._metadata: dict[str, dict[str, Any]] = {}
        self._lock = RLock()

    def apply_channel(self, channel: str, delta: Any, *, message_id: str, received_at: str, raw_payload: str) -> None:
        with self._lock:
            if delta is None:
                self._state.pop(channel, None)
                self._metadata.pop(channel, None)
                return
            existing = self._state.get(channel)
            if isinstance(delta, dict):
                if not isinstance(existing, dict):
                    existing = {}
                    self._state[channel] = existing
                _merge_delta_in_place(existing, delta)
            else:
                self._state[channel] = deepcopy(delta)
            self._metadata[channel] = {"message_id": message_id, "received_at": received_at, "raw_payload": raw_payload}

    def apply_root_delta(self, delta: dict[str, Any], *, message_id: str, received_at: str, raw_payload: str) -> None:
        with self._lock:
            # Root AKS messages normally update one top-level channel (GPS,
            # timing, weather, ...).  Merging the whole state for each
            # high-frequency GPS delta needlessly copies unrelated channels and
            # makes recorded replay quadratic.  Merge each declared root key
            # independently while retaining the same null-delete semantics.
            for channel, value in delta.items():
                if value is None:
                    self._state.pop(channel, None)
                elif isinstance(value, dict):
                    existing = self._state.get(channel)
                    if not isinstance(existing, dict):
                        existing = {}
                        self._state[channel] = existing
                    _merge_delta_in_place(existing, value)
                else:
                    self._state[channel] = deepcopy(value)
            for channel in delta:
                if channel in self._state:
                    self._metadata[channel] = {"message_id": message_id, "received_at": received_at, "raw_payload": raw_payload}
                else:
                    self._metadata.pop(channel, None)

    def reset_channel(self, channel: str) -> None:
        with self._lock:
            self._state.pop(channel, None)
            self._metadata.pop(channel, None)

    def get_state(self) -> dict[str, Any]:
        with self._lock:
            return deepcopy(self._state)

    def get_channel(self, channel: str) -> Any:
        with self._lock:
            return deepcopy(self._state.get(channel))

    def get_path(self, path: str) -> Any:
        with self._lock:
            value: Any = self._state
            for part in path.split("."):
                if not isinstance(value, dict) or part not in value:
                    return None
                value = value[part]
            return deepcopy(value)

    def get_metadata(self, channel: str) -> dict[str, Any] | None:
        with self._lock:
            return deepcopy(self._metadata.get(channel))
