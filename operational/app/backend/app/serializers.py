"""Pure response conversion helpers, independently testable without FastAPI."""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from .db import json_safe


def interpret_delay(delay_seconds: float | None) -> str:
    if delay_seconds is None:
        return "Threshold is unavailable."
    if delay_seconds > 0:
        return "Positive delay: Virtual Max can start later."
    if delay_seconds < 0:
        return "Negative delay: Virtual Max requires a head start."
    return "Zero delay: Virtual Max starts simultaneously."


def scenario_summary_response(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "supportedFieldSize": int(row["supportedFieldSize"]),
        "raceLaps": int(row["raceLaps"]),
        "simulations": int(row["simulations"]),
        "deterministicMaxDelaySeconds": float(row["deterministicMaxDelaySeconds"]),
        "probabilityAtZeroDelay": float(row["probabilityAtZeroDelay"]),
        "thresholds": {
            "p50": json_safe(row.get("p50", row.get("delay50Pct"))),
            "p80": json_safe(row.get("p80", row.get("delay80Pct"))),
            "p90": json_safe(row.get("p90", row.get("delay90Pct"))),
        },
    }


def row_response(row: dict[str, Any]) -> dict[str, Any]:
    return {key: json_safe(value) for key, value in row.items()}


def event_row_response(row: dict[str, Any]) -> dict[str, Any]:
    """Serialize Event recorder timestamps as explicit UTC at the API boundary.

    Autonomous TIMESTAMP columns are offset-free. Event Contract timestamps are
    known recorder UTC, so clients must never apply their own local timezone.
    """
    def event_value(value: Any) -> Any:
        if isinstance(value, datetime):
            utc_value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
            return utc_value.isoformat().replace("+00:00", "Z")
        return json_safe(value)

    return {key: event_value(value) for key, value in row.items()}
