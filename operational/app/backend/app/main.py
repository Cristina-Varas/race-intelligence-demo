from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from typing import Optional

from .config import Settings
from .db import Database
from .persistence.event_capture import UnavailableEventCaptureRepository
from .routers import event, health, historical, replay, scenario, simulation, strategy
from .services.event_capture import EventCaptureService
from .services.event_journal import EventJournal, EventJournalError
from .integrations.aks.live_events import EventMomentCandidateConsumer, InProcessEventBus, OperationalMetricsConsumer
from .integrations.aks.live_state import LiveEventStateStore
from .integrations.aks.live_service import LiveSourceService
from .services.live_baseball_cards import LiveBaseballCards
from .services.event_moments import HotPathMomentService
from .routers import live_moments


def create_app(
    settings: Optional[Settings] = None,
    database: Optional[Database] = None,
    event_capture: Optional[EventCaptureService] = None,
) -> FastAPI:
    app = FastAPI(title="Race Intelligence Serving API", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1):517[3-9]$",
        allow_credentials=False,
        allow_methods=["GET", "POST"],
        allow_headers=["Content-Type"],
    )
    resolved_settings = settings or Settings.from_env()
    app.state.database = database or Database(resolved_settings)
    app.state.event_capture = event_capture or EventCaptureService(
        journal=EventJournal(resolved_settings.event_journal_dir),
        repository=UnavailableEventCaptureRepository(),
    )
    # Operational hot-path dependencies are intentionally transport-neutral.
    # A future Kafka/OCI adapter publishes the same NormalizedEvent contract.
    app.state.live_event_bus = InProcessEventBus()
    app.state.live_event_state = LiveEventStateStore(source_epochs=app.state.live_event_bus.source_epochs)
    app.state.live_event_moments = EventMomentCandidateConsumer()
    app.state.live_event_metrics = OperationalMetricsConsumer()
    app.state.live_baseball_cards = LiveBaseballCards(source_epochs=app.state.live_event_bus.source_epochs,state_store=app.state.live_event_state)
    app.state.live_event_bus.subscribe(app.state.live_event_state)
    app.state.live_event_bus.subscribe(app.state.live_event_moments)
    app.state.live_event_bus.subscribe(app.state.live_event_metrics)
    app.state.live_event_bus.subscribe(app.state.live_baseball_cards)
    app.state.live_source = LiveSourceService(app.state.live_event_bus, app.state.live_event_metrics)
    app.state.captured_live_moments = HotPathMomentService(app.state.live_event_moments, app.state.live_baseball_cards, app.state.live_source.mode)
    app.state.live_event_bus.subscribe(app.state.captured_live_moments)

    @app.on_event("startup")
    async def start_live_source():
        app.state.live_source.start()

    @app.on_event("shutdown")
    async def stop_live_source():
        await app.state.live_source.close()

    @app.exception_handler(EventJournalError)
    async def event_journal_error(_: Request, exc: EventJournalError):
        return JSONResponse(status_code=503, content={"detail": str(exc)})
    app.include_router(health.router)
    app.include_router(scenario.router)
    app.include_router(historical.router)
    app.include_router(simulation.router)
    app.include_router(replay.router)
    app.include_router(strategy.router)
    app.include_router(event.router)
    app.include_router(live_moments.router)
    return app


app = create_app()
