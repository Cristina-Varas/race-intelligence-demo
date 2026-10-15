from fastapi import APIRouter, HTTPException, Request

from ..models.responses import ProbabilityPoint, ScenarioSummary
from ..serializers import row_response, scenario_summary_response

router = APIRouter(prefix="/api/scenario", tags=["scenario"])


@router.get("/summary", response_model=ScenarioSummary)
def summary(request: Request):
    rows = request.app.state.database.fetch_all("SELECT * FROM V_RACE_SCENARIO_SUMMARY")
    if not rows:
        raise HTTPException(status_code=404, detail="No scenario summary is available.")
    return scenario_summary_response(rows[0])


@router.get("/probability-curve", response_model=list[ProbabilityPoint])
def probability_curve(request: Request):
    rows = request.app.state.database.fetch_all("SELECT * FROM V_RACE_PROBABILITY_CURVE")
    return [
        {
            "delaySeconds": row_response(row)["delaySeconds"],
            "catchProbability": row_response(row)["fullFieldCatchProbability"],
        }
        for row in sorted(rows, key=lambda row: float(row["delaySeconds"]))
    ]


@router.get("/virtual-max")
def virtual_max(request: Request):
    rows = request.app.state.database.fetch_all("SELECT * FROM V_VIRTUAL_MAX")
    if not rows:
        raise HTTPException(status_code=404, detail="No synthetic Virtual Max scenario is available.")
    return row_response(rows[0])
