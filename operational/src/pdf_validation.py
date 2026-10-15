"""Validation metrics for partial PDF-derived historical tables."""
from __future__ import annotations
import pandas as pd

TOLERANCE_SECONDS = 0.05

def validate_best_sectors(best: pd.DataFrame, classification: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    d=best.copy(); sector_cols=['best_sector1_seconds','best_sector2_seconds','best_sector3_seconds']
    d['sector_sum_seconds']=d[sector_cols].sum(axis=1, min_count=3)
    d['sector_ideal_abs_diff_seconds']=(d.sector_sum_seconds-d.ideal_lap_seconds).abs()
    d['ideal_best_violation']=d.best_lap_seconds.notna() & d.ideal_lap_seconds.notna() & (d.best_lap_seconds+TOLERANCE_SECONDS<d.ideal_lap_seconds)
    comp=d.merge(classification[['session','driver_id','best_lap_seconds']],on=['session','driver_id'],how='left',suffixes=('','_classification'))
    comp['classification_abs_diff_seconds']=(comp.best_lap_seconds-comp.best_lap_seconds_classification).abs()
    metrics=[]
    for session,g in comp.groupby('session'):
        valid=g.dropna(subset=['sector_ideal_abs_diff_seconds']); lap=g.dropna(subset=['best_lap_seconds','best_lap_seconds_classification'])
        positive=int(g[sector_cols+['ideal_lap_seconds','best_lap_seconds']].apply(lambda row: all(value>0 for value in row.dropna()),axis=1).sum())
        metrics.append({'session':session,'rows_extracted':len(g),'positive_timing_rows':positive,'sector_sum_comparable':len(valid),'sector_ideal_median_abs_diff':valid.sector_ideal_abs_diff_seconds.median(),'sector_ideal_p90_abs_diff':valid.sector_ideal_abs_diff_seconds.quantile(.9),'sector_ideal_max_abs_diff':valid.sector_ideal_abs_diff_seconds.max(),'ideal_best_violations':int(g.ideal_best_violation.sum()),'classification_comparable':len(lap),'classification_median_abs_diff':lap.classification_abs_diff_seconds.median(),'classification_max_abs_diff':lap.classification_abs_diff_seconds.max(),'classification_mismatches':int((lap.classification_abs_diff_seconds>TOLERANCE_SECONDS).sum())})
    return comp, pd.DataFrame(metrics)

def validate_gap_semantics(gaps: pd.DataFrame, classification: pd.DataFrame) -> tuple[pd.DataFrame,pd.DataFrame,pd.DataFrame]:
    final=gaps.loc[gaps.groupby('session').lap_number.transform('max').eq(gaps.lap_number)].copy()
    c=classification[['session','driver_id','position','gap_first_seconds']].copy()
    c['previous_expected']=c.sort_values('position').groupby('session').gap_first_seconds.diff()
    d=final.merge(c,on=['session','driver_id'],how='inner')
    d['leader_error']=(d.gap_to_leader_seconds-d.gap_first_seconds).abs(); d['previous_error']=(d.gap_to_leader_seconds-d.previous_expected).abs()
    rows=[]
    for session,g in d.groupby('session'):
        for label,column in [('gap_to_leader','leader_error'),('gap_to_previous','previous_error')]:
            x=g.dropna(subset=[column]); rows.append({'session':session,'candidate_semantics':label,'comparable_rows':len(x),'matches':int((x[column]<=TOLERANCE_SECONDS).sum()),'median_abs_error':x[column].median(),'max_abs_error':x[column].max(),'support_level':'SUPPORTED' if len(x) and (x[column]<=TOLERANCE_SECONDS).mean()>=.8 else 'UNRESOLVED'})
    sequence=[]
    for (session,driver),g in gaps.groupby(['session','driver_id']):
        laps=sorted(g.lap_number.unique()); pairs=sum(b==a+1 for a,b in zip(laps,laps[1:])); sequence.append({'session':session,'driver_id':driver,'accepted_laps':len(laps),'consecutive_pairs':pairs,'has_2_consecutive':pairs>=1,'has_3_consecutive':any(laps[i+2]==laps[i]+2 for i in range(len(laps)-2))})
    return d,pd.DataFrame(rows),pd.DataFrame(sequence)
