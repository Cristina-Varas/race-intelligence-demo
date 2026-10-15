from fastapi import APIRouter, HTTPException

from ..services.replay import historical_replay_metadata, historical_replay_response
from ..services.track_geometry import load_normalized_geometry, rebase_geometry_for_replay
from ..services.track_topology import load_track_topology


router = APIRouter(tags=["track-replay"])


@router.get("/api/track")
def track():
    geometry = rebase_geometry_for_replay(load_normalized_geometry())
    metadata = geometry["metadata"]
    return {
        "trackLengthMeters": metadata["trackLengthMeters"],
        "closedLoop": metadata["closedLoop"],
        "pointCount": len(geometry["points"]),
        "sourcePointCount": metadata["sourcePointCount"],
        "startFinishSource": metadata["startFinishSource"],
        "replayDirection": metadata["replayDirection"],
        "replayStartAnchor": metadata["replayStartAnchor"],
        "geometry": [{key: point[key] for key in ("normalizedDistance", "latitude", "longitude")} for point in geometry["points"]],
    }


@router.get("/api/track/topology")
def track_topology():
    """Reference geometry only; it is intentionally separate from race evidence."""
    return load_track_topology()


@router.get("/api/replay/historical/meta")
def historical_meta():
    try:
        return historical_replay_metadata()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Historical replay anchors are unavailable.") from exc


@router.get("/api/replay/historical")
def historical_replay():
    try:
        return historical_replay_response()
    except FileNotFoundError as exc:
        raise HTTPException(status_code=503, detail="Historical replay anchors are unavailable.") from exc
