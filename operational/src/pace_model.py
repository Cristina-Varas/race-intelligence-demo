"""Leakage-safe, observed-driver next-lap pace modelling utilities.

The target is lap t.  Every feature is calculated from laps strictly before t;
this module deliberately never reads classification or a target-lap field when
building predictors.
"""
from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd

from data_utils import read_parquet_portable, write_csv_portable, write_parquet_portable

TARGET = "target_lap_time_seconds"
KEYS = ["session", "driver_id", "target_lap_number"]
HISTORY = ["driver_prior_median", "driver_prior_mean", "driver_prior_mad", "history_depth"]
RECENT = ["previous_lap_time", "rolling_3_median", "rolling_3_mean", "rolling_3_std", "previous_lap_deviation_from_driver_prior_median"]
SECTORS = ["previous_sector1", "previous_sector2", "previous_sector3"]
STATE = ["previous_lap_position", "previous_gap_to_leader"]
WEATHER = ["air_temp", "humidity", "pressure", "rain", "wind_speed", "wind_direction"]
FEATURE_SETS = {
    "history": HISTORY + ["target_lap_number", "race_phase"],
    "history_recent": HISTORY + RECENT + ["target_lap_number", "race_phase"],
    "history_recent_sectors": HISTORY + RECENT + SECTORS + ["target_lap_number", "race_phase"],
    "history_recent_sectors_state": HISTORY + RECENT + SECTORS + STATE + ["target_lap_number", "race_phase"],
}


def robust_session_mad_mask(frame: pd.DataFrame) -> pd.Series:
    """Return rule B from Notebook 03: positive non-pit laps within 4 session MAD."""
    base = frame["lap_time_seconds"].gt(0) & ~frame["is_pit_lap"].fillna(False)
    values = frame.loc[base, ["session", "lap_time_seconds"]]
    median = values.groupby("session")["lap_time_seconds"].transform("median")
    mad = values.groupby("session")["lap_time_seconds"].transform(
        lambda x: (x - x.median()).abs().median()
    )
    keep = pd.Series(False, index=frame.index)
    keep.loc[base] = (values["lap_time_seconds"] - median).abs().le(4 * mad.replace(0, np.inf))
    return keep


