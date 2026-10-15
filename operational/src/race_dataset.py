"""Build the canonical historical lap-level dataset from processed sources."""
from __future__ import annotations
from pathlib import Path
import pandas as pd
from data_utils import read_parquet_portable, write_csv_portable, write_parquet_portable

RACE_COLUMNS=['session','lap_number','driver_id','lap_time_seconds','sector1_seconds','sector2_seconds','sector3_seconds','is_pit_lap','lap_position','gap_to_leader_seconds','weather_source_timestamp','weather_match_delta_seconds','air_temp','humidity','pressure','rain','wind_speed','wind_direction']

def build_race_state(root: Path) -> tuple[pd.DataFrame,pd.DataFrame]:
    p=root/'data/processed'; out=root/'outputs/tables'; out.mkdir(parents=True,exist_ok=True)
    base=read_parquet_portable(p/'analysis_laps.parquet').copy(); key=['session','lap_number','driver_id']; assert not base.duplicated(key).any()
    audits=[]
    def join(right, columns, source):
        nonlocal base
        assert not right.duplicated(key).any()
        before=len(base); merged=base.merge(right[key+columns],on=key,how='left',validate='one_to_one'); assert len(merged)==before
        for session,g in merged.groupby('session'):
            matched=int(g[columns].notna().any(axis=1).sum()); audits.append({'source':source,'session':session,'base_rows':len(g),'matched_rows':matched,'unmatched_rows':len(g)-matched,'coverage_pct':matched/len(g)*100,'duplicate_keys_before_join':0,'rows_after_join':len(g)})
        base=merged
    pos=read_parquet_portable(p/'lap_positions.parquet').rename(columns={'position':'lap_position'}); join(pos,['lap_position'],'LapChart PDF')
    gaps=read_parquet_portable(p/'lap_gaps.parquet')[key+['gap_to_leader_seconds']]; join(gaps,['gap_to_leader_seconds'],'AnalysisByLap PDF')
    weather=read_parquet_portable(p/'weather.parquet').sort_values(['session','timestamp']); offsets=pd.read_csv(out/'weather_offset_evaluation.csv').sort_values('median_nearest_delta_seconds').groupby('session').head(1).set_index('session').offset_hours
    frames=[]
    for session,g in base.groupby('session',sort=False):
        w=weather.query('session == @session').sort_values('timestamp'); date=w.timestamp.dt.normalize().iloc[0]
        left=g.copy(); left['_target']=date+pd.to_timedelta(left.hour.astype(str))+pd.to_timedelta(float(offsets[session]),unit='h'); left=left.sort_values('_target')
        m=pd.merge_asof(left,w[['timestamp','air_temp','humidity','pressure','rain','wind_speed','wind_direction']].rename(columns={'timestamp':'weather_source_timestamp'}),left_on='_target',right_on='weather_source_timestamp',direction='nearest',tolerance=pd.Timedelta(seconds=60)); m['weather_match_delta_seconds']=(m._target-m.weather_source_timestamp).abs().dt.total_seconds(); frames.append(m)
    base=pd.concat(frames,ignore_index=True); audits.extend({'source':'Weather CSV (nearest, selected offset)','session':s,'base_rows':len(g),'matched_rows':int(g.weather_source_timestamp.notna().sum()),'unmatched_rows':int(g.weather_source_timestamp.isna().sum()),'coverage_pct':g.weather_source_timestamp.notna().mean()*100,'duplicate_keys_before_join':0,'rows_after_join':len(g)} for s,g in base.groupby('session'))
    race=base[RACE_COLUMNS].sort_values(key).reset_index(drop=True); assert len(race)==781 and not race.duplicated(key).any()
    write_csv_portable(pd.DataFrame(audits), out/'race_state_join_audit.csv',index=False); write_parquet_portable(race, p/'race_state.parquet',index=False)
    coverage=race.groupby('session').agg(rows=('driver_id','size'),drivers=('driver_id','nunique'),lap_min=('lap_number','min'),lap_max=('lap_number','max'),lap_time_pct=('lap_time_seconds',lambda x:x.notna().mean()*100),sector1_pct=('sector1_seconds',lambda x:x.notna().mean()*100),sector2_pct=('sector2_seconds',lambda x:x.notna().mean()*100),sector3_pct=('sector3_seconds',lambda x:x.notna().mean()*100),lap_position_pct=('lap_position',lambda x:x.notna().mean()*100),gap_to_leader_pct=('gap_to_leader_seconds',lambda x:x.notna().mean()*100),weather_pct=('weather_source_timestamp',lambda x:x.notna().mean()*100)).reset_index(); write_csv_portable(coverage, out/'race_state_coverage.csv',index=False)
    results=read_parquet_portable(p/'classification.parquet').rename(columns={'position':'final_position','laps':'completed_laps'})
    source_coverage=coverage[['session','lap_time_pct','sector1_pct','sector2_pct','sector3_pct','lap_position_pct','weather_pct']].copy(); source_coverage['classification_position_available']=source_coverage.session.map(results.groupby('session').final_position.apply(lambda x:x.notna().any())); source_coverage['pit_marker_field_available']=base.groupby('session').pit_marker.apply(lambda x:x.notna().any()).reindex(source_coverage.session).to_numpy(); source_coverage['pit_lap_rate_pct']=race.groupby('session').is_pit_lap.mean().reindex(source_coverage.session).to_numpy()*100; write_csv_portable(source_coverage, out/'data_coverage_matrix.csv',index=False)
    numeric=race.select_dtypes(include='number')
    checks=[('unique_grain',not race.duplicated(key).any()),('positive_laps',(race.lap_number>0).all()),('positive_lap_times',(race.lap_time_seconds>0).all()),('no_sentinels',not numeric.isin([-999]).any().any()),('weather_tolerance',(race.weather_match_delta_seconds.dropna()<=60).all())]; write_csv_portable(pd.DataFrame(checks,columns=['check','passed']), out/'race_state_validation.csv',index=False)
    dictionary=pd.DataFrame([['lap_time_seconds','observed lap duration','Analysis CSV','lap','CORE','100%','historical analysis','none'],['lap_position','observed position','LapChart PDF','lap','VALIDATED','R1/R2 only','historical context','null elsewhere'],['gap_to_leader_seconds','reported PDF gap','AnalysisByLap PDF','lap','QUALIFIED','partial','descriptive use','small semantic sample'],['weather_source_timestamp','nearest aligned observation','Weather CSV','lap','VALIDATED','60-second tolerance','context','selected -1h offset']],columns=['field','description','source','grain','validation_status','coverage_notes','allowed_use','caveat']); write_csv_portable(dictionary, out/'race_state_data_dictionary.csv',index=False)
    results=read_parquet_portable(p/'classification.parquet').rename(columns={'position':'final_position','laps':'completed_laps'}); write_parquet_portable(results, p/'driver_session_results.parquet',index=False)
    return race,pd.DataFrame(audits)
