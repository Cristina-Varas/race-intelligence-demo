"""Replay recorded raw evidence through the same live adapter used by AKS."""
from __future__ import annotations

import asyncio
from pathlib import Path

from .live_adapter import AksLiveIngestAdapter
from .recording import AksRecordingLoader
from .protocol import CRLF


async def replay_recording(path: str | Path, adapter: AksLiveIngestAdapter, *, speed: float = 1.0) -> int:
    if speed not in {1.0, 5.0, 30.0}:
        raise ValueError("speed must be 1, 5, or 30.")
    first = None; published = 0
    started = asyncio.get_running_loop().time()
    adapter.connection_state("CONNECTED")
    for record in AksRecordingLoader(path).iter_messages():
        if first is None: first = record.recorded_at
        # Absolute replay clock: processing/fsync time must not accumulate as
        # additional delay between every pair of frames. Late frames are never dropped.
        target = started + (record.recorded_at - first).total_seconds() / speed
        await asyncio.sleep(max(0.0, target - asyncio.get_running_loop().time()))
        # JSONL envelopes retain the protocol line without its wire terminator.
        # Reconstruct framing for the same parser used by live transport.
        line = record.raw_payload if record.raw_payload.endswith(CRLF) else record.raw_payload + CRLF
        published += len(adapter.process_line(line, recorded_at=record.recorded_at))
    return published
