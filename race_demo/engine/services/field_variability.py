"""Empirical, reproducible lap variability for the synthetic field only.

This service deliberately does not create a population, alter nominal paces or
modify historical evidence.  It selects one observed lap-deviation per
synthetic driver/lap for a transient scenario realization.
"""
from __future__ import annotations

import math
import random
from collections.abc import Iterable, Sequence


HISTORICAL_SEEDED_DEFAULT_SEED = 42
RACE_PROGRESS_EPSILON = 1e-9


def percentile(values: Sequence[float], probability: float) -> float:
    """Linear percentile without a third-party numerical dependency."""
    ordered = sorted(float(value) for value in values)
    if not ordered:
        raise ValueError("Historical variability is unavailable.")
    position = (len(ordered) - 1) * probability
    lower, upper = math.floor(position), math.ceil(position)
    if lower == upper:
        return ordered[lower]
    return ordered[lower] + (ordered[upper] - ordered[lower]) * (position - lower)


def deviation_distribution(values: Iterable[float]) -> dict[str, float | int]:
    observations = [float(value) for value in values]
    if not observations:
        raise ValueError("Historical variability is unavailable.")
    return {
        "count": len(observations), "min": min(observations), "max": max(observations),
        "mean": sum(observations) / len(observations), "median": percentile(observations, .5),
        "p5": percentile(observations, .05), "p25": percentile(observations, .25),
        "p75": percentile(observations, .75), "p95": percentile(observations, .95),
        "p99": percentile(observations, .99),
    }


def empirical_lap_sequences(
    nominal_paces: dict[str, float], deviations: Iterable[float], race_laps: int, seed: int = HISTORICAL_SEEDED_DEFAULT_SEED, *, center: bool = True,
) -> dict[str, list[float]]:
    """Bootstrap raw observed deviations independently by stable driver/lap key.

    A per-key PRNG makes the result independent of collection iteration order.
    Source values remain raw evidence.  The default transient scenario layer
    centres each bootstrap draw by the source mean so a nominal synthetic pace
    remains its central pace. Positivity remains an effective-lap invariant.
    """
    observations = tuple(float(value) for value in deviations)
    if not observations:
        raise ValueError("Historical variability is unavailable.")
    if race_laps < 1:
        raise ValueError("Race laps must be positive.")
    source_mean = sum(observations) / len(observations) if center else 0.0
    sequences: dict[str, list[float]] = {}
    for driver_id in sorted(nominal_paces):
        nominal = float(nominal_paces[driver_id])
        laps = [nominal + random.Random(f"{seed}:{driver_id}:{lap}").choice(observations) - source_mean for lap in range(1, race_laps + 1)]
        if any(lap_time <= 0 for lap_time in laps):
            raise ValueError(f"Historical seeded variability produced a non-positive lap time for {driver_id}.")
        sequences[driver_id] = laps
    return sequences


def cumulative_lap_times(lap_times: Sequence[float]) -> list[float]:
    total = 0.0
    cumulative: list[float] = []
    for lap_time in lap_times:
        total += float(lap_time)
        cumulative.append(total)
    return cumulative


def progress_at_time(lap_times: Sequence[float], time_seconds: float) -> float:
    """Lap progress at a race-clock time; each sampled lap is linear within lap."""
    if time_seconds <= 0:
        return 0.0
    elapsed = 0.0
    for index, lap_time in enumerate(lap_times):
        if elapsed + lap_time >= time_seconds:
            return min(len(lap_times), index + (time_seconds - elapsed) / lap_time)
        elapsed += lap_time
    return float(len(lap_times))


def rank_race_state(entries: Sequence[dict[str, float | str]], race_laps: int) -> list[dict[str, float | str]]:
    """Rank a common-distance race state without treating a terminal cap as a catch.

    Before completion, greater cumulative progress ranks ahead.  Once an
    entity has completed the race distance, its absolute finish time is the
    authoritative tie-break: a competitor that finished earlier remains ahead
    even when both progress values are capped at ``race_laps``.
    """
    def key(entry: dict[str, float | str]) -> tuple[float, float, int, str]:
        progress = float(entry["progress"])
        finished = progress >= race_laps - RACE_PROGRESS_EPSILON
        entity_type = str(entry.get("entityType", "synthetic"))
        tie_break = 1 if entity_type == "virtual_max" else 0
        if finished:
            return (0.0, float(entry["finishTimeSeconds"]), tie_break, str(entry["driverId"]))
        return (1.0, -progress, tie_break, str(entry["driverId"]))

    return sorted(entries, key=key)


def seeded_timing_catch_time(
    lap_times: Sequence[float], virtual_max_pace: float, starting_delay_seconds: float, race_laps: int,
) -> float | None:
    """Return a genuine in-race timing crossing, excluding terminal cap equality."""
    start = max(0.0, starting_delay_seconds)
    virtual_max_finish = starting_delay_seconds + race_laps * virtual_max_pace
    driver_finish = sum(float(lap_time) for lap_time in lap_times)
    finish = min(virtual_max_finish, driver_finish)

    def gap(clock: float) -> float:
        vm = max(0.0, min(race_laps, (clock - starting_delay_seconds) / virtual_max_pace))
        return vm - progress_at_time(lap_times, clock)

    previous_time, previous_gap = start, gap(start)
    if previous_gap >= 0:
        return start
    steps = max(1, int((finish - start) / 2.0))
    for step in range(1, steps + 1):
        current_time = start + (finish - start) * step / steps
        current_gap = gap(current_time)
        if previous_gap < 0 <= current_gap:
            low, high = previous_time, current_time
            for _ in range(32):
                midpoint = (low + high) / 2
                if gap(midpoint) >= 0:
                    high = midpoint
                else:
                    low = midpoint
            # A driver that finished first cannot be declared caught solely
            # because both capped progress values equal the race distance.
            if high >= driver_finish - RACE_PROGRESS_EPSILON and driver_finish < virtual_max_finish - RACE_PROGRESS_EPSILON:
                return None
            return high
        previous_time, previous_gap = current_time, current_gap
    return None
