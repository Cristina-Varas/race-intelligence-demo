"""Shared local/Workbench transformations over exclusively generated demo data."""
from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import math
from pathlib import Path
import random
from statistics import median

from .engine.simulation import HistoricalProfile, run_simulation

DATA_SEED = 20261013
EVIDENCE = "SYNTHETIC_DEMO"
RAW_KEYS = {"session_id", "driver_id", "lap", "lap_seconds", "evidence_type"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False)


def digest(value):
    return hashlib.sha256(canonical(value).encode()).hexdigest()


def generate_bronze():
    """No input files, names, locations, race timings or external services."""
    rng = random.Random(DATA_SEED)
    records = []
    for session in ("DEMO_A", "DEMO_B"):
        for driver in range(1, 17):
            for lap in range(1, 25):
                records.append({
                    "session_id": session, "driver_id": f"DEMO_{driver:03d}",
                    "lap": lap,
                    "lap_seconds": round(70 + driver * .37 + rng.uniform(-1.2, 1.2), 6),
                    "evidence_type": EVIDENCE,
                })
    return records


def build_silver(bronze):
    """Fail closed on malformed records, duplicates, missing rows or real inputs."""
    if len(bronze) != 768:
        raise ValueError("The public demo requires exactly 768 generated lap records.")
    seen, rows = set(), []
    for row in bronze:
        if set(row) != RAW_KEYS or row["evidence_type"] != EVIDENCE:
            raise ValueError("Only the public synthetic schema is allowed.")
        if row["session_id"] not in {"DEMO_A", "DEMO_B"}:
            raise ValueError("Unexpected session.")
        if row["driver_id"] not in {f"DEMO_{i:03d}" for i in range(1, 17)}:
            raise ValueError("Unexpected participant.")
        if type(row["lap"]) is not int or not 1 <= row["lap"] <= 24:
            raise ValueError("Invalid lap index.")
        pace = row["lap_seconds"]
        if type(pace) not in (int, float) or not math.isfinite(pace) or not 60 < pace < 90:
            raise ValueError("Invalid demo lap time.")
        key = row["session_id"], row["driver_id"], row["lap"]
        if key in seen:
            raise ValueError("Duplicate session / participant / lap.")
        seen.add(key)
        rows.append(dict(row))
    rows.sort(key=lambda row: (row["session_id"], row["driver_id"], row["lap"]))
    # A label alone is not sufficient: accept only this known generated dataset.
    if digest(rows) != digest(generate_bronze()):
        raise ValueError("Input is not the reproducible public synthetic dataset.")
    return rows


def build_gold(silver):
    rows = build_silver(silver)
    by_driver, by_session = defaultdict(list), defaultdict(list)
    for row in rows:
        by_driver[row["driver_id"]].append(row["lap_seconds"])
        by_session[(row["session_id"], row["driver_id"])].append(row["lap_seconds"])
    profiles = [{"driver_id": driver, "pace_seconds": median(values),
                 "lap_count": len(values), "evidence_type": EVIDENCE}
                for driver, values in sorted(by_driver.items())]
    deviations = [round(row["lap_seconds"] - median(by_session[(row["session_id"], row["driver_id"])]), 9)
                  for row in rows]
    return {"profiles": profiles, "deviations": deviations}


