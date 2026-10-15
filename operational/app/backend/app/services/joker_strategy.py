"""Read-only, deterministic Joker WHAT-IF route strategy calculations."""
from __future__ import annotations

from typing import Any

from .track_topology import load_track_topology

TIMING_TIE_TOLERANCE_SECONDS = 0.01


def evaluate_joker_strategy(*, driver_id: str, route_id: str, lap: int, speed_factor: float,
                            race_laps: int, virtual_max_pace: float, starting_delay_seconds: float,
                            field: list[dict[str, Any]]) -> dict[str, Any]:
    """Evaluate one explicit route event; no data is persisted or mutated."""
    topology = load_track_topology()
    route = next((item for item in topology["alternateRoutes"] if item["routeId"] == route_id), None)
    if route is None or route["routeType"] != "JOKER":
        raise ValueError(f"Unknown Joker route: {route_id}")
    if lap > race_laps:
        raise ValueError("Joker lap must be within the active scenario.")
    main_length = float(topology["mainRoute"]["lengthMeters"])
    entity = next((item for item in field if item["driverId"] == driver_id), None)
    if entity is None:
        raise ValueError(f"Driver {driver_id} is not present in the active scenario.")
    pace = float(entity["pace"])
    main_speed = main_length / pace
    replaced = float(route["replacedMainDistanceMeters"])
    alternate = float(route["lengthMeters"])
    main_time = replaced / main_speed
    alternate_time = alternate / (main_speed * speed_factor)
    delta = alternate_time - main_time
    break_even = alternate / replaced
    entry_progress = float(route["entryAnchor"]["normalizedProgress"])
    exit_progress = float(route["exitAnchor"]["normalizedProgress"])
    entry_time = (lap - 1 + entry_progress) * pace + (starting_delay_seconds if driver_id == "VIRTUAL_MAX" else 0.0)
    exit_time = entry_time + alternate_time
    rejoin_progress = (lap - 1) + exit_progress

    ranks: list[tuple[str, float]] = []
    for item in field:
        item_pace = float(item["pace"])
        progress = rejoin_progress if item["driverId"] == driver_id else min(race_laps, exit_time / item_pace)
        ranks.append((str(item["driverId"]), progress))
    ranks.sort(key=lambda value: (-value[1], value[0] == "VIRTUAL_MAX", value[0]))
    index = next(index for index, value in enumerate(ranks) if value[0] == driver_id)
    ahead = ranks[index - 1] if index else None
    behind = ranks[index + 1] if index + 1 < len(ranks) else None
    gap = lambda candidate: None if candidate is None else abs(candidate[1] - rejoin_progress) * pace
    return {
        "driverId": driver_id, "routeId": route_id, "lap": lap,
        "entryRaceTimeSeconds": entry_time, "exitRaceTimeSeconds": exit_time,
        "entryMainProgress": entry_progress, "exitMainProgress": exit_progress,
        "mainReplacedDistanceMeters": replaced, "alternateDistanceMeters": alternate,
        "mainReplacedTimeSeconds": main_time, "alternateRouteTimeSeconds": alternate_time,
        "timingDeltaSeconds": delta, "speedFactor": speed_factor, "breakEvenSpeedFactor": break_even,
        "projectedRejoin": {"rank": index + 1, "aheadDriverId": None if ahead is None else ahead[0], "behindDriverId": None if behind is None else behind[0], "gapAheadSeconds": gap(ahead), "gapBehindSeconds": gap(behind)},
        "caveats": ["JOKER WHAT-IF. Route speed is a scenario assumption, not observed Joker telemetry.", "Rejoin is reconstructed timing order only; it is not a physical merge or collision prediction."],
    }

def evaluate_joker_options(*, options: list[dict[str, Any]], **kwargs: Any) -> dict[str, Any]:
    """Batch orchestration over the single authoritative Joker evaluator."""
    evaluated = []
    for index, option in enumerate(options, start=1):
        result = evaluate_joker_strategy(route_id=option["routeId"], lap=int(option["lap"]), speed_factor=float(option["jokerSpeedFactor"]), **kwargs)
        result["optionId"] = f"{result['routeId']}:L{result['lap']}:F{result['speedFactor']:.3f}:{index}"
        evaluated.append(result)
    evaluated.sort(key=lambda item: float(item["timingDeltaSeconds"]))
    best = float(evaluated[0]["timingDeltaSeconds"])
    equivalent = [item["optionId"] for item in evaluated if abs(float(item["timingDeltaSeconds"]) - best) <= TIMING_TIE_TOLERANCE_SECONDS]
    return {"evaluatedOptions": evaluated, "bestTimingOptionIds": equivalent, "bestTimingDeltaSeconds": best, "tieToleranceSeconds": TIMING_TIE_TOLERANCE_SECONDS, "assumptionSummary": "Deterministic comparison under selected Joker speed-factor assumptions. Joker pace is not measured telemetry."}
