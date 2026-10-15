"""Transparent historical profiles and Virtual Max scenario assumptions.

The observed profile table is derived exclusively from supplied R1/R2 timing
data.  The Virtual Max table is a separate, synthetic scenario artifact and
must never be merged into historical Silver data.
"""
from __future__ import annotations

from pathlib import Path
import re
import numpy as np
import pandas as pd

from data_utils import read_parquet_portable, write_csv_portable, write_parquet_portable
from pace_model import robust_session_mad_mask


RACE_SESSIONS = ("R1", "R2")


def _settings(root: Path) -> dict:
    """Read the small scalar scenario block without adding a YAML dependency."""
    text = (root / "config/settings.yaml").read_text()
    block = text.split("  virtual_max:", 1)[1]
    def scalar(name: str, cast):
        match = re.search(rf"^    {name}:\s*([^#\n]+)", block, flags=re.MULTILINE)
        if not match:
            raise KeyError(f"Missing scenario.virtual_max.{name}")
        return cast(match.group(1).strip().strip('\\\"'))
    grid = scalar("sensitivity_advantages_seconds_per_lap", str).strip("[]")
    return {
        "reference_support_min_laps": scalar("reference_support_min_laps", int),
        "default_advantage_source": scalar("default_advantage_source", str),
        "sensitivity_advantages_seconds_per_lap": [float(item.strip()) for item in grid.split(",")],
        "scenario_race_laps": scalar("scenario_race_laps", int),
        "future_synthetic_field_size": scalar("future_synthetic_field_size", int),
    }


def build_observed_driver_profiles(root: Path) -> pd.DataFrame:
    """Create robust, R1/R2-only historical driver profiles.

    Rule B from Notebook 03 (positive non-pit laps within four session MADs)
    is used throughout.  A driver is sufficiently supported when their pooled
    retained R1/R2 lap count reaches the configured threshold.
    """
    root = Path(root)
    minimum_support = int(_settings(root)["reference_support_min_laps"])
    laps = read_parquet_portable(root / "data/processed/race_state.parquet")
    laps = laps.loc[laps["session"].isin(RACE_SESSIONS)].copy()
    laps["robust_pace_lap"] = robust_session_mad_mask(laps)
    laps = laps.loc[laps["robust_pace_lap"]].copy()

    session = laps.groupby(["driver_id", "session"])["lap_time_seconds"].agg(
        valid_laps="size", median_pace="median"
    ).unstack("session")
    session.columns = [f"{race}_{metric}" for metric, race in session.columns]
    pooled = laps.groupby("driver_id")["lap_time_seconds"].agg(
        pooled_valid_laps="size",
        pooled_median_pace="median",
        pooled_MAD=lambda x: (x - x.median()).abs().median(),
        pooled_IQR=lambda x: x.quantile(0.75) - x.quantile(0.25),
    )
    profiles = pooled.join(session, how="outer")
    profiles = profiles.reset_index()
    profiles["support_status"] = np.where(
        profiles["pooled_valid_laps"].ge(minimum_support), "sufficient", "insufficient"
    )
    profiles["pooled_rank"] = np.nan
    supported = profiles["support_status"].eq("sufficient")
    profiles.loc[supported, "pooled_rank"] = (
        profiles.loc[supported, "pooled_median_pace"].rank(method="min").astype(int)
    )
    columns = [
        "driver_id", "R1_valid_laps", "R2_valid_laps", "pooled_valid_laps",
        "R1_median_pace", "R2_median_pace", "pooled_median_pace", "pooled_MAD",
        "pooled_IQR", "pooled_rank", "support_status",
    ]
    profiles = profiles[columns].sort_values(["pooled_rank", "pooled_median_pace"], na_position="last")
    processed, tables = root / "data/processed", root / "outputs/tables"
    processed.mkdir(parents=True, exist_ok=True)
    tables.mkdir(parents=True, exist_ok=True)
    write_parquet_portable(profiles, processed / "observed_driver_profiles.parquet", index=False)
    write_csv_portable(profiles, tables / "observed_driver_profiles.csv", index=False)
    return profiles


