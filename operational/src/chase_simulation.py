"""Deterministic continuous-time timing-catch calculations.

This module models timing equality under constant representative lap paces.
It does not model physical overtakes, traffic, tyres, strategy, or randomness.
"""
from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd


TOLERANCE = 1e-9


def build_historical_field(profiles: pd.DataFrame) -> pd.DataFrame:
    """Return sufficiently-supported historical drivers only."""
    field = profiles.loc[profiles["support_status"].eq("sufficient"), ["driver_id", "pooled_median_pace", "pooled_rank", "pooled_valid_laps"]].copy()
    field = field.rename(columns={"pooled_median_pace": "base_pace_seconds", "pooled_rank": "historical_rank", "pooled_valid_laps": "support"})
    field["source_type"] = "historical"
    return field.sort_values("base_pace_seconds").reset_index(drop=True)


def driver_catches(field: pd.DataFrame, virtual_pace: float, start_delay: float, race_laps: int) -> pd.DataFrame:
    """Calculate continuous timing catches for every observed field driver.

    The finish boundary is completion of ``race_laps`` by Virtual Max. A
    positive pace advantage produces a catch after ``D / advantage`` Virtual
    Max laps.  A same-pace driver can only be caught at zero delay, where both
    begin in timing equality at t=0.
    """
    if start_delay < -TOLERANCE:
        raise ValueError("Start delay cannot be negative")
    result = field.copy()
    result["virtual_max_pace_seconds"] = float(virtual_pace)
    result["pace_advantage_seconds_per_lap"] = result["base_pace_seconds"] - virtual_pace
    advantage = result["pace_advantage_seconds_per_lap"].to_numpy(float)
    catch_lap = np.full(len(result), np.inf)
    faster = advantage > TOLERANCE
    catch_lap[faster] = start_delay / advantage[faster]
    same_pace = np.abs(advantage) <= TOLERANCE
    catch_lap[same_pace & (start_delay <= TOLERANCE)] = 0.0
    result["catch_lap_equivalent"] = catch_lap
    result["catch_time_seconds"] = np.where(np.isfinite(catch_lap), start_delay + catch_lap * virtual_pace, np.nan)
    result["caught_before_finish"] = np.isfinite(catch_lap) & (catch_lap <= race_laps + TOLERANCE)
    result["timing_margin_at_finish"] = race_laps * advantage - start_delay
    result["start_delay_seconds"] = float(start_delay)
    return result


def analytical_maximum_delay(field: pd.DataFrame, virtual_pace: float, race_laps: int) -> dict[str, object]:
    """Closed-form full-field maximum delay and its constraining driver."""
    advantages = field["base_pace_seconds"] - virtual_pace
    slower = advantages < -TOLERANCE
    if slower.any():
        driver = field.loc[slower].sort_values("base_pace_seconds").iloc[0]
        return {"possible": False, "maximum_delay": np.nan, "hardest_driver_id": driver.driver_id, "reason": "Virtual Max is slower than an observed field driver"}
    permissible = (race_laps * advantages).clip(lower=0.0)
    idx = permissible.idxmin()
    return {"possible": True, "maximum_delay": float(permissible.loc[idx]), "hardest_driver_id": field.loc[idx, "driver_id"], "reason": "closed_form"}


def numerical_maximum_delay(field: pd.DataFrame, virtual_pace: float, race_laps: int, tolerance: float = 1e-7) -> float:
    """Bisection feasibility check against end-of-race continuous margins."""
    closed = analytical_maximum_delay(field, virtual_pace, race_laps)
    if not closed["possible"]:
        return np.nan
    advantages = field["base_pace_seconds"].to_numpy(float) - virtual_pace
    low, high = 0.0, float(max(1.0, race_laps * advantages.max() + 1.0))
    while high - low > tolerance:
        candidate = (low + high) / 2
        # Numerical race-finish feasibility: all continuous timing margins >= 0.
        if np.all(race_laps * advantages - candidate >= -tolerance):
            low = candidate
        else:
            high = candidate
    return low


