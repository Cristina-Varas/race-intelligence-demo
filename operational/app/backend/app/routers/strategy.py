from fastapi import APIRouter, HTTPException, Request

from ..models.responses import JokerComparisonRequest, JokerStrategyRequest, JokerStrategyResponse
from ..services.joker_strategy import evaluate_joker_options, evaluate_joker_strategy
from ..simulation import HistoricalProfile, generate_synthetic_stress_field

router = APIRouter(prefix="/api/strategy", tags=["strategy"])

def _field(payload, request):
    rows = request.app.state.database.fetch_all("SELECT * FROM V_OBSERVED_DRIVER_PROFILES")
    profiles = [HistoricalProfile(driver_id=str(row["driverId"]), pace=float(row["pooledMedianPace"])) for row in rows if row.get("supportStatus") == "sufficient"]
    if payload.scenario.fieldMode == "synthetic_100": profiles = generate_synthetic_stress_field(profiles)
    vm_pace = min(item.pace for item in profiles) - payload.scenario.virtualMaxAdvantageSecondsPerLap
    return vm_pace, [{"driverId": item.driver_id, "pace": item.pace} for item in profiles] + [{"driverId": "VIRTUAL_MAX", "pace": vm_pace}]

@router.post("/joker", response_model=JokerStrategyResponse)
def joker(payload: JokerStrategyRequest, request: Request):
    try:
        vm_pace, field = _field(payload, request)
        driver_id = "VIRTUAL_MAX" if payload.driverId.upper().replace(" ", "_") == "VIRTUAL_MAX" else payload.driverId
        return evaluate_joker_strategy(driver_id=driver_id, route_id=payload.routeId, lap=payload.lap, speed_factor=payload.jokerSpeedFactor, race_laps=payload.scenario.raceLaps, virtual_max_pace=vm_pace, starting_delay_seconds=payload.scenario.startingDelaySeconds, field=field)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Joker strategy inputs are unavailable.") from exc

@router.post("/joker/compare")
def compare(payload: JokerComparisonRequest, request: Request):
    try:
        vm_pace, field = _field(payload, request)
        return evaluate_joker_options(driver_id="VIRTUAL_MAX" if payload.driverId.upper().replace(" ", "_") == "VIRTUAL_MAX" else payload.driverId, options=[item.model_dump() for item in payload.options], race_laps=payload.scenario.raceLaps, virtual_max_pace=vm_pace, starting_delay_seconds=payload.scenario.startingDelaySeconds, field=field)
    except ValueError as exc: raise HTTPException(status_code=409, detail=str(exc)) from exc
    except Exception as exc: raise HTTPException(status_code=503, detail="Joker comparison inputs are unavailable.") from exc
