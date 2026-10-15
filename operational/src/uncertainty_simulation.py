"""Historically grounded Monte Carlo timing-catch scenario utilities.

All stochastic results are scenario probabilities under stated assumptions;
Virtual Max remains a synthetic entity throughout.
"""
from __future__ import annotations

from pathlib import Path
import numpy as np
import pandas as pd

from pace_model import robust_session_mad_mask
from data_utils import read_parquet_portable


def _stats(values: pd.Series | np.ndarray) -> dict[str, float]:
    x = pd.Series(values).dropna()
    med = float(x.median())
    return {"sample_size": len(x), "median": med, "mean": float(x.mean()), "std": float(x.std(ddof=1)),
            "MAD": float((x-med).abs().median()), "P10": float(x.quantile(.1)), "P25": float(x.quantile(.25)),
            "P50": med, "P75": float(x.quantile(.75)), "P90": float(x.quantile(.9))}


def build_uncertainty_candidates(root: Path) -> tuple[pd.DataFrame, pd.DataFrame, dict[int, np.ndarray], dict[str, np.ndarray]]:
    """Compare residual errors with robust historical within-driver deviations."""
    root = Path(root)
    residuals = read_parquet_portable(root / "data/processed/pace_model_residuals.parquet")
    # residual = prediction - actual, so -residual is the actual-error direction.
    engine = -residuals["residual"].to_numpy(float)
    laps = read_parquet_portable(root / "data/processed/race_state.parquet")
    laps = laps.loc[laps.session.isin(["R1", "R2"])].copy()
    laps = laps.loc[robust_session_mad_mask(laps)].copy()
    laps["driver_session_pace"] = laps.groupby(["driver_id", "session"])["lap_time_seconds"].transform("median")
    laps["lap_deviation"] = laps["lap_time_seconds"] - laps["driver_session_pace"]
    within = laps["lap_deviation"].to_numpy(float)
    pools = {int(driver): group.lap_deviation.to_numpy(float) for driver, group in laps.groupby("driver_id")}
    profile = read_parquet_portable(root / "data/processed/observed_driver_profiles.parquet")
    sigma = 1.4826 * profile.pooled_MAD.dropna().to_numpy(float)
    rows=[]
    for name, values, advantages, limitations, use in [
        ("pace_engine_residual_actual_error", engine, "Uses selected-engine R2 holdout error direction.", "39 R2 targets; prediction error is not physical lap noise.", "Sensitivity only."),
        ("historical_within_driver", within, "Observed robust non-pit R1/R2 lap-to-lap deviations around driver/session pace.", "Only two principal races; iid sampling is an approximation.", "Primary empirical scenario noise."),
        ("driver_profile_MAD_sigma", sigma, "Driver-level robust scale, using sigma ≈ 1.4826 × MAD.", "Scale parameters, not an empirical lap-noise distribution; normality is not assumed.", "Scale diagnostic, not primary sampling."),
    ]:
        rows.append({"source": name, **_stats(values), "advantages": advantages, "limitations": limitations, "recommended_use": use})
    return pd.DataFrame(rows), laps, pools, {"pace_engine_residual": engine - np.median(engine), "historical_within_driver": within, "zero": np.array([0.0])}


def lag1_deviation_summary(laps: pd.DataFrame) -> pd.DataFrame:
    rows=[]
    for (driver, session), group in laps.sort_values("lap_number").groupby(["driver_id", "session"]):
        x=group.lap_deviation.to_numpy(float)
        if len(x) >= 4 and np.std(x[:-1]) > 0 and np.std(x[1:]) > 0:
            rows.append({"driver_id": driver, "session": session, "pairs": len(x)-1, "lag1_correlation": float(np.corrcoef(x[:-1],x[1:])[0,1])})
    out=pd.DataFrame(rows)
    return out


def _sample_paths(field: pd.DataFrame, race_laps: int, simulations: int, rng: np.random.Generator, driver_pools: dict[int, np.ndarray], virtual_pool: np.ndarray, zero_noise: bool=False) -> tuple[np.ndarray, np.ndarray]:
    drivers=[]
    for row in field.itertuples():
        pool_key = int(getattr(row, "template_driver_id", row.driver_id))
        pool = np.array([0.0]) if zero_noise else driver_pools[pool_key]
        draws=rng.choice(pool, size=(simulations, race_laps), replace=True)
        drivers.append(np.maximum(0.001, row.base_pace_seconds + draws))
    driver_laps=np.stack(drivers, axis=1)
    vmax_draws=np.zeros((simulations,race_laps)) if zero_noise else rng.choice(virtual_pool, size=(simulations,race_laps), replace=True)
    return driver_laps, vmax_draws


