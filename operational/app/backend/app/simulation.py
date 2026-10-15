"""Transient, read-only timing-catch simulations over governed historical inputs."""
from __future__ import annotations

from dataclasses import dataclass
import math
import random
from typing import Iterable

from .services.race_assumptions import build_race_assumption_comparison
from .services.field_variability import (
    HISTORICAL_SEEDED_DEFAULT_SEED,
    cumulative_lap_times,
    deviation_distribution,
    empirical_lap_sequences,
    progress_at_time,
    seeded_timing_catch_time,
)


SEED = 42
SYNTHETIC_FIELD_SEED = 42
CURVE_STEP_SECONDS = 0.1
SYNTHETIC_GRID_SPACING_METERS = 5.0
SYNTHETIC_GRID_FRONT_OFFSET_METERS = 5.0
SYNTHETIC_REPLAY_DIRECTION = "reverse"


@dataclass(frozen=True)
class HistoricalProfile:
    driver_id: str
    pace: float


def generate_synthetic_stress_field(
    profiles: list[HistoricalProfile], target_size: int = 100, seed: int = SYNTHETIC_FIELD_SEED,
) -> list[HistoricalProfile]:
    """Validated bootstrap_bounded_v1 stress field, held only in memory.

    This mirrors ``src/synthetic_field.py``: bootstrap observed templates,
    apply a normal pace shift with scale 10% of between-driver MAD, bound the
    shift to 25% of that MAD, then keep paces within the observed range.
    """
    if not profiles or target_size < 1:
        raise ValueError("A non-empty observed field and positive target size are required.")
    paces = sorted(profile.pace for profile in profiles)
    midpoint = len(paces) // 2
    median = paces[midpoint] if len(paces) % 2 else (paces[midpoint - 1] + paces[midpoint]) / 2
    deviations = sorted(abs(pace - median) for pace in paces)
    midpoint = len(deviations) // 2
    between_mad = deviations[midpoint] if len(deviations) % 2 else (deviations[midpoint - 1] + deviations[midpoint]) / 2
    rng = random.Random(seed)
    templates = [rng.choice(profiles) for _ in range(target_size)]
    bound = 0.25 * between_mad
    scale = 0.10 * between_mad
    low, high = paces[0], paces[-1]
    return [
        HistoricalProfile(
            driver_id=f"SYN_{index:03d}",
            pace=min(high, max(low, template.pace + max(-bound, min(bound, rng.gauss(0, scale))))),
        )
        for index, template in enumerate(templates, start=1)
    ]


def centered(values: Iterable[float]) -> list[float]:
    observations = [float(value) for value in values]
    if not observations:
        raise ValueError("Historical variability is unavailable.")
    mean = sum(observations) / len(observations)
    return [value - mean for value in observations]


