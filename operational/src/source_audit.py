"""Executable orchestration for Notebook 01."""
from __future__ import annotations
import sys
from pathlib import Path
import pandas as pd
sys.path.insert(0, str(Path(__file__).parent))
from data_utils import dataframe_storage_diagnostics, inventory_raw_files, load_csv_safe, resolve_raw_data_path, standardize_analysis, standardize_classification, standardize_weather, write_csv_portable, write_parquet_portable
from pdf_extractors import extract_analysis_by_lap, extract_best_sectors, extract_lap_chart, extract_leader_sequence


def run_audit(project_root: Path) -> dict[str, pd.DataFrame]:
    raw, tables, figures, processed = (resolve_raw_data_path(project_root), project_root / "outputs/tables", project_root / "outputs/figures", project_root / "data/processed")
    for path in (tables, figures, processed): path.mkdir(parents=True, exist_ok=True)
    files = inventory_raw_files(raw); write_csv_portable(files, tables / "raw_file_inventory.csv", index=False)
    schemas=[]; analyses=[]; classifications=[]; weather=[]
    for path in sorted(raw.rglob("*.CSV")):
        frame, delimiter = load_csv_safe(path); family=files.loc[files.relative_path.eq(path.relative_to(raw).as_posix()), "source_family"].iloc[0]
        schemas.append({"session":path.parent.name,"source_family":family,"rows":len(frame),"columns":len(frame.columns),"column_names":" | ".join(frame.columns),"delimiter":delimiter,"missingness_pct":round(float(frame.isna().mean().mean()*100),2),"sample_dtypes":" | ".join(f"{c}:{frame[c].dropna().iloc[0] if frame[c].notna().any() else 'NA'}" for c in frame.columns[:6])})
        if family=="Analysis": analyses.append(standardize_analysis(frame,path.parent.name))
        elif family=="Classification": classifications.append(standardize_classification(frame,path.parent.name))
        elif family=="Weather": weather.append(standardize_weather(frame,path.parent.name))
    schema=pd.DataFrame(schemas); write_csv_portable(schema, tables / "csv_schema_inventory.csv",index=False)
    analysis=pd.concat(analyses,ignore_index=True); classification=pd.concat(classifications,ignore_index=True); weather_df=pd.concat(weather,ignore_index=True)
    write_parquet_portable(analysis,processed/"analysis_laps.parquet",index=False); write_parquet_portable(classification,processed/"classification.parquet",index=False); write_parquet_portable(weather_df,processed/"weather.parquet",index=False)
    leaders=[]; quality=[]; accepted_gaps=[]; rejected_gaps=[]; positions=[]; sectors=[]
    for _, f in files.query("extension == 'pdf'").iterrows():
        if f.source_family=="LeaderSequence":
            rows=extract_leader_sequence(raw/f.relative_path,f.session); leaders.append(rows); status="VALIDATED" if len(rows) else "UNSUPPORTED"; note="header and lap-range validation"
        elif f.source_family == "LapChart":
            rows=extract_lap_chart(raw/f.relative_path, f.session); positions.append(rows); status="PARTIAL"; note="coordinate grid extraction; awaiting final-position validation"
        elif f.source_family == "BestSectors":
            rows=extract_best_sectors(raw/f.relative_path, f.session); sectors.append(rows); status="PARTIAL"; note="coordinate band extraction; timing checks applied"
        elif f.source_family == "AnalysisByLap":
            accepted, rejected = extract_analysis_by_lap(raw/f.relative_path, f.session, analysis); accepted_gaps.append(accepted); rejected_gaps.append(rejected)
            rows=accepted; status="UNSUPPORTED"; note="text layer exists; coordinate parser not yet validated"
        else: rows=pd.DataFrame(); status="PARTIAL"; note="source inventoried; CSV counterpart preferred where available"
        quality.append({"source_family":f.source_family,"session":f.session,"rows_extracted":len(rows),"rows_accepted":len(rows),"rows_rejected":len(rejected) if f.source_family == "AnalysisByLap" else 0,"validation_method":note,"quality_status":status,"notes":note})
    quality=pd.DataFrame(quality)
    leader=pd.concat(leaders,ignore_index=True) if leaders else pd.DataFrame(columns=["session","lap_number","leader_driver_id"])
    if len(leader): write_parquet_portable(leader,processed/"leader_sequence.parquet",index=False)
    lap_positions=pd.concat(positions,ignore_index=True) if positions else pd.DataFrame()
    best_sectors=pd.concat(sectors,ignore_index=True) if sectors else pd.DataFrame()
    if len(lap_positions): write_parquet_portable(lap_positions,processed/"lap_positions.parquet",index=False)
    if len(best_sectors): write_parquet_portable(best_sectors,processed/"best_sectors.parquet",index=False)
    accepted_gap_rows=pd.concat(accepted_gaps,ignore_index=True) if accepted_gaps else pd.DataFrame()
    rejected_gap_rows=pd.concat(rejected_gaps,ignore_index=True) if rejected_gaps else pd.DataFrame()
    write_csv_portable(accepted_gap_rows, tables / "accepted_gap_rows.csv", index=False)
    write_csv_portable(rejected_gap_rows, tables / "rejected_gap_rows.csv", index=False)
    if len(accepted_gap_rows): write_parquet_portable(accepted_gap_rows,processed / "lap_gaps.parquet",index=False)
    if len(lap_positions):
        final=lap_positions.loc[lap_positions.groupby('session').lap_number.transform('max').eq(lap_positions.lap_number)]
        check=final.merge(classification[['session','driver_id','position']],on=['session','driver_id'],how='inner',suffixes=('_pdf','_classification'))
        lapchart_validation=check.assign(match=check.position_pdf.eq(check.position_classification)).groupby('session').agg(matched_drivers=('driver_id','size'),matching_positions=('match','sum')).reset_index(); lapchart_validation['mismatches']=lapchart_validation.matched_drivers-lapchart_validation.matching_positions; lapchart_validation['match_rate']=lapchart_validation.matching_positions/lapchart_validation.matched_drivers
    else: lapchart_validation=pd.DataFrame(columns=['session','matched_drivers','matching_positions','mismatches','match_rate'])
    write_csv_portable(lapchart_validation, tables/'lapchart_validation.csv',index=False)
    if len(lapchart_validation):
        for _, row in lapchart_validation.iterrows():
            mask=(quality.source_family=='LapChart')&(quality.session==row.session)
            quality.loc[mask,['validation_matches','validation_mismatches','quality_status']]=[int(row.matching_positions),int(row.mismatches),'VALIDATED' if row.match_rate==1 else 'PARTIAL']
    else: quality['validation_matches']=0; quality['validation_mismatches']=0
    for session, group in best_sectors.groupby('session'):
        valid=group.dropna(subset=['ideal_lap_seconds','best_lap_seconds'])
        mask=(quality.source_family=='BestSectors')&(quality.session==session)
        quality.loc[mask,['validation_matches','validation_mismatches','quality_status']]=[int((valid.best_lap_seconds>=valid.ideal_lap_seconds).sum()),int((valid.best_lap_seconds<valid.ideal_lap_seconds).sum()),'VALIDATED' if len(valid) else 'PARTIAL']
    quality['validation_matches']=quality.get('validation_matches',0).fillna(0).astype(int); quality['validation_mismatches']=quality.get('validation_mismatches',0).fillna(0).astype(int)
    write_csv_portable(quality, tables / "pdf_extraction_quality.csv",index=False)
    cross=[]
    for session, group in leader.groupby("session"):
        winner=classification.query("session == @session and position == 1").driver_id.dropna()
        cross.append({"check":"leader_final_vs_classification","session":session,"status":"MATCH" if len(winner) and int(winner.iloc[0])==int(group.leader_driver_id.iloc[-1]) else "MISMATCH","details":"final leader compared with classification winner"})
    cross=pd.DataFrame(cross); write_csv_portable(cross, tables/"cross_source_validation.csv",index=False)
    offsets=[]
    for session, a in analysis.groupby("session"):
        w=weather_df.query("session == @session").dropna(subset=["timestamp"])
        times=pd.to_timedelta(a.hour.astype(str),errors="coerce").dt.total_seconds().dropna(); wt=w.timestamp.dt.hour*3600+w.timestamp.dt.minute*60+w.timestamp.dt.second
        for offset in (-2,-1,0,1,2):
            deltas=[min(abs((t+offset*3600)-x) for x in wt) for t in times] if len(times) and len(wt) else []
            offsets.append({"session":session,"offset_hours":offset,"median_nearest_delta_seconds":float(pd.Series(deltas).median()) if deltas else float("nan")})
    offset=pd.DataFrame(offsets); write_csv_portable(offset, tables/"weather_offset_evaluation.csv",index=False)
    coverage=[]
    for session in sorted(files.session.unique()):
        a=analysis.query("session == @session"); c=classification.query("session == @session"); w=weather_df.query("session == @session")
        total=max(len(a),1)
        coverage.append({"session":session,"lap_time_pct":round(a.lap_time_seconds.notna().mean()*100,1),"sector1_pct":round(a.sector1_seconds.notna().mean()*100,1),"sector2_pct":round(a.sector2_seconds.notna().mean()*100,1),"sector3_pct":round(a.sector3_seconds.notna().mean()*100,1),"position_pct":round(c.position.notna().mean()*100,1),"weather_pct":round(w.air_temp.notna().mean()*100,1),"pit_marker_pct":round(a.pit_marker.notna().mean()*100,1),"classification_pct":round(c.driver_id.notna().mean()*100,1)})
    coverage=pd.DataFrame(coverage); write_csv_portable(coverage, tables/"data_coverage_matrix.csv",index=False)
    quality_rows=[]
    for field in ["lap_time_seconds","sector1_seconds","sector2_seconds","sector3_seconds"]:
        pct=float(analysis[field].notna().mean()*100); quality_rows.append({"source_variable":field,"quality":"GOOD" if pct>=90 else "MODERATE" if pct>=50 else "LIMITED","metric":"non-null coverage","value":round(pct,1)})
    for field in ["air_temp","track_temp","humidity","pressure","rain","wind_speed","wind_direction"]:
        pct=float(weather_df[field].notna().mean()*100); quality_rows.append({"source_variable":field,"quality":"GOOD" if pct>=90 else "UNAVAILABLE" if pct==0 else "LIMITED","metric":"non-null coverage","value":round(pct,1)})
    quality_summary=pd.DataFrame(quality_rows); write_csv_portable(quality_summary, tables/"raw_data_quality_summary.csv",index=False)
    audit_frames = {
        "analysis": analysis,
        "classification": classification,
        "weather": weather_df,
        "leader_sequence": leader,
        "lap_positions": lap_positions,
        "best_sectors": best_sectors,
        "lap_gaps": accepted_gap_rows,
    }
    storage_diagnostics = pd.concat(
        [dataframe_storage_diagnostics(frame).assign(dataframe=name) for name, frame in audit_frames.items()],
        ignore_index=True,
    )
    write_csv_portable(storage_diagnostics, tables / "source_audit_storage_diagnostics.csv", index=False)
    return {"files":files,"schema":schema,"analysis":analysis,"classification":classification,"weather":weather_df,"quality":quality,"cross":cross,"offset":offset,"coverage":coverage,"quality_summary":quality_summary,"leader":leader,"accepted_gaps":accepted_gap_rows,"rejected_gaps":rejected_gap_rows,"lap_positions":lap_positions,"best_sectors":best_sectors,"lapchart_validation":lapchart_validation,"storage_diagnostics":storage_diagnostics}