def scenario_summary(field: pd.DataFrame, virtual_pace: float, assumed_advantage: float, race_laps: int, scenario_id: str) -> tuple[pd.DataFrame, pd.DataFrame, dict[str, object]]:
    """Build one summary row and the corresponding driver-level catches."""
    solution = analytical_maximum_delay(field, virtual_pace, race_laps)
    delay = float(solution["maximum_delay"]) if solution["possible"] else 0.0
    catches = driver_catches(field, virtual_pace, delay, race_laps)
    caught = catches.loc[catches.caught_before_finish].sort_values(["catch_time_seconds", "driver_id"])
    last = caught.iloc[-1] if not caught.empty else None
    finish_margin = float(catches.timing_margin_at_finish.min())
    summary = pd.DataFrame([{
        "scenario_id": scenario_id, "race_laps": race_laps,
        "assumed_advantage_seconds_per_lap": assumed_advantage,
        "virtual_max_pace_seconds": virtual_pace, "field_size": len(field),
        "maximum_start_delay_seconds": solution["maximum_delay"],
        "full_field_catch_possible": solution["possible"],
        "hardest_driver_id": solution["hardest_driver_id"],
        "last_catch_time_seconds": None if last is None else last.catch_time_seconds,
        "last_catch_lap_equivalent": None if last is None else last.catch_lap_equivalent,
        "finish_margin_seconds": finish_margin,
        "historical_or_synthetic": "synthetic scenario over historical field",
    }])
    catches.insert(0, "scenario_id", scenario_id)
    catches = catches.rename(columns={"base_pace_seconds": "driver_pace_seconds"})
    return summary, catches, solution


def save_chase_figures(root: Path, field: pd.DataFrame, default_catches: pd.DataFrame, virtual_pace: float, advantage_sensitivity: pd.DataFrame, length_sensitivity: pd.DataFrame) -> None:
    from aidp_environment import optional_matplotlib
    plt = optional_matplotlib(backend="Agg")
    if plt is None:
        return
    root = Path(root); figures = root / "outputs/figures"; figures.mkdir(parents=True, exist_ok=True)
    ranked = field.sort_values("base_pace_seconds")
    fig, ax = plt.subplots(figsize=(8, 4.8)); ax.scatter(ranked.base_pace_seconds, ranked.driver_id.astype(str), color="#1f4e79", label="Historical observed drivers")
    ax.axvline(virtual_pace, color="#c8102e", lw=2, label="Synthetic Virtual Max")
    ax.set(xlabel="Representative base pace (s; lower is faster)", ylabel="Historical driver ID", title="Observed field and synthetic Virtual Max"); ax.legend(); fig.tight_layout(); fig.savefig(figures / "deterministic_field_pace.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 4)); y=advantage_sensitivity.maximum_start_delay_seconds
    ax.plot(advantage_sensitivity.assumed_advantage_seconds_per_lap, y, marker="o", color="#c8102e"); ax.set(xlabel="Assumed Virtual Max advantage (s/lap)", ylabel="Maximum deterministic start delay (s)", title="Maximum delay by synthetic pace advantage"); fig.tight_layout(); fig.savefig(figures / "maximum_delay_by_advantage.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 4))
    for advantage, group in length_sensitivity.groupby("assumed_advantage_seconds_per_lap"):
        ax.plot(group.race_laps, group.maximum_start_delay_seconds, marker="o", label=f"{advantage:.3f} s/lap")
    ax.set(xlabel="Race length (laps)", ylabel="Maximum deterministic start delay (s)", title="Maximum delay by race length"); ax.legend(title="Synthetic advantage"); fig.tight_layout(); fig.savefig(figures / "maximum_delay_by_race_length.png", dpi=160); plt.close(fig)
    ordered = default_catches.loc[default_catches.caught_before_finish].sort_values("catch_lap_equivalent").reset_index(drop=True)
    fig, ax = plt.subplots(figsize=(8, 5)); ax.hlines(range(len(ordered)), 0, ordered.catch_lap_equivalent, color="#b9c8d5"); ax.scatter(ordered.catch_lap_equivalent, range(len(ordered)), color="#c8102e")
    ax.set(yticks=range(len(ordered)), yticklabels=ordered.driver_id.astype(str), xlabel="Virtual Max lap equivalent at timing catch", ylabel="Observed driver ID (catch order)", title="Default-scenario timing-catch sequence"); fig.tight_layout(); fig.savefig(figures / "default_catch_timeline.png", dpi=160); plt.close(fig)