def deterministic_driver_results(
    profiles: list[HistoricalProfile],
    virtual_max_pace: float,
    starting_delay_seconds: float,
    race_laps: int,
) -> list[dict[str, float | int | str | bool | None]]:
    fastest = min(profile.pace for profile in profiles)
    results: list[dict[str, float | int | str | bool | None]] = []
    for profile in profiles:
        pace_gain = profile.pace - virtual_max_pace
        if pace_gain <= 0:
            catch_lap_exact = None
            catch_possible = False
        elif starting_delay_seconds <= 0:
            catch_lap_exact = 0.0
            catch_possible = True
        else:
            catch_lap_exact = starting_delay_seconds / pace_gain
            catch_possible = catch_lap_exact <= race_laps
        results.append({
            "driverId": profile.driver_id,
            "driverPace": profile.pace,
            "deltaToFastest": profile.pace - fastest,
            "paceGainSecondsPerLap": pace_gain,
            "catchLapExact": catch_lap_exact,
            "catchLapDisplay": None if catch_lap_exact is None else int(-(-catch_lap_exact // 1)),
            "catchPossibleWithinRace": catch_possible,
        })
    return results


def deterministic_timing_summary(
    drivers: list[dict[str, float | int | str | bool | None]],
    *,
    race_laps: int,
    virtual_max_pace: float,
    starting_delay_seconds: float,
) -> dict[str, float | int | bool | str | None]:
    """Summarise fixed-lap race completion from existing deterministic results.

    This is a presentation/API projection only.  It deliberately reuses the
    exact catch laps produced by ``deterministic_driver_results`` rather than
    introducing another pace or catch calculation.
    """
    projected_finish_time = starting_delay_seconds + race_laps * virtual_max_pace
    caught_drivers = [driver for driver in drivers if driver["catchPossibleWithinRace"]]
    full_field_caught = len(caught_drivers) == len(drivers)
    if full_field_caught:
        final_catch_lap_exact = max(float(driver["catchLapExact"]) for driver in caught_drivers)
        full_field_catch_time: float | None = starting_delay_seconds + final_catch_lap_exact * virtual_max_pace
        full_field_catch_lap: int | None = math.ceil(final_catch_lap_exact)
    else:
        full_field_catch_time = None
        full_field_catch_lap = None
    return {
        "raceFormat": "FIXED_LAP",
        "projectedFinishTimeSeconds": projected_finish_time,
        "projectedFinishLap": race_laps,
        "fullFieldCatchTimeSeconds": full_field_catch_time,
        "fullFieldCatchLap": full_field_catch_lap,
        "fullFieldCaught": full_field_caught,
    }


def synthetic_replay_contract(
    drivers: list[dict[str, float | int | str | bool | None]],
    *,
    race_laps: int,
    virtual_max_pace: float,
    starting_delay_seconds: float,
    lap_times_by_driver: dict[str, list[float]] | None = None,
    field_variability_mode: str = "NOMINAL",
    field_variability_seed: int = HISTORICAL_SEEDED_DEFAULT_SEED,
) -> dict[str, object]:
    """Expose the existing seeded synthetic field as a deterministic replay view.

    The simulation response contains one bounded-bootstrap pace per synthetic
    driver, not per-lap telemetry. This projection deliberately uses that
    published pace as a constant per-lap duration: it is deterministic and
    does not add an unvalidated acceleration/noise model.
    """
    ordered = sorted(drivers, key=lambda driver: (float(driver["driverPace"]), str(driver["driverId"])))
    entities = []
    for index, driver in enumerate(ordered, start=1):
        grid_offset = SYNTHETIC_GRID_FRONT_OFFSET_METERS + (index - 1) * SYNTHETIC_GRID_SPACING_METERS
        catch_lap = driver["catchLapExact"]
        lap_times = None if lap_times_by_driver is None else lap_times_by_driver.get(str(driver["driverId"]))
        seeded_catch_time = None if lap_times is None else seeded_timing_catch_time(lap_times, virtual_max_pace, starting_delay_seconds, race_laps)
        entities.append({
            "driverId": str(driver["driverId"]),
            "entityType": "synthetic",
            "gridPosition": index,
            "paceSecondsPerLap": float(driver["driverPace"]),
            # Keep these aliases for existing analytics and frontend consumers.
            "lapTimeSeconds": float(driver["driverPace"]),
            "raceDurationSeconds": sum(lap_times) if lap_times is not None else float(driver["driverPace"]) * race_laps,
            "gridOffsetMeters": grid_offset,
            "initialRaceDistanceMeters": -grid_offset,
            "routeId": "main",
            "replayDirection": SYNTHETIC_REPLAY_DIRECTION,
            "timingCatchTimeSeconds": seeded_catch_time if lap_times is not None else (None if catch_lap is None else starting_delay_seconds + float(catch_lap) * virtual_max_pace),
            **({"lapTimes": lap_times, "cumulativeLapTimes": cumulative_lap_times(lap_times)} if lap_times is not None else {}),
        })
    return {
        "method": "seeded_historical_lap_variability" if lap_times_by_driver is not None else "constant_pace_lap_interpolation",
        "seed": field_variability_seed if lap_times_by_driver is not None else SYNTHETIC_FIELD_SEED,
        "populationId": "bootstrap_bounded_v1:seed=42",
        "scenarioId": f"synthetic_100:seed=42:variability={field_variability_mode}:variabilitySeed={field_variability_seed}:laps={race_laps}:pace={virtual_max_pace:.6f}:delay={starting_delay_seconds:.6f}",
        "raceLaps": race_laps,
        "fieldSize": len(entities),
        "grid": {
            "kind": "ILLUSTRATIVE_SYNTHETIC_STARTING_GRID",
            "ordering": "nominal_pace_ascending",
            "frontOffsetMeters": SYNTHETIC_GRID_FRONT_OFFSET_METERS,
            "spacingMeters": SYNTHETIC_GRID_SPACING_METERS,
            "lastOffsetMeters": entities[-1]["gridOffsetMeters"] if entities else 0.0,
            "totalLengthMeters": (len(entities) - 1) * SYNTHETIC_GRID_SPACING_METERS if entities else 0.0,
        },
        "entities": entities,
        "caveat": "Synthetic field generated from observed pace distributions. Illustrative grid offsets are deterministic replay state, not historical race evidence. No synthetic GPS, sector telemetry or intra-lap acceleration is supplied.",
    }


def _delay_grid(margins: list[float], selected_delay: float) -> list[float]:
    lower = min(-10.0, min(margins) - 1.0, selected_delay - 1.0)
    upper = max(10.0, max(margins) + 1.0, selected_delay + 1.0)
    start = int(lower // CURVE_STEP_SECONDS)
    end = int(-(-upper // CURVE_STEP_SECONDS))
    return [round(step * CURVE_STEP_SECONDS, 4) for step in range(start, end + 1)]


def _timed_finish(lap_times: list[float], duration: float) -> tuple[int, float]:
    elapsed = 0.0
    for index, lap_time in enumerate(lap_times, start=1):
        elapsed += lap_time
        if elapsed >= duration:
            return index, elapsed
    raise ValueError("Timed-race lap horizon was insufficient.")


def _timed_catch_time(lap_times: list[float], driver_finish_lap: int, vm_pace: float, vm_finish_lap: int, delay: float) -> float | None:
    """Genuine progress crossing before either timed-race terminal finish."""
    driver_finish = sum(lap_times[:driver_finish_lap])
    vm_finish = delay + vm_finish_lap * vm_pace
    end = min(driver_finish, vm_finish)
    def gap(clock: float) -> float:
        vm = max(0.0, min(vm_finish_lap, (clock - delay) / vm_pace))
        return vm - min(driver_finish_lap, progress_at_time(lap_times, clock))
    previous_time, previous_gap = max(0.0, delay), gap(max(0.0, delay))
    for step in range(1, max(2, int((end - previous_time) / 2) + 1)):
        current_time = previous_time + (end - previous_time) * step / max(1, int((end - previous_time) / 2))
        current_gap = gap(current_time)
        if previous_gap < 0 <= current_gap:
            low, high = previous_time, current_time
            for _ in range(32):
                middle = (low + high) / 2
                if gap(middle) >= 0: high = middle
                else: low = middle
            if high >= driver_finish - 1e-9 and driver_finish < vm_finish - 1e-9:
                return None
            return high
        previous_time, previous_gap = current_time, current_gap
    return None


def _timed_traffic_loop(field_laps: list[list[float]], field_terminal: list[tuple[int, float]], *, duration: float, base_pace: float, delay: float, pace_profile: list[dict] | None = None, traffic_model: dict | None = None) -> dict[str, object]:
    """Sequential Phase-8 clearance events driven by elapsed timed-race clock."""
    from .services.race_assumptions import REFERENCE_PACE_PROFILE, REFERENCE_TRAFFIC_COST_MODEL, adjusted_lap_time, pace_adjustment_for_lap, traffic_cost_for_lap
    profile, model = pace_profile or REFERENCE_PACE_PROFILE, traffic_model or REFERENCE_TRAFFIC_COST_MODEL
    time, progress, terminal_lap, cost = delay, 0.0, None, 0.0
    cleared: set[int] = set(); events: list[dict] = []; trajectory: list[dict] = []; p1 = None
    while True:
        lap = max(1, math.floor(progress) + 1)
        if terminal_lap is not None and progress >= terminal_lap - 1e-9: break
        pace = adjusted_lap_time(base_pace, pace_adjustment_for_lap(lap, profile))
        boundary = min(math.floor(progress) + 1, terminal_lap if terminal_lap is not None else math.inf)
        step = min(.1, boundary - progress)
        if step <= 1e-10:
            progress = boundary
            continue
        # Race expiry can occur mid-driving segment; lock the in-progress lap.
        if terminal_lap is None and time + step * pace >= duration:
            partial = max(0.0, (duration - time) / pace); progress += partial; time = duration
            terminal_lap = max(1, math.ceil(progress - 1e-9)); continue
        next_time, next_progress = time + step * pace, progress + step
        candidate = None
        for index, laps in enumerate(field_laps):
            if index in cleared: continue
            finish_lap, finish_time = field_terminal[index]
            before = min(finish_lap, progress_at_time(laps, time)) - progress
            after = min(finish_lap, progress_at_time(laps, next_time)) - next_progress
            if before > 0 and after <= 0 and time < finish_time + 1e-9:
                fraction = before / (before - after) if before != after else 1.0
                event_time = time + (next_time - time) * fraction
                if event_time <= finish_time + 1e-9 and (candidate is None or event_time < candidate[0]): candidate = (event_time, index, fraction)
        if candidate is None:
            if terminal_lap is not None and next_progress >= terminal_lap - 1e-9:
                time += (terminal_lap - progress) * pace; progress = float(terminal_lap)
            else:
                progress, time = next_progress, next_time
        else:
            event_time, index, fraction = candidate; progress += step * fraction; time = event_time
            event_lap = max(1, math.ceil(progress - 1e-9)); pause = traffic_cost_for_lap(event_lap, model)
            cleared.add(index); cost += pause; events.append({"driverIndex": index, "timingCatchTimeSeconds": event_time, "timingCatchRaceProgress": progress, "clearTimeSeconds": event_time + pause, "trafficCostSeconds": pause, "lap": event_lap})
            time += pause
            if terminal_lap is None and time >= duration: terminal_lap = max(1, math.ceil(progress - 1e-9))
        if abs(progress - round(progress)) < 1e-8:
            rank = 1 + sum(min(field_terminal[i][0], progress_at_time(laps, time)) > progress + 1e-9 for i, laps in enumerate(field_laps))
            point = {"lap": int(round(progress)), "raceTimeSeconds": time, "rank": rank, "trafficCostSeconds": sum(event["trafficCostSeconds"] for event in events if event["lap"] == int(round(progress))), "cumulativeTrafficCostSeconds": cost, "timingCatchCount": len(events), "clearedCount": len(cleared), "stillToClearCount": len(field_laps)-len(cleared)}
            trajectory.append(point)
            if p1 is None and rank == 1: p1 = point
    full = events[-1] if events and len(cleared) == len(field_laps) else None
    return {"completedLaps": int(round(progress)), "finishTimeSeconds": time, "trajectory": trajectory, "events": events, "p1": p1, "cost": cost, "cleared": cleared, "full": full}


def run_timed_simulation(
    profiles: list[HistoricalProfile], observed_deviations: list[float], *, race_duration_seconds: float,
    virtual_max_advantage_seconds_per_lap: float, starting_delay_seconds: float, field_mode: str,
    race_model_mode: str, field_variability_mode: str, field_variability_seed: int, timed_finish_rule: str,
    pace_profile: list[dict] | None = None, traffic_cost_model: dict | None = None,
) -> dict[str, object]:
    """Elapsed-time race projection using COMPLETE_CURRENT_LAP semantics."""
    field = generate_synthetic_stress_field(profiles) if field_mode == "synthetic_100" else profiles
    fastest = min(profile.pace for profile in profiles); vm_pace = fastest - virtual_max_advantage_seconds_per_lap
    lower_lap = max(1.0, min(profile.pace for profile in field) + min(observed_deviations) - sum(observed_deviations) / len(observed_deviations))
    horizon = max(5, math.ceil(race_duration_seconds / lower_lap) + 5)
    nominal = {profile.driver_id: profile.pace for profile in field}
    lap_times = empirical_lap_sequences(nominal, observed_deviations, horizon, field_variability_seed) if field_variability_mode == "HISTORICAL_SEEDED" else {driver_id: [pace] * horizon for driver_id, pace in nominal.items()}
    vm_finish_lap = max(1, math.ceil((race_duration_seconds - starting_delay_seconds) / vm_pace))
    vm_finish = starting_delay_seconds + vm_finish_lap * vm_pace
    field_terminal = {driver_id: _timed_finish(laps, race_duration_seconds) for driver_id, laps in lap_times.items()}
    catches = {driver_id: _timed_catch_time(lap_times[driver_id], finish_lap, vm_pace, vm_finish_lap, starting_delay_seconds) for driver_id, (finish_lap, _) in field_terminal.items()}
    terminal = [(driver_id, finish_lap, finish_time, "synthetic") for driver_id, (finish_lap, finish_time) in field_terminal.items()] + [("VIRTUAL MAX", vm_finish_lap, vm_finish, "virtual_max")]
    terminal.sort(key=lambda item: (-item[1], item[2], 1 if item[3] == "virtual_max" else 0, item[0]))
    final_rank = next(index + 1 for index, item in enumerate(terminal) if item[0] == "VIRTUAL MAX")
    trajectory = []
    for lap in range(1, vm_finish_lap + 1):
        clock = starting_delay_seconds + lap * vm_pace
        if lap == vm_finish_lap:
            rank = final_rank
        else:
            state = [(driver_id, min(field_terminal[driver_id][0], progress_at_time(laps, clock)), "synthetic") for driver_id, laps in lap_times.items()] + [("VIRTUAL MAX", lap, "virtual_max")]
            state.sort(key=lambda item: (-item[1], 1 if item[2] == "virtual_max" else 0, item[0]))
            rank = next(index + 1 for index, item in enumerate(state) if item[0] == "VIRTUAL MAX")
        caught = sum(value is not None and value <= clock for value in catches.values())
        trajectory.append({"lap": lap, "raceTimeSeconds": clock, "rank": rank, "trafficCostSeconds": 0.0, "cumulativeTrafficCostSeconds": 0.0, "timingCatchCount": caught, "clearedCount": caught, "stillToClearCount": len(field) - caught})
    p1 = next((point for point in trajectory if point["rank"] == 1), None)
    full_catch = max(catches.values()) if all(value is not None for value in catches.values()) else None
    drivers = []
    for profile in field:
        catch = catches[profile.driver_id]
        drivers.append({"driverId": profile.driver_id, "driverPace": profile.pace, "deltaToFastest": profile.pace-fastest, "paceGainSecondsPerLap": profile.pace-vm_pace, "catchLapExact": None if catch is None else (catch-starting_delay_seconds)/vm_pace, "catchLapDisplay": None if catch is None else math.ceil((catch-starting_delay_seconds)/vm_pace), "catchPossibleWithinRace": catch is not None, "catchProbability": 0.0})
    replay = synthetic_replay_contract(drivers, race_laps=horizon, virtual_max_pace=vm_pace, starting_delay_seconds=starting_delay_seconds, lap_times_by_driver=lap_times, field_variability_mode=field_variability_mode, field_variability_seed=field_variability_seed)
    for entity in replay["entities"]:
        completed, finish_time = field_terminal[entity["driverId"]]
        entity["raceDurationSeconds"] = finish_time; entity["lapTimes"] = entity["lapTimes"][:completed]; entity["cumulativeLapTimes"] = cumulative_lap_times(entity["lapTimes"])
    summary = {"projectedFinishTimeSeconds": vm_finish, "p1Lap": None if p1 is None else p1["lap"], "p1TimeSeconds": None if p1 is None else p1["raceTimeSeconds"], "fullFieldClearLap": None if full_catch is None else math.ceil((full_catch-starting_delay_seconds)/vm_pace), "fullFieldClearTimeSeconds": full_catch, "cumulativeTrafficCostSeconds": 0.0, "rankTrajectory": trajectory, "timingCatchCount": sum(value is not None for value in catches.values()), "clearedCount": sum(value is not None for value in catches.values()), "stillToClearCount": sum(value is None for value in catches.values()), "currentlyClearingDriverId": None, "currentClearCompletionTimeSeconds": None, "clearanceEvents": []}
    traffic_summary = None
    active_vm_laps, active_vm_finish, active_final_rank = vm_finish_lap, vm_finish, final_rank
    if race_model_mode == "TRAFFIC_ADJUSTED":
        ordered_ids = [profile.driver_id for profile in field]
        loop = _timed_traffic_loop([lap_times[driver_id] for driver_id in ordered_ids], [field_terminal[driver_id] for driver_id in ordered_ids], duration=race_duration_seconds, base_pace=vm_pace, delay=starting_delay_seconds, pace_profile=pace_profile, traffic_model=traffic_cost_model)
        active_vm_laps, active_vm_finish = loop["completedLaps"], loop["finishTimeSeconds"]
        terminal = [(driver_id, finish_lap, finish_time, "synthetic") for driver_id, (finish_lap, finish_time) in field_terminal.items()] + [("VIRTUAL MAX", active_vm_laps, active_vm_finish, "virtual_max")]
        terminal.sort(key=lambda item: (-item[1], item[2], 1 if item[3] == "virtual_max" else 0, item[0]))
        active_final_rank = next(index + 1 for index, item in enumerate(terminal) if item[0] == "VIRTUAL MAX")
        if loop["trajectory"]: loop["trajectory"][-1]["rank"] = active_final_rank
        full = loop["full"]
        traffic_summary = {"projectedFinishTimeSeconds": active_vm_finish, "p1Lap": None if loop["p1"] is None else loop["p1"]["lap"], "p1TimeSeconds": None if loop["p1"] is None else loop["p1"]["raceTimeSeconds"], "fullFieldClearLap": None if full is None else full["lap"], "fullFieldClearTimeSeconds": None if full is None else full["clearTimeSeconds"], "cumulativeTrafficCostSeconds": loop["cost"], "rankTrajectory": loop["trajectory"], "timingCatchCount": len(loop["events"]), "clearedCount": len(loop["cleared"]), "stillToClearCount": len(field)-len(loop["cleared"]), "currentlyClearingDriverId": None, "currentClearCompletionTimeSeconds": None, "clearanceEvents": loop["events"]}
    distribution = deviation_distribution(observed_deviations)
    terminal_entities = [{"entityId": driver_id, "completedLaps": laps, "finishLap": laps, "finishTimeSeconds": finish, "finalRank": index + 1, "finished": True} for index, (driver_id, laps, finish, _) in enumerate(terminal)]
    field_laps = [laps for driver_id, laps, _, _ in terminal if driver_id != "VIRTUAL MAX"]
    terminal_state = {"raceFormat": "TIMED_RACE", "raceClockExpirySeconds": race_duration_seconds, "finishRule": timed_finish_rule, "entities": terminal_entities, "virtualMax": {"completedLaps": active_vm_laps, "finishLap": active_vm_laps, "finishTimeSeconds": active_vm_finish, "finalRank": active_final_rank}, "fieldSummary": {"maxCompletedLaps": max(field_laps), "minCompletedLaps": min(field_laps), "distinctCompletedLapCounts": len(set(field_laps))}}
    return {"mode":"custom", "scenarioType":"SYNTHETIC WHAT-IF", "fieldMode":field_mode, "fieldLabel":"Synthetic 100-driver stress test" if field_mode=="synthetic_100" else "Observed historical field", "fieldSize":len(field), "fieldEvidenceType":"SYNTHETIC" if field_mode=="synthetic_100" else "OBSERVED", "raceLaps":active_vm_laps, "raceFormat":{"mode":"TIMED_RACE","durationSeconds":race_duration_seconds,"finishRule":timed_finish_rule}, "terminalState":terminal_state, "simulations":0, "fastestObservedPace":fastest, "virtualMaxAdvantageSecondsPerLap":virtual_max_advantage_seconds_per_lap, "virtualMaxPace":vm_pace, "startingDelaySeconds":starting_delay_seconds, "deterministicMaxDelaySeconds":0.0, "fullFieldCatchProbability":0.0, "thresholds":{"p50":None,"p80":None,"p90":None}, "probabilityCurve":[], "drivers":drivers, "timing":{"raceFormat":"TIMED_RACE","projectedFinishTimeSeconds":active_vm_finish,"projectedFinishLap":active_vm_laps,"fullFieldCatchTimeSeconds":full_catch,"fullFieldCatchLap":None if full_catch is None else math.ceil((full_catch-starting_delay_seconds)/vm_pace),"fullFieldCaught":full_catch is not None}, "caveats":["Timed race uses the explicit COMPLETE_CURRENT_LAP scenario rule; it is not an official regulation.","Monte Carlo is unavailable for TIMED_RACE.","Timing catch only; not physical overtaking."], "syntheticReplay":replay, "raceModel":{"mode":race_model_mode,"paceProfile":pace_profile or [],"trafficCostModel":traffic_cost_model or {"enabled":True,"earlyCostSecondsPerKart":1.0,"lateCostSecondsPerKart":0.2,"transitionStartLap":1,"transitionEndLap":7,"interpolation":"LINEAR"}}, "pureTiming":summary, "trafficAdjusted":traffic_summary, "fieldVariability":{"mode":field_variability_mode,"seed":field_variability_seed,"sourceCount":len(observed_deviations),"methodology":"centered_empirical_bootstrap" if field_variability_mode=="HISTORICAL_SEEDED" else "none","sourceMeanDeviationSeconds":distribution["mean"],"appliedCenteringSeconds":distribution["mean"] if field_variability_mode=="HISTORICAL_SEEDED" else 0.0,"bounds":None,"distribution":distribution,"sampleAudit":None}}


def run_simulation(
    profiles: list[HistoricalProfile],
    historical_deviations: Iterable[float],
    *,
    race_laps: int,
    virtual_max_advantage_seconds_per_lap: float,
    starting_delay_seconds: float,
    simulations: int,
    field_mode: str = "historical",
    race_model_mode: str = "PURE_TIMING",
    pace_profile: list[dict] | None = None,
    traffic_cost_model: dict | None = None,
    field_variability_mode: str = "NOMINAL",
    field_variability_seed: int = HISTORICAL_SEEDED_DEFAULT_SEED,
    race_format: str = "FIXED_LAPS",
    race_duration_seconds: float | None = None,
    timed_finish_rule: str = "COMPLETE_CURRENT_LAP",
) -> dict[str, object]:
    """Run the validated timing-catch method with common random numbers.

    Historical lap deviations are centered before sampling. Virtual Max is
    deterministic. One seeded set of observed-field paths is evaluated across
    every candidate delay, which makes the resulting probability curve
    monotonic by construction.
    """
    if not profiles:
        raise ValueError("No supported historical driver profiles are available.")
    observed_deviations = [float(value) for value in historical_deviations]
    variability = centered(observed_deviations)
    fastest_observed = min(profile.pace for profile in profiles)
    if field_variability_mode not in {"NOMINAL", "HISTORICAL_SEEDED"}:
        raise ValueError("Field variability mode must be NOMINAL or HISTORICAL_SEEDED.")
    if field_variability_mode == "HISTORICAL_SEEDED" and field_mode != "synthetic_100":
        raise ValueError("Historical seeded field variability is available for Synthetic 100 only.")
    if race_format == "TIMED_RACE":
        if race_duration_seconds is None:
            raise ValueError("TIMED_RACE requires raceDurationSeconds.")
        return run_timed_simulation(
            profiles, observed_deviations, race_duration_seconds=race_duration_seconds,
            virtual_max_advantage_seconds_per_lap=virtual_max_advantage_seconds_per_lap,
            starting_delay_seconds=starting_delay_seconds, field_mode=field_mode,
            race_model_mode=race_model_mode, field_variability_mode=field_variability_mode,
            field_variability_seed=field_variability_seed, timed_finish_rule=timed_finish_rule,
            pace_profile=pace_profile, traffic_cost_model=traffic_cost_model,
        )
    field = generate_synthetic_stress_field(profiles) if field_mode == "synthetic_100" else profiles
    lap_times_by_driver = empirical_lap_sequences(
        {profile.driver_id: profile.pace for profile in field}, observed_deviations, race_laps, field_variability_seed,
    ) if field_variability_mode == "HISTORICAL_SEEDED" else None
    source_distribution = deviation_distribution(observed_deviations)
    sampled_raw_deviations = [] if lap_times_by_driver is None else [
        lap_time - next(profile.pace for profile in field if profile.driver_id == driver_id) + float(source_distribution["mean"])
        for driver_id, lap_times in lap_times_by_driver.items() for lap_time in lap_times
    ]
    virtual_max_pace = fastest_observed - virtual_max_advantage_seconds_per_lap
    deterministic_max_delay = min(race_laps * (profile.pace - virtual_max_pace) for profile in field)

    rng = random.Random(SEED)
    margins_by_driver: list[list[float]] = [[] for _ in field]
    full_field_margins: list[float] = []
    for _ in range(simulations):
        margins = [
            sum(profile.pace + rng.choice(variability) for _ in range(race_laps)) - race_laps * virtual_max_pace
            for profile in field
        ]
        for index, margin in enumerate(margins):
            margins_by_driver[index].append(margin)
        full_field_margins.append(min(margins))

    curve = [
        {
            "delaySeconds": delay,
            "catchProbability": sum(margin >= delay for margin in full_field_margins) / simulations,
        }
        for delay in _delay_grid(full_field_margins, starting_delay_seconds)
    ]

    def threshold(target: float) -> float | None:
        eligible = [point["delaySeconds"] for point in curve if point["catchProbability"] >= target]
        return max(eligible) if eligible else None

    drivers = deterministic_driver_results(field, virtual_max_pace, starting_delay_seconds, race_laps)
    if lap_times_by_driver is not None:
        for driver in drivers:
            catch_time = seeded_timing_catch_time(
                lap_times_by_driver[str(driver["driverId"])], virtual_max_pace, starting_delay_seconds, race_laps,
            )
            catch_lap = None if catch_time is None else max(0.0, (catch_time - starting_delay_seconds) / virtual_max_pace)
            driver["catchLapExact"] = catch_lap
            driver["catchLapDisplay"] = None if catch_lap is None else math.ceil(catch_lap)
            driver["catchPossibleWithinRace"] = catch_time is not None
    for index, driver in enumerate(drivers):
        driver["catchProbability"] = sum(
            margin >= starting_delay_seconds for margin in margins_by_driver[index]
        ) / simulations

    normalized_profile, pure_timing, traffic_adjusted = build_race_assumption_comparison(
        [profile.pace for profile in field],
        race_laps=race_laps,
        base_virtual_max_pace=virtual_max_pace,
        starting_delay_seconds=starting_delay_seconds,
        pace_profile=pace_profile,
        traffic_cost_model=traffic_cost_model,
        field_lap_times=None if lap_times_by_driver is None else [lap_times_by_driver[profile.driver_id] for profile in field],
    )
    normalized_cost_model = traffic_cost_model or {
        "enabled": True,
        "earlyCostSecondsPerKart": 1.0,
        "lateCostSecondsPerKart": 0.2,
        "transitionStartLap": 1,
        "transitionEndLap": 7,
        "interpolation": "LINEAR",
    }
    result = {
        "mode": "custom",
        "scenarioType": "SYNTHETIC WHAT-IF",
        "fieldMode": field_mode,
        "fieldLabel": "Synthetic 100-driver stress test" if field_mode == "synthetic_100" else "Observed historical field",
        "fieldSize": len(field),
        "fieldEvidenceType": "SYNTHETIC" if field_mode == "synthetic_100" else "OBSERVED",
        "raceLaps": race_laps,
        "raceFormat": {"mode": "FIXED_LAPS", "durationSeconds": None, "finishRule": None},
        "terminalState": None,
        "simulations": simulations,
        "fastestObservedPace": fastest_observed,
        "virtualMaxAdvantageSecondsPerLap": virtual_max_advantage_seconds_per_lap,
        "virtualMaxPace": virtual_max_pace,
        "startingDelaySeconds": starting_delay_seconds,
        "deterministicMaxDelaySeconds": deterministic_max_delay,
        "fullFieldCatchProbability": sum(margin >= starting_delay_seconds for margin in full_field_margins) / simulations,
        "thresholds": {"p50": threshold(0.5), "p80": threshold(0.8), "p90": threshold(0.9)},
        "probabilityCurve": curve,
        "drivers": drivers,
        "timing": deterministic_timing_summary(
            drivers,
            race_laps=race_laps,
            virtual_max_pace=virtual_max_pace,
            starting_delay_seconds=starting_delay_seconds,
        ),
        "caveats": [
            "Timing catch only; not physical overtaking.",
            "Virtual Max is synthetic and not historical.",
            "Centered historical field variability is reused from observed data.",
        ] + (["Synthetic stress test generated from observed historical field distributions. It does not increase historical evidence or historical sample size."] if field_mode == "synthetic_100" else []) + (["Traffic-adjusted progression is an explicit deterministic scenario assumption, not physical passing telemetry."] if race_model_mode == "TRAFFIC_ADJUSTED" else []),
        "raceModel": {
            "mode": race_model_mode,
            "paceProfile": normalized_profile,
            "trafficCostModel": normalized_cost_model,
        },
        "pureTiming": pure_timing,
        "trafficAdjusted": traffic_adjusted if race_model_mode == "TRAFFIC_ADJUSTED" else None,
        "fieldVariability": {
            "mode": field_variability_mode,
            "seed": field_variability_seed,
            "sourceCount": len(observed_deviations),
            "methodology": "centered_empirical_bootstrap" if field_variability_mode == "HISTORICAL_SEEDED" else "none",
            "sourceMeanDeviationSeconds": float(source_distribution["mean"]),
            "appliedCenteringSeconds": float(source_distribution["mean"]) if field_variability_mode == "HISTORICAL_SEEDED" else 0.0,
            "bounds": None,
            "distribution": source_distribution,
            "sampleAudit": None if not sampled_raw_deviations else {
                "minimumEffectiveLapTimeSeconds": min(lap_time for laps in lap_times_by_driver.values() for lap_time in laps),
                "maximumEffectiveLapTimeSeconds": max(lap_time for laps in lap_times_by_driver.values() for lap_time in laps),
                "sampledDeviationsOver3Seconds": sum(value > 3 for value in sampled_raw_deviations),
                "sampledDeviationsOver5Seconds": sum(value > 5 for value in sampled_raw_deviations),
                "sampledDeviationsOver8Seconds": sum(value > 8 for value in sampled_raw_deviations),
            },
        },
    }
    if field_mode == "synthetic_100":
        result["syntheticReplay"] = synthetic_replay_contract(
            drivers,
            race_laps=race_laps,
            virtual_max_pace=virtual_max_pace,
            starting_delay_seconds=starting_delay_seconds,
            lap_times_by_driver=lap_times_by_driver,
            field_variability_mode=field_variability_mode,
            field_variability_seed=field_variability_seed,
        )
    return result
