"""Deterministic, sequential traffic-clearance scenario assumptions."""
from __future__ import annotations
import math
from typing import Iterable
from .field_variability import progress_at_time, rank_race_state, seeded_timing_catch_time

REFERENCE_PACE_PROFILE=[{"startLap":1,"endLap":5,"paceAdjustmentPercent":1.5},{"startLap":6,"endLap":None,"paceAdjustmentPercent":-2.0}]
REFERENCE_TRAFFIC_COST_MODEL={"enabled":True,"earlyCostSecondsPerKart":1.0,"lateCostSecondsPerKart":.2,"transitionStartLap":1,"transitionEndLap":7,"interpolation":"LINEAR"}
def pace_adjustment_for_lap(lap:int,profile:Iterable[dict])->float:
    return next((float(p["paceAdjustmentPercent"]) for p in profile if lap>=p["startLap"] and (p.get("endLap") is None or lap<=p["endLap"])),0.0)
def adjusted_lap_time(base:float,percent:float)->float:return base*(1+percent/100)
def traffic_cost_for_lap(lap:int,model:dict)->float:
    if not model.get("enabled",True):return 0.0
    s,e,a,b=int(model["transitionStartLap"]),int(model["transitionEndLap"]),float(model["earlyCostSecondsPerKart"]),float(model["lateCostSecondsPerKart"])
    if lap<=s:return a
    if lap>=e:return b
    return a+(b-a)*(lap-s)/(e-s)
def _summary(t:list[dict],finish:float,cost:float,n:int,events:list[dict])->dict:
    p1=next((x for x in t if x["rank"]==1),None); full=next((x for x in t if x["clearedCount"]==n),None)
    return {"projectedFinishTimeSeconds":finish,"p1Lap":None if p1 is None else p1["lap"],"p1TimeSeconds":None if p1 is None else p1["raceTimeSeconds"],"fullFieldClearLap":None if full is None else full["lap"],"fullFieldClearTimeSeconds":None if full is None else full["raceTimeSeconds"],"cumulativeTrafficCostSeconds":cost,"timingCatchCount":len(events),"clearedCount":len(events),"stillToClearCount":n-len(events),"currentlyClearingDriverId":None,"currentClearCompletionTimeSeconds":None,"rankTrajectory":t,"clearanceEvents":events}
