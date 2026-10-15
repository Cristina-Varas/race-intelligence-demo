from fastapi import APIRouter, HTTPException, Request

from ..models.responses import SimulationRequest, SimulationResponse
from ..simulation import HistoricalProfile, run_simulation


router = APIRouter(prefix="/api/simulation", tags=["simulation"])


@router.post("/run", response_model=SimulationResponse)
def run(request_model: SimulationRequest, request: Request):
    """Run a transient what-if simulation without changing governed Gold data."""
    try:
        profile_rows = request.app.state.database.fetch_all("SELECT * FROM V_OBSERVED_DRIVER_PROFILES")
        variability_rows = request.app.state.database.fetch_all("SELECT * FROM V_HISTORICAL_VARIABILITY")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Historical serving data is unavailable for custom simulation.") from exc

    profiles = [
        HistoricalProfile(driver_id=str(row["driverId"]), pace=float(row["pooledMedianPace"]))
        for row in profile_rows
        if row.get("supportStatus") == "sufficient"
    ]
    deviations = [float(row["lapDeviation"]) for row in variability_rows if row.get("lapDeviation") is not None]
    if not profiles:
        raise HTTPException(status_code=409, detail="No supported historical driver profiles are available.")
    if not deviations:
        raise HTTPException(status_code=409, detail="Historical variability is unavailable for custom simulation.")
    try:
        return run_simulation(
            profiles,
            deviations,
            race_laps=request_model.raceLaps or 30,
            virtual_max_advantage_seconds_per_lap=request_model.virtualMaxAdvantageSecondsPerLap,
            starting_delay_seconds=request_model.startingDelaySeconds,
            simulations=request_model.simulations,
            field_mode=request_model.fieldMode,
            race_model_mode=request_model.raceModelMode,
            pace_profile=None if request_model.paceProfile is None else [phase.model_dump() for phase in request_model.paceProfile],
            traffic_cost_model=None if request_model.trafficCostModel is None else request_model.trafficCostModel.model_dump(),
            field_variability_mode=request_model.fieldVariabilityMode,
            field_variability_seed=request_model.fieldVariabilitySeed,
            race_format=request_model.raceFormat,
            race_duration_seconds=request_model.raceDurationSeconds,
            timed_finish_rule=request_model.timedFinishRule,
        )
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