def build_virtual_max_scenario(root: Path, profiles: pd.DataFrame | None = None) -> dict[str, object]:
    """Persist one synthetic profile plus scenario assumptions and dictionary."""
    root = Path(root)
    settings = _settings(root)
    profiles = build_observed_driver_profiles(root) if profiles is None else profiles.copy()
    eligible = profiles.loc[profiles["support_status"].eq("sufficient")].sort_values("pooled_median_pace")
    if len(eligible) < 2:
        raise ValueError("At least two sufficiently-supported observed drivers are required")
    fastest, second = eligible.iloc[0], eligible.iloc[1]
    p1_p2_gap = float(second.pooled_median_pace - fastest.pooled_median_pace)
    default_advantage = p1_p2_gap
    virtual_pace = float(fastest.pooled_median_pace - default_advantage)
    sensitivity = sorted({0.0, *map(float, settings["sensitivity_advantages_seconds_per_lap"]), default_advantage})

    virtual = pd.DataFrame([{
        "scenario_driver_id": "VIRTUAL_MAX",
        "scenario_label": "Virtual Max (default scenario)",
        "reference_driver_id": int(fastest.driver_id),
        "reference_pace_seconds": float(fastest.pooled_median_pace),
        "assumed_advantage_seconds_per_lap": default_advantage,
        "virtual_max_pace_seconds": virtual_pace,
        "assumption_source": "Observed robust P1/P2 difference; scenario proxy only",
        "scenario_type": "synthetic",
    }])
    historical_lengths = read_parquet_portable(root / "data/processed/race_state.parquet").query("session in ['R1', 'R2']").groupby("session").lap_number.max().to_dict()
    assumptions = pd.DataFrame([
        ("fastest_observed_pace_seconds", float(fastest.pooled_median_pace), "R1/R2 robust observed driver profile", "historical", "Fastest sufficiently-supported observed pooled median pace", "Observed field only; not Virtual Max."),
        ("second_fastest_observed_pace_seconds", float(second.pooled_median_pace), "R1/R2 robust observed driver profile", "historical", "Second-fastest sufficiently-supported observed pooled median pace", "Observed field only; not Virtual Max."),
        ("observed_p1_p2_difference_seconds_per_lap", p1_p2_gap, "Difference between the two observed references", "historical", "Robust observed P1/P2 pace separation", "A small number of races; not a universal gap."),
        ("default_virtual_max_advantage_seconds_per_lap", default_advantage, "Configured dynamic source: observed robust P1/P2 difference", "synthetic", "Default assumed Virtual Max advantage", "Scenario proxy, not a Verstappen estimate."),
        ("virtual_max_default_pace_seconds", virtual_pace, "Fastest observed pace minus assumed advantage", "synthetic", "Synthetic Virtual Max base pace", "Not measured or trained from Max data."),
        ("historical_R1_laps", int(historical_lengths.get("R1", 0)), "Observed maximum lap number", "historical", "Historical R1 length", "Do not treat as future race length."),
        ("historical_R2_laps", int(historical_lengths.get("R2", 0)), "Observed maximum lap number", "historical", "Historical R2 length", "Do not treat as future race length."),
        ("scenario_race_laps", int(settings["scenario_race_laps"]), "config/settings.yaml", "synthetic", "Future synthetic extended-race assumption", "Not historical evidence."),
        ("future_synthetic_field_size", int(settings["future_synthetic_field_size"]), "config/settings.yaml", "synthetic", "Potential later stress-test field size", "Does not create historical evidence or independent races."),
        ("pace_engine", "previous_lap_time", "Notebook 04 R1→R2 selection", "historical_model", "Selected observed-driver pace engine", "Not a Virtual Max model."),
        ("residual_uncertainty_status", "Uncalibrated for simulation", "Notebook 04 small R2 holdout", "historical_model", "Empirical holdout residuals exist", "Not yet a calibrated simulation noise model."),
    ], columns=["parameter", "value", "source", "historical_or_synthetic", "description", "caveat"])
    dictionary = pd.DataFrame([
        ("observed_driver_profiles", "driver_id", "historical field", "Source identifier for a measured driver."),
        ("observed_driver_profiles", "pooled_median_pace", "historical field", "Robust R1/R2 observed median lap pace."),
        ("observed_driver_profiles", "support_status", "historical field", "Whether pooled valid-lap support reaches the configured threshold."),
        ("virtual_max_profile", "scenario_driver_id", "synthetic output", "Fixed identifier VIRTUAL_MAX; never a historical driver ID."),
        ("virtual_max_profile", "assumed_advantage_seconds_per_lap", "scenario parameter", "Hypothetical pace advantage over the fastest observed driver."),
        ("virtual_max_profile", "virtual_max_pace_seconds", "synthetic output", "Reference pace minus the scenario advantage."),
        ("scenario", "scenario_race_laps", "scenario parameter", "Future extended-race length assumption."),
    ], columns=["table_or_scope", "field", "classification", "description"])
    tables, processed = root / "outputs/tables", root / "data/processed"
    write_parquet_portable(virtual, processed / "virtual_max_profile.parquet", index=False)
    write_csv_portable(assumptions, tables / "virtual_max_scenario_assumptions.csv", index=False)
    write_csv_portable(dictionary, tables / "scenario_data_dictionary.csv", index=False)
    return {"profiles": profiles, "virtual_profile": virtual, "assumptions": assumptions,
            "data_dictionary": dictionary, "sensitivity_advantages": sensitivity,
            "historical_lengths": historical_lengths, "fastest": fastest, "second": second,
            "p1_p2_gap": p1_p2_gap}


