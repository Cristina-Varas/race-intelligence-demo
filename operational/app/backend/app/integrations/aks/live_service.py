"""Single-process raw-first source orchestration. No database or broker writes."""
from __future__ import annotations

import asyncio
import os
import logging
import time
from pathlib import Path
from .client import AksTimingClient
from .live_adapter import AksLiveIngestAdapter
from .live_replay import replay_recording
from .recorder import AksRawSessionRecorder
from ...config import AksSettings
from ...shutdown import BACKGROUND_STOP_SECONDS, TLS_CLOSE_SECONDS


class LiveSourceService:
    def __init__(self, bus, metrics):
        self.mode = os.getenv("EVENT_SOURCE_MODE", "replay").lower()
        if self.mode not in {"replay", "live"}: raise ValueError("EVENT_SOURCE_MODE must be replay or live")
        self.session_id = os.getenv("EVENT_SOURCE_SESSION_ID", "REHEARSAL_LIVE_CHECK")
        self.context = os.getenv("EVENT_OPERATIONAL_CONTEXT", "REHEARSAL")
        self.path = os.getenv("EVENT_REPLAY_PATH")
        self.speed = float(os.getenv("EVENT_REPLAY_SPEED", "1"))
        if self.speed not in {1, 5, 30}: raise ValueError("EVENT_REPLAY_SPEED must be 1, 5 or 30")
        self.bus, self.metrics = bus, metrics
        self.status = "NOT_STARTED"
        self.task = None
        self.stop = None  # Construct asyncio primitives only inside the running loop (Python 3.9).
        self.client = None
        self.recorder = None
        self.stopping = False
        self.shutdown_started = None
        self.shutdown_stages = []

    def stage(self, name):
        elapsed = (time.monotonic() - self.shutdown_started) * 1000 if self.shutdown_started is not None else 0
        self.shutdown_stages.append({"stage": name, "elapsedMs": elapsed})
        logging.getLogger("uvicorn.error").info("LIVE_SHUTDOWN stage=%s elapsedMs=%.3f", name, elapsed)

    def request_stop(self):
        """Run on the event loop, never inside a raw-write signal interruption."""
        if self.stopping: return
        self.shutdown_started = time.monotonic()
        self.stopping = True
        self.status = "STOPPING"
        self.stage("STOP_REQUESTED")
        if self.stop: self.stop.set()
        if self.task and not self.task.done(): self.task.cancel()
        self.stage("SOURCE_LOOP_STOPPED")
        # Intake is synchronous and gated: no append can race this finalization.
        if self.recorder and self.recorder.active: self.recorder.stop()
        self.stage("RECORDER_FINALIZED")

    def metadata(self):
        return {"mode": self.mode.upper(), "sessionId": self.session_id, "operationalContext": self.context,
                "speed": self.speed if self.mode == "replay" else None, "status": self.status}

    def start(self):
        # Importing the app or running tests never opens a live transport implicitly.
        if self.mode == "replay" and not self.path:
            self.status = "AWAITING_REPLAY_CONFIGURATION"
            return
        self.task = asyncio.create_task(self.run())

    async def run(self):
        self.stop = asyncio.Event()
        recorder = None
        adapter = None
        try:
            settings = AksSettings.from_env() if self.mode == "live" else AksSettings(host=None)
            recorder = AksRawSessionRecorder(self.session_id,
                Path(os.getenv("EVENT_RAW_OUTPUT_DIR", str(Path.home() / ".race-intelligence" / "hot-path"))),
                operational_context=self.context, fsync_every=1)
            recorder.start()
            self.recorder = recorder
            def persist(line):
                if self.stopping: raise asyncio.CancelledError()
                # A failed durable append stops this source; never acknowledge/drop raw evidence.
                try: recorder.record_line(line)
                except OSError as exc:
                    raise RuntimeError("RAW_PERSISTENCE_FAILED") from exc
                self.metrics.events_received += 1
            adapter = AksLiveIngestAdapter(session_id=self.session_id, client=AksTimingClient(settings),
                publisher=self.bus, persist_raw=persist, operational_context=self.context)
            self.status = "RUNNING"
            if self.mode == "replay":
                # archive:// URIs materialize through the explicit archive boundary;
                # normal local paths retain the existing replay reader unchanged.
                from ...services.event_archive import materialize_archive_uri
                replay_path = materialize_archive_uri(self.path,
                    archive_root=os.getenv("RACE_EVENT_ARCHIVE_DIR", "/private/tmp/race-intelligence-event-archive"),
                    cache_dir=os.getenv("RACE_EVENT_ARCHIVE_CACHE_DIR", "/private/tmp/race-intelligence-event-archive-cache"))
                await replay_recording(replay_path, adapter, speed=self.speed)
                self.status = "REPLAY_COMPLETE"
            else:
                # Reuse validated transport, authentication, subscription and keepalive stack.
                # The adapter has its own existing state-store instance: the callback runs
                # before the transport parses control replies, never twice on the same store.
                self.client = AksTimingClient(settings)
                self.client.configure_subscriptions(settings.subscriptions)
                def lifecycle(status):
                    recorder.note_connection(status)
                    adapter.connection_state(status, reconnect_count=self.client.reconnect_count)
                await self.client.run_with_reconnect(self.stop, on_received_line=adapter.process_line,
                                                       on_connection_state=lifecycle)
        except asyncio.CancelledError:
            self.status = "STOPPED"
            raise
        except Exception:
            # Never serialize exceptions carrying connection information or raw frames.
            self.status = "SOURCE_FAILED"
            self.metrics.normalization_errors += 1
        finally:
            # Durable local evidence always precedes optional network cleanup.
            if recorder and recorder.active: recorder.stop()
            try:
                if self.client: await self.client.disconnect()
            finally:
                if self.stopping:
                    result = getattr(self.client, "tls_close_result", {})
                    self.stage("TLS_CLOSE_ABORTED" if result.get("tlsGracefulClose") is False else "TLS_CLOSE_COMPLETE")
                if adapter: adapter.connection_state("DISCONNECTED")

    async def close(self):
        self.request_stop()
        if self.task:
            done, pending = await asyncio.wait({self.task}, timeout=BACKGROUND_STOP_SECONDS + TLS_CLOSE_SECONDS)
            if pending:
                self.task.cancel()
                logging.getLogger("uvicorn.error").warning("LIVE_SHUTDOWN background deadline exceeded")
                raise RuntimeError("LIVE_BACKGROUND_SHUTDOWN_TIMEOUT")
            try: self.task.result()
            except asyncio.CancelledError: pass
        self.stage("BACKGROUND_TASKS_STOPPED")
