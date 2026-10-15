"""Synthetic scenario-field creation; never writes historical Silver tables."""
from __future__ import annotations
from pathlib import Path
import numpy as np
import pandas as pd


def generate_synthetic_field(profiles: pd.DataFrame, target_size: int=100, seed: int=42, perturb: bool=True, scale_fraction: float=.10, bound_fraction: float=.25) -> pd.DataFrame:
    """Bootstrap supported historical profiles with bounded MAD-scaled pace shifts."""
    observed=profiles.loc[profiles.support_status.eq('sufficient')].copy()
    if target_size < 1: raise ValueError('target_size must be positive')
    rng=np.random.default_rng(seed); templates=observed.iloc[rng.integers(0,len(observed),target_size)].reset_index(drop=True)
    between_mad=float((observed.pooled_median_pace-observed.pooled_median_pace.median()).abs().median())
    bound=bound_fraction*between_mad; shifts=rng.normal(0,scale_fraction*between_mad,target_size) if perturb else np.zeros(target_size)
    shifts=np.clip(shifts,-bound,bound)
    low,high=float(observed.pooled_median_pace.min()),float(observed.pooled_median_pace.max())
    pace=np.clip(templates.pooled_median_pace.to_numpy(float)+shifts,low,high)
    return pd.DataFrame({'synthetic_driver_id':[f'SYN_{i:03d}' for i in range(1,target_size+1)],'template_driver_id':templates.driver_id.to_numpy(int),'base_pace_seconds':pace,'historical_template_pace_seconds':templates.pooled_median_pace.to_numpy(float),'pace_perturbation_seconds':pace-templates.pooled_median_pace.to_numpy(float),'variability_scale':templates.pooled_MAD.to_numpy(float),'generation_seed':seed,'source_type':'synthetic','scenario_version':'bootstrap_bounded_v1'})


def synthetic_chase_field(synthetic: pd.DataFrame) -> pd.DataFrame:
    return synthetic.rename(columns={'synthetic_driver_id':'driver_id'})[['driver_id','base_pace_seconds','template_driver_id','variability_scale','source_type']].assign(historical_rank=np.nan,support=np.nan)


def distribution_summary(values: pd.Series) -> dict:
    x=values.astype(float); med=x.median()
    return {'min':x.min(),'P10':x.quantile(.1),'median':med,'mean':x.mean(),'P90':x.quantile(.9),'max':x.max(),'MAD':(x-med).abs().median(),'IQR':x.quantile(.75)-x.quantile(.25)}
