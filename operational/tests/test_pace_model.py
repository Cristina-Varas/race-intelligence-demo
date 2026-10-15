from pathlib import Path
import sys

import pandas as pd

sys.path.insert(0, str(Path(__file__).parents[1] / "src"))
from pace_model import KEYS, TARGET, build_next_lap_model_table, run_pace_model_pipeline, select_pace_engine


def _table():
    rows = []
    for session, base in [("R1", 80.0), ("R2", 82.0)]:
        for driver in (1, 2):
            for lap in range(1, 7):
                rows.append({"session": session, "driver_id": driver, "lap_number": lap,
                             "lap_time_seconds": base + driver + lap / 10,
                             "is_pit_lap": False, "sector1_seconds": 25., "sector2_seconds": 26., "sector3_seconds": 29.,
                             "lap_position": driver, "gap_to_leader_seconds": float(driver),
                             "air_temp": 20., "humidity": 50., "pressure": 1000., "rain": 0., "wind_speed": 5., "wind_direction": 90.})
    return pd.DataFrame(rows)


def test_next_lap_table_has_unique_target_grain_and_no_target_features():
    table, _ = build_next_lap_model_table(_table())
    assert not table.duplicated(KEYS).any()
    assert TARGET in table and "target_sector1" not in table and "target_gap_to_leader" not in table


def test_prior_features_only_use_earlier_laps():
    table, _ = build_next_lap_model_table(_table())
    row = table.query("session == 'R1' and driver_id == 1 and target_lap_number == 3").iloc[0]
    assert row.history_depth == 2
    assert row.driver_prior_median == (81.1 + 81.2) / 2
    assert row.rolling_3_mean == (81.1 + 81.2) / 2
    assert row.previous_lap_time == 81.2


def test_train_test_sessions_are_disjoint():
    table, _ = build_next_lap_model_table(_table())
    assert set(table.query("session == 'R1'").session).isdisjoint(set(table.query("session == 'R2'").session))


def test_pipeline_writes_consistent_residual_output(tmp_path):
    root = Path(tmp_path)
    (root / "data/processed").mkdir(parents=True)
    _table().to_parquet(root / "data/processed/race_state.parquet", index=False)
    results = run_pace_model_pipeline(root)
    residuals = pd.read_parquet(root / "data/processed/pace_model_residuals.parquet")
    assert len(residuals) == len(results["table"].query("session == 'R2'"))
    assert (residuals.residual == residuals.prediction - residuals.actual).all()
    if results["selected_pace_engine"] == "previous_lap_time":
        expected = results["table"].query("session == 'R2'")["previous_lap_time"].to_numpy()
        assert (residuals.prediction.to_numpy() == expected).all()


def test_pipeline_runs_when_optional_matplotlib_is_unavailable(tmp_path, monkeypatch):
    import aidp_environment
    root = Path(tmp_path)
    (root / "data/processed").mkdir(parents=True)
    _table().to_parquet(root / "data/processed/race_state.parquet", index=False)
    monkeypatch.setattr(aidp_environment, "optional_matplotlib", lambda **_: None)
    results = run_pace_model_pipeline(root)
    assert not results["table"].empty
    assert (root / "data/processed/pace_model_residuals.parquet").exists()


def test_best_baseline_is_selected_when_all_ml_candidates_are_worse():
    baselines = [{"model_name": "previous_lap_time", "MAE": 1.0}, {"model_name": "rolling_3_median", "MAE": 1.2}]
    models = [{"model_name": "HistGradientBoosting", "MAE": 1.3}, {"model_name": "Ridge", "MAE": 1.4}]
    selection = select_pace_engine(baselines, models)
    assert selection["selected"]["model_name"] == "previous_lap_time"
    assert selection["selected_type"] == "baseline"