def evaluate_paths(field: pd.DataFrame, virtual_pace: float, delays: np.ndarray, driver_laps: np.ndarray, virtual_deviations: np.ndarray) -> pd.DataFrame:
    """Evaluate shared sampled paths at multiple delays using linear intra-lap interpolation."""
    sims, drivers, laps = driver_laps.shape
    driver_cum=np.cumsum(driver_laps, axis=2)
    vmax_cum=np.cumsum(np.maximum(.001, virtual_pace + virtual_deviations), axis=1)
    rows=[]
    for delay in delays:
        # Difference at matching continuous lap index, including the t=0 deficit.
        diff=driver_cum - (delay + vmax_cum[:,None,:])
        previous=np.concatenate([np.full((sims,drivers,1), -delay), diff[:,:,:-1]],axis=2)
        crossed=(diff >= 0) & (previous < 0)
        any_cross=crossed.any(axis=2)
        # At zero delay all entities share timing equality at t=0.
        if delay <= 1e-9:
            any_cross[:] = True
        idx=np.argmax(crossed,axis=2)
        prev= np.take_along_axis(previous,idx[:,:,None],axis=2)[:,:,0]
        now= np.take_along_axis(diff,idx[:,:,None],axis=2)[:,:,0]
        fraction=np.where(any_cross, np.clip(-prev/(now-prev+1e-15),0,1), np.nan)
        catch_lap=np.where(any_cross, idx+fraction, np.nan)
        if delay <= 1e-9:
            catch_lap[:] = 0.0
        caught=any_cross
        full=caught.all(axis=1)
        final_margin=diff[:,:,-1].min(axis=1)
        last_lap=np.full(sims, np.nan)
        last_lap[full]=np.nanmax(catch_lap[full],axis=1)
        last_driver=np.full(sims, -1, dtype=int)
        last_driver[full]=np.nanargmax(catch_lap[full],axis=1)
        rows.append({"delay":float(delay), "full":full, "caught":caught, "catch_lap":catch_lap, "last_lap":last_lap, "last_driver":last_driver, "margin":final_margin})
    return pd.DataFrame(rows)


def probability_curve(field: pd.DataFrame, virtual_pace: float, delays: np.ndarray, simulations: int, seed: int, driver_pools: dict[int,np.ndarray], virtual_pool: np.ndarray, zero_noise: bool=False, race_laps: int=30) -> tuple[pd.DataFrame, pd.DataFrame]:
    rng=np.random.default_rng(seed)
    driver_laps, vmax_devs=_sample_paths(field, race_laps, simulations, rng, driver_pools, virtual_pool, zero_noise)
    evaluated=evaluate_paths(field, virtual_pace, np.asarray(delays), driver_laps, vmax_devs)
    rows=[]; driver_rows=[]
    for item in evaluated.itertuples(index=False):
        full=item.full; margins=item.margin; last=item.last_lap
        rows.append({"start_delay_seconds":item.delay,"simulations":simulations,"full_field_catches":int(full.sum()),"full_field_catch_probability":float(full.mean()),"mean_last_catch_lap":float(np.nanmean(last)) if full.any() else np.nan,"median_last_catch_lap":float(np.nanmedian(last)) if full.any() else np.nan,"mean_finish_margin":float(margins.mean()),"P10_finish_margin":float(np.quantile(margins,.1)),"P90_finish_margin":float(np.quantile(margins,.9))})
        for j,driver in enumerate(field.driver_id): driver_rows.append({"start_delay_seconds":item.delay,"driver_id":driver,"catch_probability":float(item.caught[:,j].mean())})
    return pd.DataFrame(rows), pd.DataFrame(driver_rows)


def sampled_outcomes(field: pd.DataFrame, virtual_pace: float, delays: np.ndarray, simulations: int, seed: int, driver_pools: dict[int, np.ndarray], virtual_pool: np.ndarray, race_laps: int=30) -> pd.DataFrame:
    """Return reproducible path-level outcomes for last-driver and margin analysis."""
    rng = np.random.default_rng(seed)
    driver_laps, vmax_devs = _sample_paths(field, race_laps, simulations, rng, driver_pools, virtual_pool)
    return evaluate_paths(field, virtual_pace, np.asarray(delays), driver_laps, vmax_devs)


def thresholds(curve: pd.DataFrame, values: list[float], simulations: int) -> pd.DataFrame:
    rows=[]
    for threshold in values:
        eligible=curve.loc[curve.full_field_catch_probability >= threshold]
        rows.append({"probability_threshold":threshold,"maximum_start_delay_seconds":float(eligible.start_delay_seconds.max()) if not eligible.empty else np.nan,"method":"conservative raw grid threshold","simulation_count":simulations,"caveat":"Raw Monte Carlo curve retained; grid resolution limits precision."})
    return pd.DataFrame(rows)