def simulate(gold, *, field_size=16, race_laps=30, advantage=.25, delay=5.0, simulations=1000):
    """Restricted public API around the retained original calculation engine.

    Legacy internal names containing 'historical' and 'virtual_max' are retained
    for calculation parity only. Every public input and output is synthetic.
    """
    if type(field_size) is not int or field_size not in {16, 100}:
        raise ValueError("field_size must be 16 or 100.")
    if type(race_laps) is not int or not 1 <= race_laps <= 60:
        raise ValueError("race_laps must be an integer from 1 to 60.")
    if type(simulations) is not int or not 100 <= simulations <= 5000:
        raise ValueError("simulations must be an integer from 100 to 5000.")
    for label, value, low, high in (("advantage", advantage, .05, 3), ("delay", delay, 0, 30)):
        if type(value) not in (int, float) or not math.isfinite(value) or not low <= value <= high:
            raise ValueError(f"{label} must be finite and between {low} and {high}.")
    result = run_simulation(
        [HistoricalProfile(p["driver_id"], p["pace_seconds"]) for p in gold["profiles"]],
        gold["deviations"], race_laps=race_laps,
        virtual_max_advantage_seconds_per_lap=advantage,
        starting_delay_seconds=delay, simulations=simulations,
        field_mode="synthetic_100" if field_size == 100 else "historical",
        pace_profile=[{"startLap": 1, "endLap": None, "paceAdjustmentPercent": 0}],
        traffic_cost_model={"enabled": False, "earlyCostSecondsPerKart": 0,
                            "lateCostSecondsPerKart": 0, "transitionStartLap": 1,
                            "transitionEndLap": 7, "interpolation": "LINEAR"},
    )
    # Expose a small, explicitly synthetic serving contract, not legacy labels.
    return {
        "evidence_type": EVIDENCE, "field_size": result["fieldSize"],
        "race_laps": race_laps, "simulations": simulations, "simulation_seed": 42,
        "advantage_seconds": advantage, "delay_seconds": delay,
        "challenger_pace_seconds": result["virtualMaxPace"],
        "deterministic_max_delay_seconds": result["deterministicMaxDelaySeconds"],
        "full_field_probability": result["fullFieldCatchProbability"],
        "thresholds": result["thresholds"], "curve": result["probabilityCurve"],
        "drivers": result["drivers"], "timing": result["timing"],
        "rank_trajectory": result["pureTiming"]["rankTrajectory"],
    }


def serving_document(bronze, silver, gold, *, execution="LOCAL_DEMO", simulations=1000):
    if execution not in {"LOCAL_DEMO", "AIDP_WORKBENCH"}:
        raise ValueError("Unknown execution environment.")
    if build_silver(bronze) != silver or build_gold(silver) != gold:
        raise ValueError("Layer parity validation failed.")
    return {
        "schema_version": 1, "evidence_type": EVIDENCE, "execution": execution,
        "data_seed": DATA_SEED, "bronze_sha256": digest(bronze),
        "silver_sha256": digest(silver), "gold_sha256": digest(gold),
        "counts": {"bronze": len(bronze), "silver": len(silver), "profiles": len(gold["profiles"])},
        "gold": gold,
        "scenarios": {str(size): simulate(gold, field_size=size, simulations=simulations) for size in (16, 100)},
        "limitations": ["All data are generated, not anonymized event records.",
                        "A timing catch is not a physical overtake.",
                        "Monte Carlo reports terminal cumulative timing-margin probability.",
                        "No LIVE connection or production performance validation."],
    }


def write_once(path, value):
    """Same bytes = safe rerun; different bytes = conflict, never overwrite."""
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (canonical(value) + "\n").encode()
    try:
        with path.open("xb") as output:
            output.write(payload)
    except FileExistsError:
        if path.read_bytes() != payload:
            raise ValueError(f"Conflicting artifact: {path.name}; choose a new output directory.")
    if path.read_bytes() != payload:
        raise ValueError("Artifact read-back mismatch.")


def build(output, simulations=1000):
    bronze = generate_bronze()
    silver = build_silver(bronze)
    gold = build_gold(silver)
    document = serving_document(bronze, silver, gold, simulations=simulations)
    for name, value in (("bronze/laps.json", bronze), ("silver/laps.json", silver),
                        ("gold/profiles.json", gold), ("serving/demo.json", document)):
        write_once(Path(output) / name, value)
    return document


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=Path("build/demo"))
    parser.add_argument("--simulations", type=int, default=1000)
    args = parser.parse_args()
    document = build(args.output, args.simulations)
    print(f"LOCAL_DEMO: {document['counts']}; serving artifact verified.")


if __name__ == "__main__":
    main()
