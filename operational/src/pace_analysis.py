"""Descriptive historical driver-pace summaries; no predictive modelling."""
from pathlib import Path
import pandas as pd
from data_utils import read_parquet_portable, write_csv_portable

def build_pace_outputs(root: Path):
 d=read_parquet_portable(root/'data/processed/race_state.parquet').copy(); d['valid_pace_lap']=d.lap_time_seconds.gt(0)&~d.is_pit_lap.fillna(False)
 p=d.query('valid_pace_lap').copy(); p['abs_dev']=p.groupby(['session','driver_id']).lap_time_seconds.transform(lambda x:(x-x.median()).abs())
 s=p.groupby(['session','driver_id']).lap_time_seconds.agg(valid_lap_count='size',median_lap_time='median',mean_lap_time='mean',std='std',min='min',P10=lambda x:x.quantile(.1),P90=lambda x:x.quantile(.9)).reset_index(); s['IQR']=p.groupby(['session','driver_id']).lap_time_seconds.quantile(.75).sub(p.groupby(['session','driver_id']).lap_time_seconds.quantile(.25)).to_numpy(); s['MAD']=p.groupby(['session','driver_id']).abs_dev.median().to_numpy(); s['rank']=s.groupby('session').median_lap_time.rank(method='min')
 out=root/'outputs/tables'; write_csv_portable(s, out/'driver_session_pace_summary.csv',index=False)
 race=s.query("session in ['R1','R2']").pivot(index='driver_id',columns='session',values=['valid_lap_count','median_lap_time','rank']); prof=pd.DataFrame({'driver_id':race.index,'R1_valid_laps':race[('valid_lap_count','R1')],'R2_valid_laps':race[('valid_lap_count','R2')],'R1_median_pace':race[('median_lap_time','R1')],'R2_median_pace':race[('median_lap_time','R2')],'R1_rank':race[('rank','R1')],'R2_rank':race[('rank','R2')]}).reset_index(drop=True); pooled=p.query("session in ['R1','R2']").groupby('driver_id').lap_time_seconds.agg(pooled_median_pace='median',pooled_IQR=lambda x:x.quantile(.75)-x.quantile(.25)); prof=prof.merge(pooled,on='driver_id'); prof['pooled_rank']=prof.pooled_median_pace.rank(method='min'); write_csv_portable(prof, out/'observed_driver_profiles.csv',index=False)
 return d,p,s,prof

def build_filter_sensitivity(root: Path):
    d=read_parquet_portable(root/'data/processed/race_state.parquet').copy(); base=d.lap_time_seconds.gt(0)&~d.is_pit_lap.fillna(False); rows=[]; rankings=[]
    for rule in ['A_base','B_session_mad','C_driver_mad']:
        keep=base.copy()
        if rule=='B_session_mad':
            med=d.loc[base].groupby('session').lap_time_seconds.transform('median'); mad=d.loc[base].groupby('session').lap_time_seconds.transform(lambda x:(x-x.median()).abs().median()); keep.loc[base]=((d.loc[base].lap_time_seconds-med).abs()<=4*mad.replace(0,float('inf')))
        if rule=='C_driver_mad':
            med=d.loc[base].groupby(['session','driver_id']).lap_time_seconds.transform('median'); mad=d.loc[base].groupby(['session','driver_id']).lap_time_seconds.transform(lambda x:(x-x.median()).abs().median()); keep.loc[base]=((d.loc[base].lap_time_seconds-med).abs()<=4*mad.replace(0,float('inf')))
        for session,g in d.groupby('session'): rows.append({'session':session,'rule':rule,'laps_retained':int(keep[g.index].sum()),'laps_removed':int(base[g.index].sum()-keep[g.index].sum()),'drivers_affected':int(g.loc[base[g.index]&~keep[g.index],'driver_id'].nunique())})
        x=d.loc[keep & d.session.isin(['R1','R2'])].groupby('driver_id').lap_time_seconds.agg(valid_laps='size',median_pace='median').reset_index()
        for min_laps in [1,3,5]:
            y=x.query('valid_laps >= @min_laps').sort_values('median_pace').head(2).copy(); y['rule']=rule;y['min_laps']=min_laps;y['rank']=range(1,len(y)+1);rankings.append(y)
    out=root/'outputs/tables'; write_csv_portable(pd.DataFrame(rows), out/'pace_lap_filter_sensitivity.csv',index=False); write_csv_portable(pd.concat(rankings), out/'pace_ranking_sensitivity.csv',index=False)
    return pd.DataFrame(rows),pd.concat(rankings)
