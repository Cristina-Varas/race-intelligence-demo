from fastapi import APIRouter, Request

router = APIRouter(tags=["health"])


@router.get("/health")
def health(request: Request, check_database: bool = False) -> dict[str, object]:
    database = request.app.state.database
    response: dict[str, object] = {"status": "ok", "databaseConfigured": database.settings.database_configured}
    if check_database:
        response["databaseReachable"] = database.ping()
    return response
