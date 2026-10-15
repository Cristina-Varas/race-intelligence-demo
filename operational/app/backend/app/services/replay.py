"""Read-only historical timing anchors for client-side Track Replay V1."""
from __future__ import annotations

from pathlib import Path
import json
from typing import Any


PROJECT_ROOT = Path(__file__).resolve().parents[4]
ANCHORS_PATH = PROJECT_ROOT / "data" / "track" / "derived" / "historical_replay_anchors.json"


def load_historical_replay() -> dict[str, Any]:
    if not ANCHORS_PATH.exists():
        raise FileNotFoundError(f"Historical replay anchors are unavailable at {ANCHORS_PATH}.")
    return json.loads(ANCHORS_PATH.read_text(encoding="utf-8"))


def historical_replay_metadata() -> dict[str, Any]:
    metadata = load_historical_replay()["metadata"]
    return {
        "supportedDriverIds": metadata["supportedDriverIds"],
        "supportedDriverCount": metadata["supportedDriverCount"],
        "raceLaps": metadata["raceLaps"],
        "raceDurationSeconds": metadata["raceDurationSeconds"],
        "reconstructionMethod": "lap_interpolation",
        "trackLengthMeters": metadata["trackLengthMeters"],
        "gpsTelemetry": False,
        "trackOrigin": "geometry_source_origin",
        "sourceSession": metadata["sourceSession"],
    }


def historical_replay_response() -> dict[str, Any]:
    replay = load_historical_replay()
    return {"metadata": historical_replay_metadata(), "drivers": replay["drivers"]}
