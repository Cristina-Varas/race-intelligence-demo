"""Build the approved compact historical replay anchors from governed local parquet."""
from __future__ import annotations

from pathlib import Path
import json
import math

import pandas as pd


ROOT = Path(__file__).resolve().parents[1]
RACE_STATE = ROOT / "data" / "processed" / "race_state.parquet"
PROFILES = ROOT / "data" / "processed" / "observed_driver_profiles.parquet"
TRACK = ROOT / "data" / "track" / "derived" / "track_geometry_normalized.json"
OUTPUT = ROOT / "data" / "track" / "derived" / "historical_replay_anchors.json"


def main() -> None:
    race_state = pd.read_parquet(RACE_STATE)
    profiles = pd.read_parquet(PROFILES)
    # The canonical 16 are the sufficient profiles with a published pooled rank.
    # A local profile row without that rank is not promoted into replay support.
    supported = [int(value) for value in profiles.loc[(profiles["support_status"] == "sufficient") & profiles["pooled_rank"].notna() & (profiles["pooled_rank"] <= 16), "driver_id"].tolist()]
    r1 = race_state[(race_state["session"] == "R1") & race_state["driver_id"].isin(supported)].copy()
    r1 = r1[(~r1["is_pit_lap"]) & r1["lap_time_seconds"].notna()]
    r1 = r1[~r1["lap_time_seconds"].map(lambda value: not math.isfinite(float(value)))]
    drivers = []
    max_duration = 0.0
    max_lap = 0
    for driver_id in supported:
        rows = r1[r1["driver_id"] == driver_id].sort_values("lap_number")
        elapsed = 0.0
        anchors = []
        for row in rows.itertuples(index=False):
            lap_duration = float(row.lap_time_seconds)
            anchors.append({
                "raceTimeSeconds": elapsed,
                "lap": int(row.lap_number),
                "lapDurationSeconds": lap_duration,
                "timingGapSeconds": None if pd.isna(row.gap_to_leader_seconds) else float(row.gap_to_leader_seconds),
            })
            elapsed += lap_duration
            max_lap = max(max_lap, int(row.lap_number))
        max_duration = max(max_duration, elapsed)
        drivers.append({"driverId": f"#{driver_id}", "anchors": anchors})
    track = json.loads(TRACK.read_text(encoding="utf-8"))
    payload = {
        "metadata": {
            "sourceSession": "R1",
            "sourceData": "data/processed/race_state.parquet",
            "supportedDriverIds": [f"#{driver_id}" for driver_id in supported],
            "supportedDriverCount": len(supported),
            "raceLaps": max_lap,
            "raceDurationSeconds": max_duration,
            "trackLengthMeters": track["metadata"]["trackLengthMeters"],
            "reconstructionMethod": "lap_interpolation",
            "gpsTelemetry": False,
            "startTiming": "relative_to_available_lap_anchors",
        },
        "drivers": drivers,
    }
    OUTPUT.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