def build_next_lap_model_table(race_state: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Create retained model rows and an explicit candidate/exclusion audit.

    Rule B (session-level 4xMAD) controls both valid target laps and the
    historical pace series.  A retained row additionally needs a prior robust
    lap for that driver in that session.
    """
    source = race_state.sort_values(["session", "driver_id", "lap_number"]).copy()
    source["robust_pace_lap"] = robust_session_mad_mask(source)
    records: list[dict] = []
    audit: list[dict] = []
    for (session, driver_id), group in source.groupby(["session", "driver_id"], sort=False):
        history: list[float] = []
        max_lap = group["lap_number"].max()
        previous = None
        for row in group.itertuples(index=False):
            candidate = True
            reason = "retained"
            if not bool(row.robust_pace_lap):
                reason = "invalid_or_pit_or_robust_outlier_target"
            elif not history:
                reason = "no_prior_robust_driver_lap"
            audit.append({"session": session, "driver_id": driver_id, "target_lap_number": row.lap_number,
                          "candidate": candidate, "retained": reason == "retained", "reason": reason})
            if reason == "retained":
                prior = np.asarray(history, dtype=float)
                prior_median = float(np.median(prior))
                prior_mad = float(np.median(np.abs(prior - prior_median)))
                recent = prior[-3:]
                record = {
                    "session": session, "driver_id": driver_id, "target_lap_number": row.lap_number,
                    TARGET: row.lap_time_seconds, "target_rule": "B_session_mad_4x",
                    "driver_prior_median": prior_median, "driver_prior_mean": float(prior.mean()),
                    "driver_prior_mad": prior_mad, "history_depth": len(prior),
                    "previous_lap_time": previous.lap_time_seconds if previous is not None else np.nan,
                    "rolling_3_median": float(np.median(recent)), "rolling_3_mean": float(recent.mean()),
                    "rolling_3_std": float(recent.std(ddof=0)),
                    "previous_lap_deviation_from_driver_prior_median": (
                        previous.lap_time_seconds - prior_median if previous is not None else np.nan
                    ),
                    "target_lap_number": row.lap_number,
                    "race_phase": float(row.lap_number / max_lap),
                    "previous_sector1": previous.sector1_seconds if previous is not None else np.nan,
                    "previous_sector2": previous.sector2_seconds if previous is not None else np.nan,
                    "previous_sector3": previous.sector3_seconds if previous is not None else np.nan,
                    "previous_lap_position": previous.lap_position if previous is not None else np.nan,
                    "previous_gap_to_leader": previous.gap_to_leader_seconds if previous is not None else np.nan,
                    # Weather is contemporaneous with the prior observed state, never target-lap weather.
                    "air_temp": previous.air_temp if previous is not None else np.nan,
                    "humidity": previous.humidity if previous is not None else np.nan,
                    "pressure": previous.pressure if previous is not None else np.nan,
                    "rain": previous.rain if previous is not None else np.nan,
                    "wind_speed": previous.wind_speed if previous is not None else np.nan,
                    "wind_direction": previous.wind_direction if previous is not None else np.nan,
                }
                records.append(record)
            if bool(row.robust_pace_lap):
                history.append(float(row.lap_time_seconds))
            previous = row
    table = pd.DataFrame(records)
    audit_frame = pd.DataFrame(audit)
    if not table.empty and table.duplicated(KEYS).any():
        raise ValueError("Next-lap table does not have a unique target grain")
    return table, audit_frame


def _metric_row(actual: pd.Series, prediction: pd.Series, label: str, feature_set: str = "baseline") -> dict:
    error = prediction.to_numpy() - actual.to_numpy()
    return {"model_name": label, "feature_set": feature_set, "rows": len(actual),
            "MAE": float(np.mean(np.abs(error))), "RMSE": float(np.sqrt(np.mean(error**2))),
            "MedianAE": float(np.median(np.abs(error))), "bias": float(np.mean(error))}


def select_pace_engine(baseline_metrics: list[dict], ml_metrics: list[dict], minimum_mae_gain: float = 0.02) -> dict:
    """Choose the simplest engine unless ML materially improves R2 MAE.

    This selection is deliberately based on evaluated candidates, not a
    hard-coded engine name.  An ML candidate needs to improve on the strongest
    baseline by more than ``minimum_mae_gain`` seconds to justify complexity.
    """
    strongest_baseline = min(baseline_metrics, key=lambda row: row["MAE"])
    best_ml = min(ml_metrics, key=lambda row: row["MAE"])
    ml_beats_baseline = best_ml["MAE"] < strongest_baseline["MAE"] - minimum_mae_gain
    selected = best_ml if ml_beats_baseline else strongest_baseline
    return {
        "selected": selected,
        "selected_type": "model" if ml_beats_baseline else "baseline",
        "strongest_baseline": strongest_baseline,
        "best_ml": best_ml,
        "ml_beats_baseline": ml_beats_baseline,
    }


def _fit_predict(model_name: str, features: list[str], train: pd.DataFrame, test: pd.DataFrame) -> tuple[np.ndarray, object]:
    from sklearn.compose import TransformedTargetRegressor
    from sklearn.impute import SimpleImputer
    from sklearn.linear_model import HuberRegressor, Ridge
    from sklearn.pipeline import Pipeline
    from sklearn.preprocessing import StandardScaler
    from sklearn.ensemble import HistGradientBoostingRegressor

    if model_name == "HuberRegressor":
        estimator = HuberRegressor(epsilon=1.35, max_iter=500)
        model = Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)),
                          ("scale", StandardScaler()), ("model", estimator)])
    elif model_name == "Ridge":
        model = Pipeline([("impute", SimpleImputer(strategy="median", add_indicator=True)),
                          ("scale", StandardScaler()), ("model", Ridge(alpha=10.0))])
    elif model_name == "HistGradientBoosting":
        model = HistGradientBoostingRegressor(max_iter=100, max_leaf_nodes=7, l2_regularization=2.0, random_state=42)
    else:
        raise ValueError(model_name)
    model.fit(train[features], train[TARGET])
    return model.predict(test[features]), model


def run_pace_model_pipeline(root: Path) -> dict[str, pd.DataFrame | str]:
    """Build data, evaluate chronological R1 -> R2 experiment, and persist outputs."""
    root = Path(root)
    processed, tables, figures = root / "data/processed", root / "outputs/tables", root / "outputs/figures"
    tables.mkdir(parents=True, exist_ok=True); figures.mkdir(parents=True, exist_ok=True)
    source = read_parquet_portable(processed / "race_state.parquet")
    table, audit = build_next_lap_model_table(source)
    write_parquet_portable(table, processed / "next_lap_model_table.parquet", index=False)
    quality = audit.groupby(["session", "reason"], as_index=False).agg(candidate_rows=("candidate", "sum"), rows=("reason", "size"))
    feature_columns = [column for column in table.columns if column not in KEYS + [TARGET, "target_rule"]]
    missing = table.groupby("session")[feature_columns].apply(
        lambda g: g.isna().mean().mean()
    ).rename("mean_feature_missingness").reset_index()
    quality = quality.merge(missing, on="session", how="left")
    quality["duplicate_keys"] = int(table.duplicated(KEYS).sum())
    write_csv_portable(quality, tables / "next_lap_model_table_quality.csv", index=False)

    train, test = table.query("session == 'R1'").copy(), table.query("session == 'R2'").copy()
    if train.empty or test.empty or set(train.session) & set(test.session): raise ValueError("Expected disjoint non-empty R1 and R2 sets")
    train_median = train[TARGET].median()
    baseline_predictions = {
        "train_R1_median": pd.Series(train_median, index=test.index),
        "driver_prior_median": test["driver_prior_median"],
        "rolling_3_median": test["rolling_3_median"],
        "previous_lap_time": test["previous_lap_time"],
    }
    baseline_metrics = [_metric_row(test[TARGET], prediction, name) for name, prediction in baseline_predictions.items() if prediction.notna().all()]
    metrics = baseline_metrics.copy()
    comparisons: list[dict] = []
    fitted: dict[tuple[str, str], object] = {}
    predictions: dict[tuple[str, str], np.ndarray] = {}
    for feature_set, features in FEATURE_SETS.items():
        for model_name in ("HuberRegressor", "Ridge", "HistGradientBoosting"):
            prediction, model = _fit_predict(model_name, features, train, test)
            row = _metric_row(test[TARGET], pd.Series(prediction, index=test.index), model_name, feature_set)
            metrics.append(row); comparisons.append(row); fitted[(model_name, feature_set)] = model; predictions[(model_name, feature_set)] = prediction
    comparison = pd.DataFrame(comparisons).sort_values("MAE")
    write_csv_portable(comparison, tables / "feature_set_comparison.csv", index=False)
    metrics_frame = pd.DataFrame(metrics).sort_values("MAE")
    write_csv_portable(metrics_frame, tables / "pace_model_metrics.csv", index=False)
    best_core = comparison.iloc[0]
    best_name, best_set = str(best_core.model_name), str(best_core.feature_set)
    weather_features = FEATURE_SETS[best_set] + WEATHER
    weather_prediction, weather_model = _fit_predict(best_name, weather_features, train, test)
    weather_metric = _metric_row(test[TARGET], pd.Series(weather_prediction, index=test.index), best_name, best_set + "_weather")
    weather_metric["experiment"] = "weather_ablation"
    metrics_frame = pd.concat([metrics_frame, pd.DataFrame([weather_metric])], ignore_index=True)
    write_csv_portable(metrics_frame, tables / "pace_model_metrics.csv", index=False)
    use_weather = weather_metric["MAE"] < float(best_core.MAE) - 0.02
    all_ml_metrics = comparisons + [weather_metric]
    selection = select_pace_engine(baseline_metrics, all_ml_metrics)
    selected_metric = selection["selected"]
    selected_type = selection["selected_type"]
    strongest_baseline, best_ml = selection["strongest_baseline"], selection["best_ml"]
    selected_pace_engine = str(selected_metric["model_name"])
    if selected_type == "baseline":
        selected_features = [selected_pace_engine]
        selected_prediction = baseline_predictions[selected_pace_engine].to_numpy()
    elif selected_metric["feature_set"] == best_set + "_weather":
        selected_features, selected_prediction = weather_features, weather_prediction
    else:
        selected_features = FEATURE_SETS[str(selected_metric["feature_set"])]
        selected_prediction = predictions[(selected_pace_engine, str(selected_metric["feature_set"]))]
    residuals = test[KEYS].copy(); residuals["actual"] = test[TARGET].to_numpy(); residuals["prediction"] = selected_prediction; residuals["residual"] = residuals["prediction"] - residuals["actual"]
    write_parquet_portable(residuals, processed / "pace_model_residuals.parquet", index=False)
    quantiles = residuals.residual.quantile([.1, .25, .5, .75, .9])
    lo, hi = float(quantiles.loc[.1]), float(quantiles.loc[.9])
    coverage = float(((residuals.actual >= residuals.prediction - hi) & (residuals.actual <= residuals.prediction - lo)).mean())
    card = pd.DataFrame([{"pace_engine_name": selected_pace_engine, "pace_engine_type": selected_type,
        "training_session": "R1", "test_session": "R2", "target": TARGET, "rows": len(test), "features": ", ".join(selected_features),
        "MAE": selected_metric["MAE"], "RMSE": selected_metric["RMSE"], "MedianAE": selected_metric["MedianAE"], "bias": selected_metric["bias"],
        "best_ml_model": best_ml["model_name"], "best_ml_feature_set": best_ml["feature_set"], "best_ml_MAE": best_ml["MAE"],
        "strongest_baseline": strongest_baseline["model_name"], "strongest_baseline_MAE": strongest_baseline["MAE"],
        "ML_improvement_vs_baseline_pct": 100 * (strongest_baseline["MAE"] - best_ml["MAE"]) / strongest_baseline["MAE"],
        "selected": True, "weather_selected": use_weather and selected_type == "model", "model_beats_baseline": selection["ml_beats_baseline"], "residual_P10": lo, "residual_P25": float(quantiles.loc[.25]), "residual_P50": float(quantiles.loc[.5]), "residual_P75": float(quantiles.loc[.75]), "residual_P90": hi,
        "empirical_R2_band_coverage": coverage, "limitations": "Small R1-to-R2 holdout; observed drivers only; not production generalization."}])
    write_csv_portable(card, tables / "pace_model_card.csv", index=False)
    _save_figures(residuals, metrics_frame, figures, selected_pace_engine)
    return {"table": table, "quality": quality, "metrics": metrics_frame, "comparison": comparison, "card": card, "residuals": residuals, "selected_pace_engine": selected_pace_engine}


def _save_figures(residuals: pd.DataFrame, metrics: pd.DataFrame, figures: Path, pace_engine_name: str) -> None:
    from aidp_environment import optional_matplotlib
    plt = optional_matplotlib(backend="Agg")
    if plt is None:
        return
    title_suffix = f"Selected pace engine: {pace_engine_name}"
    fig, ax = plt.subplots(figsize=(6, 5)); ax.scatter(residuals.actual, residuals.prediction, alpha=.75); lo=min(residuals.actual.min(),residuals.prediction.min()); hi=max(residuals.actual.max(),residuals.prediction.max()); ax.plot([lo,hi],[lo,hi],"k--",lw=1); ax.set(xlabel="Actual lap time (s)",ylabel="Predicted lap time (s)",title=f"R2 actual vs predicted\n{title_suffix}"); fig.tight_layout(); fig.savefig(figures / "model_actual_vs_predicted.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(6, 4)); ax.hist(residuals.residual, bins=12, color="#c8102e", alpha=.8); ax.axvline(0,color="black",lw=1); ax.set(xlabel="Residual (prediction − actual, s)",title=f"R2 residual distribution\n{title_suffix}"); fig.tight_layout(); fig.savefig(figures / "model_residual_distribution.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(6, 4)); ax.scatter(residuals.prediction, residuals.residual, alpha=.75); ax.axhline(0,color="black",lw=1); ax.set(xlabel="Predicted lap time (s)",ylabel="Residual (s)",title="R2 residual vs predicted pace"); fig.tight_layout(); fig.savefig(figures / "model_residual_vs_predicted.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 4)); core=metrics[metrics.feature_set.ne("baseline") & ~metrics.feature_set.str.contains("weather")].copy(); labels=core.model_name + "\n" + core.feature_set; ax.bar(range(len(core)),core.MAE,color="#1f4e79"); ax.set(xticks=range(len(core)),xticklabels=labels,ylabel="R2 MAE (s)",title="Feature-set and model comparison"); ax.tick_params(axis="x",labelrotation=75); fig.tight_layout(); fig.savefig(figures / "feature_set_comparison.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(7, 4)); by=residuals.assign(abs_error=residuals.residual.abs()).groupby("driver_id").abs_error.mean().sort_values(); ax.bar(by.index.astype(str),by.values,color="#c8102e"); ax.set(xlabel="Driver ID",ylabel="Mean absolute error (s)",title=f"R2 error by observed driver\n{title_suffix}"); fig.tight_layout(); fig.savefig(figures / "model_error_by_driver.png", dpi=160); plt.close(fig)
    fig, ax = plt.subplots(figsize=(6, 4)); by_lap=residuals.assign(abs_error=residuals.residual.abs()).groupby("target_lap_number").abs_error.mean(); ax.plot(by_lap.index, by_lap.values, marker="o", color="#1f4e79"); ax.set(xlabel="Target lap number",ylabel="Mean absolute error (s)",title=f"R2 error by target lap\n{title_suffix}"); fig.tight_layout(); fig.savefig(figures / "model_error_by_target_lap.png", dpi=160); plt.close(fig)