def save_scenario_figures(root: Path, result: dict[str, object]) -> None:
    """Save presentation-ready historical/synthetic separation figures."""
    from aidp_environment import optional_matplotlib
    plt = optional_matplotlib(backend="Agg")
    if plt is None:
        return
    root = Path(root); figures = root / "outputs/figures"; figures.mkdir(parents=True, exist_ok=True)
    profiles, virtual = result["profiles"], result["virtual_profile"].iloc[0]
    observed = profiles.query("support_status == 'sufficient'").sort_values("pooled_median_pace")
    fastest, second = result["fastest"], result["second"]
    fig, ax = plt.subplots(figsize=(9, 4.8))
    ax.scatter(observed.pooled_median_pace, observed.driver_id.astype(str), color="#1f4e79", label="Observed drivers")
    ax.axvline(float(fastest.pooled_median_pace), color="#1f4e79", ls="--", label="Observed fastest")
    ax.axvline(float(second.pooled_median_pace), color="#6388a8", ls="--", label="Observed second-fastest")
    ax.axvline(float(virtual.virtual_max_pace_seconds), color="#c8102e", lw=2, label="Synthetic Virtual Max")
    ax.set(xlabel="Pooled median lap pace (s; lower is faster)", ylabel="Observed driver ID", title="Observed R1/R2 pace field and synthetic reference")
    ax.legend(); fig.tight_layout(); fig.savefig(figures / "virtual_max_observed_field_reference.png", dpi=160); plt.close(fig)
    advantages = result["sensitivity_advantages"]
    reference = float(fastest.pooled_median_pace)
    fig, ax = plt.subplots(figsize=(7, 4))
    ax.plot(advantages, [reference - x for x in advantages], marker="o", color="#c8102e")
    ax.set(xlabel="Assumed advantage (s/lap)", ylabel="Synthetic Virtual Max base pace (s)", title="Virtual Max pace sensitivity (deterministic)")
    ax.invert_yaxis(); fig.tight_layout(); fig.savefig(figures / "virtual_max_advantage_sensitivity.png", dpi=160); plt.close(fig)
