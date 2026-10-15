from fastapi import APIRouter, Request

from ..serializers import row_response

router = APIRouter(prefix="/api/historical", tags=["historical"])


@router.get("/drivers")
def drivers(request: Request):
    rows = request.app.state.database.fetch_all("SELECT * FROM V_OBSERVED_DRIVER_PROFILES")
    supported = (row for row in rows if row["supportStatus"] == "sufficient")
    return [row_response(row) for row in sorted(supported, key=lambda row: float(row["pooledMedianPace"]))]