def build_race_assumption_comparison(field_paces:list[float],*,race_laps:int,base_virtual_max_pace:float,starting_delay_seconds:float,pace_profile:list[dict]|None,traffic_cost_model:dict|None,field_lap_times:list[list[float]]|None=None)->tuple[list[dict],dict,dict]:
    profile,model=pace_profile or REFERENCE_PACE_PROFILE,traffic_cost_model or REFERENCE_TRAFFIC_COST_MODEL;n=len(field_paces);pure=[]
    # The legacy nominal branch below is intentionally retained byte-for-byte in
    # behaviour.  A seeded realization supplies one shared effective-lap path
    # for both pure timing and traffic-adjusted summaries.
    if field_lap_times is not None:
        if len(field_lap_times) != n or any(len(laps) != race_laps for laps in field_lap_times):
            raise ValueError("Seeded field lap-time sequences do not match the requested field and race length.")
        vm_finish=starting_delay_seconds+race_laps*base_virtual_max_pace
        field_finishes=[sum(laps) for laps in field_lap_times]
        catch_times=[seeded_timing_catch_time(laps,base_virtual_max_pace,starting_delay_seconds,race_laps) for laps in field_lap_times]
        pure_events=[{"driverIndex":index,"timingCatchTimeSeconds":caught,"clearTimeSeconds":caught,"trafficCostSeconds":0.0,"lap":max(1,math.ceil((caught-starting_delay_seconds)/base_virtual_max_pace-1e-9))} for index,caught in enumerate(catch_times) if caught is not None]
        for lap in range(1,race_laps+1):
            clock=starting_delay_seconds+lap*base_virtual_max_pace; vm_progress=lap
            progress=[progress_at_time(laps,clock) for laps in field_lap_times]
            ranked=rank_race_state(
                [{"driverId":str(index),"entityType":"synthetic","progress":item,"finishTimeSeconds":field_finishes[index]} for index,item in enumerate(progress)]+[{"driverId":"VIRTUAL MAX","entityType":"virtual_max","progress":vm_progress,"finishTimeSeconds":vm_finish}],
                race_laps,
            )
            caught=sum(caught is not None and caught<=clock+1e-9 for caught in catch_times); rank=next(index+1 for index,item in enumerate(ranked) if item["driverId"]=="VIRTUAL MAX")
            pure.append({"lap":lap,"raceTimeSeconds":clock,"rank":rank,"trafficCostSeconds":0.0,"cumulativeTrafficCostSeconds":0.0,"timingCatchCount":caught,"clearedCount":caught,"stillToClearCount":n-caught})
        pure_summary=_summary(pure,vm_finish,0.0,n,pure_events)
        clock,total,cleared,events,traj=starting_delay_seconds,0.0,set(),[],[]
        # Small fixed progress increments retain one deterministic effective
        # field state while allowing traffic clearance to occur inside a lap.
        vm_progress=0.0
        for end in range(1,race_laps+1):
            while vm_progress < end-1e-10:
                step=min(.05,end-vm_progress); lap=max(1,math.floor(vm_progress)+1); pace=adjusted_lap_time(base_virtual_max_pace,pace_adjustment_for_lap(lap,profile))
                next_progress=vm_progress+step; next_clock=clock+step*pace
                for index,laps in enumerate(field_lap_times):
                    if index in cleared: continue
                    comparison_clock=min(next_clock,field_finishes[index]); comparison_progress=vm_progress+(comparison_clock-clock)/pace
                    before=progress_at_time(laps,clock)-vm_progress; after=progress_at_time(laps,comparison_clock)-comparison_progress
                    if before>0 and after<=0:
                        fraction=before/(before-after) if before!=after else 1.0; caught_time=clock+(comparison_clock-clock)*fraction; event_lap=max(1,math.ceil(vm_progress+(comparison_progress-vm_progress)*fraction-1e-9)); cost=traffic_cost_for_lap(event_lap,model)
                        total+=cost; cleared.add(index); events.append({"driverIndex":index,"timingCatchTimeSeconds":caught_time,"clearTimeSeconds":caught_time+cost,"trafficCostSeconds":cost,"lap":event_lap})
                        next_clock+=cost
                vm_progress=next_progress; clock=next_clock
            progress=[progress_at_time(laps,clock) for laps in field_lap_times]
            ranked=rank_race_state(
                [{"driverId":str(index),"entityType":"synthetic","progress":item,"finishTimeSeconds":field_finishes[index]} for index,item in enumerate(progress)]+[{"driverId":"VIRTUAL MAX","entityType":"virtual_max","progress":vm_progress,"finishTimeSeconds":clock}],
                race_laps,
            )
            rank=next(index+1 for index,item in enumerate(ranked) if item["driverId"]=="VIRTUAL MAX"); lap_cost=sum(x["trafficCostSeconds"] for x in events if x["lap"]==end)
            traj.append({"lap":end,"raceTimeSeconds":clock,"rank":rank,"trafficCostSeconds":lap_cost,"cumulativeTrafficCostSeconds":total,"timingCatchCount":len(events),"clearedCount":len(cleared),"stillToClearCount":n-len(cleared)})
        return profile,pure_summary,_summary(traj,clock,total,n,events)
    for lap in range(1,race_laps+1):
        clock=starting_delay_seconds+lap*base_virtual_max_pace;caught=sum(p*lap>=clock for p in field_paces)
        ranked=rank_race_state(
            [{"driverId":str(index),"entityType":"synthetic","progress":min(race_laps,clock/pace),"finishTimeSeconds":race_laps*pace} for index,pace in enumerate(field_paces)]+[{"driverId":"VIRTUAL MAX","entityType":"virtual_max","progress":lap,"finishTimeSeconds":starting_delay_seconds+race_laps*base_virtual_max_pace}],
            race_laps,
        );rank=next(index+1 for index,item in enumerate(ranked) if item["driverId"]=="VIRTUAL MAX")
        pure.append({"lap":lap,"raceTimeSeconds":clock,"rank":rank,"trafficCostSeconds":0.0,"cumulativeTrafficCostSeconds":0.0,"timingCatchCount":caught,"clearedCount":caught,"stillToClearCount":n-caught})
    pure_summary=_summary(pure,starting_delay_seconds+race_laps*base_virtual_max_pace,0.0,n,[])
    d,clock,total,cleared,events,traj=0.0,starting_delay_seconds,0.0,set(),[],[]
    for end in range(1,race_laps+1):
        while d<end-1e-10:
            lap=max(1,math.floor(d)+1);pace=adjusted_lap_time(base_virtual_max_pace,pace_adjustment_for_lap(lap,profile));segment=min(end,math.floor(d)+1)-d
            candidates=[((clock-p*d)/(p-pace),i) for i,p in enumerate(field_paces) if i not in cleared and p>pace and -1e-9<=(clock-p*d)/(p-pace)<=segment+1e-9]
            if not candidates:d+=segment;clock+=segment*pace;continue
            advance,index=min(candidates);advance=max(0,advance);d+=advance;clock+=advance*pace;event_lap=max(1,math.ceil(d-1e-9));cost=traffic_cost_for_lap(event_lap,model);caught_time=clock;clock+=cost;total+=cost;cleared.add(index);events.append({"driverIndex":index,"timingCatchTimeSeconds":caught_time,"clearTimeSeconds":clock,"trafficCostSeconds":cost,"lap":event_lap})
        ranked=rank_race_state(
            [{"driverId":str(index),"entityType":"synthetic","progress":min(race_laps,clock/pace),"finishTimeSeconds":race_laps*pace} for index,pace in enumerate(field_paces)]+[{"driverId":"VIRTUAL MAX","entityType":"virtual_max","progress":d,"finishTimeSeconds":clock}],
            race_laps,
        );rank=next(index+1 for index,item in enumerate(ranked) if item["driverId"]=="VIRTUAL MAX");lap_cost=sum(x["trafficCostSeconds"] for x in events if x["lap"]==end);traj.append({"lap":end,"raceTimeSeconds":clock,"rank":rank,"trafficCostSeconds":lap_cost,"cumulativeTrafficCostSeconds":total,"timingCatchCount":len(events),"clearedCount":len(cleared),"stillToClearCount":n-len(cleared)})
    return profile,pure_summary,_summary(traj,clock,total,n,events)
