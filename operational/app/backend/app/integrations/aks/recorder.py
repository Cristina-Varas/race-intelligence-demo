"""Crash-safe, capture-first AKS raw session recorder.

The recorder deliberately has no Event Capture, database, AIDP or frontend
dependency.  It writes the same manifest/chunk envelope consumed by
``AksRecordingLoader`` so a completed directory can be replayed directly or
packaged later without changing the source evidence.
"""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from datetime import datetime, timezone
import json
import logging
from pathlib import Path
import shutil
import signal
import time
from typing import Any
from zipfile import ZIP_DEFLATED, ZipFile

from ...config import AksSettings
from .client import AksFrameLimitError, AksTimingClient
from .protocol import CRLF, parse_json_payload, parse_packet
from .recording import AksRecordingLoader, RAW_SCHEMA, TRACKED_CHANNELS


MANIFEST_SCHEMA = "maxv100.alkamel.session-manifest.v1"
DEFAULT_ROTATE_SECONDS = 120.0
DEFAULT_STALL_SECONDS = 30.0


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _iso(value: datetime) -> str:
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


class AksRawSessionRecorder:
    """Append-only raw recorder.  ``record_line`` runs before the AKS parser."""

    def __init__(self, session_id: str, output_dir: str | Path, *, event_id: str | None = None,
                 subscriptions: tuple[str, ...] = (), rotate_seconds: float = DEFAULT_ROTATE_SECONDS,
                 rotate_messages: int | None = None, fsync_every: int = 1,
                 operational_context: str = "REHEARSAL"):
        if not session_id:
            raise ValueError("AKS recorder requires a stable session id.")
        if rotate_seconds <= 0:
            raise ValueError("rotate_seconds must be positive.")
        if operational_context not in {"REHEARSAL", "ACTUAL_EVENT"}:
            raise ValueError("operational_context must be REHEARSAL or ACTUAL_EVENT.")
        self.session_id, self.event_id = str(session_id), event_id
        self.operational_context = operational_context
        self.output_dir = Path(output_dir)
        self.subscriptions = tuple(dict.fromkeys(subscriptions))
        self.rotate_seconds, self.rotate_messages = rotate_seconds, rotate_messages
        self.fsync_every = max(1, fsync_every)
        self.path: Path | None = None
        self._raw: Any | None = None
        self._chunk_opened: datetime | None = None
        self._chunk: dict[str, Any] | None = None
        self._chunks: list[dict[str, Any]] = []
        self._sequence = 0
        self._bytes = 0
        self._counts: Counter[str] = Counter()
        self._started: datetime | None = None
        self._last_received: datetime | None = None
        self._connection_id = 0
        self._reconnect_count = 0
        self._finished = False
        self._logger = logging.getLogger(__name__)

    @property
    def active(self) -> bool:
        return self._raw is not None and not self._finished

    def start(self) -> Path:
        self.output_dir.mkdir(parents=True, exist_ok=True)
        if not self.output_dir.is_dir():
            raise OSError(f"AKS recorder output is not a directory: {self.output_dir}")
        probe = self.output_dir / ".aks-write-probe"
        probe.write_text("ok", encoding="utf-8")
        probe.unlink()
        self._started = _utc_now()
        stamp = self._started.strftime("%Y%m%dT%H%M%SZ")
        candidate = self.output_dir / f"session-{self.session_id}-{stamp}"
        suffix = 1
        while candidate.exists():
            suffix += 1
            candidate = self.output_dir / f"session-{self.session_id}-{stamp}-{suffix:02d}"
        candidate.mkdir()
        (candidate / "raw").mkdir()
        self.path = candidate
        self._open_chunk()
        self._write_metadata(active=True)
        return candidate

    def _open_chunk(self) -> None:
        if not self.path:
            raise RuntimeError("Start the AKS recorder before writing messages.")
        now = _utc_now()
        number = len(self._chunks) + 1
        relative = f"raw/alkamel-raw-{number:06d}.jsonl"
        self._raw = (self.path / relative).open("a", encoding="utf-8", newline="\n")
        self._chunk_opened = now
        self._chunk = {"file": relative, "openedAt": _iso(now), "closedAt": None, "lineCount": 0, "bytes": 0}
        self._chunks.append(self._chunk)

    def _close_chunk(self) -> None:
        if not self._raw:
            return
        self._raw.flush()
        try:
            import os
            os.fsync(self._raw.fileno())
        finally:
            self._raw.close()
        self._raw = None
        if self._chunk:
            self._chunk["closedAt"] = _iso(_utc_now())

    def _should_rotate(self, now: datetime) -> bool:
        if not self._chunk or not self._chunk_opened:
            return False
        if self.rotate_messages and self._chunk["lineCount"] >= self.rotate_messages:
            return True
        return (now - self._chunk_opened).total_seconds() >= self.rotate_seconds

    def _envelope(self, line: bytes | str, now: datetime) -> dict[str, Any]:
        raw = line.decode("utf-8", errors="surrogateescape") if isinstance(line, bytes) else line
        wire = raw[:-len(CRLF)] if raw.endswith(CRLF) else raw
        try:
            packet = parse_packet(raw if raw.endswith(CRLF) else f"{raw}{CRLF}")
            command, message_id, channel = packet.command, packet.message_id, packet.channel
        except Exception:
            command, message_id, channel = "UNKNOWN", "", ""
        return {
            "schema": RAW_SCHEMA, "recordedAt": _iso(now), "recordedAtMs": int(now.timestamp() * 1000),
            "lineNumber": self._sequence, "connectionId": self._connection_id,
            "command": command, "messageId": message_id, "channel": channel, "line": wire,
        }

    def record_line(self, line: bytes | str, *, received_at: datetime | None = None) -> None:
        """Persist the exact inbound line before any parsing or normalization."""
        if not self.active:
            raise RuntimeError("AKS recorder is not active.")
        now = received_at or _utc_now()
        if self._should_rotate(now):
            self._close_chunk()
            self._open_chunk()
        self._sequence += 1
        envelope = self._envelope(line, now)
        encoded = json.dumps(envelope, ensure_ascii=False, separators=(",", ":")) + "\n"
        assert self._raw is not None and self._chunk is not None
        self._raw.write(encoded)
        self._raw.flush()
        if self._sequence % self.fsync_every == 0:
            import os
            os.fsync(self._raw.fileno())
        size = len(encoded.encode("utf-8", errors="surrogateescape"))
        self._bytes += size
        self._chunk["lineCount"] += 1
        self._chunk["bytes"] += size
        self._counts[envelope["command"]] += 1
        self._last_received = now
        self._write_latest(active=True)

    def note_connection(self, state: str) -> None:
        if state == "CONNECTED":
            self._connection_id += 1
        elif state == "RECONNECTING":
            self._reconnect_count += 1
        if self.active:
            self._write_latest(active=True, connection_state=state)

    def _manifest(self, *, active: bool) -> dict[str, Any]:
        assert self._started is not None
        return {
            "schema": MANIFEST_SCHEMA, "source": "AKS_LIVE_RECORDING", "eventId": self.event_id,
            "sessionId": self.session_id, "operationalContext": self.operational_context,
            "openedAt": _iso(self._started),
            "closedAt": None if active else _iso(_utc_now()), "chunks": self._chunks,
            "recording": {"status": "RECORDING" if active else "RECORDER_FINISHED", "lineCount": self._sequence,
                          "bytes": self._bytes, "messageTypeCounts": dict(sorted(self._counts.items())),
                          "jsonMessageCount": self._counts["JSON"], "reconnectCount": self._reconnect_count,
                          "subscriptions": list(self.subscriptions), "rotationSeconds": self.rotate_seconds},
        }

    def _atomic_json(self, name: str, body: dict[str, Any]) -> None:
        assert self.path is not None
        target, temporary = self.path / name, self.path / f".{name}.tmp"
        temporary.write_text(json.dumps(body, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
        temporary.replace(target)

    def _write_latest(self, *, active: bool, connection_state: str | None = None) -> None:
        self._atomic_json("latest.json", {
            "eventId": self.event_id, "sessionId": self.session_id,
            "operationalContext": self.operational_context,
            "activeChunk": self._chunk["file"] if active and self._chunk else None,
            "lastRecordedAt": _iso(self._last_received) if self._last_received else None,
            "lineCount": self._sequence, "bytes": self._bytes,
            "connectionState": connection_state or ("RECORDING" if active else "FINISHED"),
            "reconnectCount": self._reconnect_count,
        })

    def _write_metadata(self, *, active: bool) -> None:
        self._atomic_json("manifest.json", self._manifest(active=active))
        self._write_latest(active=active)

    def stop(self) -> dict[str, Any]:
        if self._finished:
            return self.summary()
        self._close_chunk()
        self._finished = True
        self._write_metadata(active=False)
        return self.summary()

    def summary(self) -> dict[str, Any]:
        elapsed = (_utc_now() - self._started).total_seconds() if self._started else 0.0
        return {"session": self.session_id, "output": str(self.path) if self.path else None,
                "elapsedSeconds": elapsed, "rawFiles": len(self._chunks), "messages": self._sequence,
                "jsonMessages": self._counts["JSON"], "reconnects": self._reconnect_count, "bytes": self._bytes}

    def package(self, destination: str | Path | None = None) -> Path:
        if not self.path or not self._finished:
            raise RuntimeError("Stop the recorder cleanly before packaging it.")
        archive = Path(destination) if destination else self.path.with_suffix(".zip")
        if archive.exists():
            raise FileExistsError(f"AKS recording archive already exists: {archive}")
        with ZipFile(archive, "w", ZIP_DEFLATED) as zip_file:
            for file in sorted(self.path.rglob("*")):
                if file.is_file():
                    zip_file.write(file, f"{self.path.name}/{file.relative_to(self.path).as_posix()}")
        return archive


async def record(
    settings: AksSettings,
    recorder: AksRawSessionRecorder,
    *,
    stall_seconds: float = DEFAULT_STALL_SECONDS,
    duration_seconds: float | None = None,
) -> dict[str, Any]:
    """Run record-only mode.  Raw persistence is the only critical path."""
    recorder.start()
    client = AksTimingClient(settings)
    client.configure_subscriptions(settings.subscriptions or TRACKED_CHANNELS)
    stop = asyncio.Event()
    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, stop.set)
        except NotImplementedError:  # pragma: no cover - Windows fallback
            pass
    if duration_seconds is not None and duration_seconds <= 0:
        raise ValueError("duration_seconds must be positive when provided.")
    monitor = asyncio.create_task(_health_monitor(stop, recorder, client, stall_seconds))
    shutdown = asyncio.create_task(_disconnect_when_stopped(stop, client))
    timed_stop = asyncio.create_task(_stop_after(stop, duration_seconds)) if duration_seconds else None
    try:
        await client.run_with_reconnect(stop, on_received_line=recorder.record_line, on_connection_state=recorder.note_connection)
    finally:
        stop.set()
        monitor.cancel()
        shutdown.cancel()
        if timed_stop:
            timed_stop.cancel()
        recorder.stop()
    return recorder.summary()


async def preflight(
    settings: AksSettings,
    output_dir: str | Path,
    *,
    connect: bool = False,
    observe_seconds: float = 5.0,
    session_context: str | None = None,
    discover_subscriptions: bool = True,
    join_timeout_seconds: float = 5.0,
) -> dict[str, Any]:
    """Safely validate AKS connectivity without creating source evidence.

    A connected preflight authenticates, optionally diagnoses configured subscriptions,
    observes a bounded amount of traffic metadata, sends LEAVE requests, and
    closes.  It never persists inbound messages or serializes credentials.
    """
    if observe_seconds < 0 or observe_seconds > 60:
        raise ValueError("observe_seconds must be between 0 and 60.")
    target = Path(output_dir)
    target.mkdir(parents=True, exist_ok=True)
    probe = target / ".aks-preflight-probe"
    probe.write_text("ok", encoding="utf-8")
    probe.unlink()
    usage = shutil.disk_usage(target)
    result: dict[str, Any] = {"hostConfigured": bool(settings.host), "port": settings.port,
              "outputWritable": True, "freeBytes": usage.free,
              "tlsEnabled": settings.tls_enabled, "tlsVerify": settings.tls_verify,
              "streamLimitBytes": settings.stream_limit_bytes,
              "configuredSubscriptions": list(settings.subscriptions), "connected": False,
              "operationalContext": "REHEARSAL", "sessionContext": session_context,
              "authentication": "NOT_ATTEMPTED",
              "traffic": {"observationSeconds": observe_seconds, "messagesReceived": 0,
                          "messageRatePerSecond": 0.0, "channels": [], "topLevelFields": [],
                          "firstObservedAt": None, "lastObservedAt": None}}
    if connect:
        client = AksTimingClient(settings)
        client.configure_subscriptions(settings.subscriptions)
        await client.connect()
        try:
            await client.await_login_reply()
            result["authentication"] = "SUCCEEDED"
            if discover_subscriptions:
                result["subscriptionResults"] = await client.discover_subscriptions(
                    timeout_seconds=join_timeout_seconds,
                )
            else:
                await client.verify_subscriptions()
                result["subscriptionResults"] = [
                     {"channel": channel, "joinSent": True, "status": "ACK_CONFIRMED", "elapsedMs": None,
                     "responseFrames": []}
                    for channel in sorted(client.subscriptions)
                ]
            result["connected"] = True
            result["connectionState"] = client.connection_state.value
            result["protocol"] = {
                "serverName": client.server_name,
                "serverVersion": client.server_version,
                "minimumProtocolVersion": client.minimum_protocol_version,
                "pingRateSeconds": client.ping_rate_seconds,
                "timeoutSeconds": client.timeout_seconds,
            }
            result["traffic"] = await _observe_preflight_traffic(
                client, observe_seconds, allowed_channels=client.subscriptions,
            )
        finally:
            try:
                await client.leave_subscriptions()
                result["leaveRequested"] = True
            except (ConnectionError, OSError):
                # A server may close immediately after its final observation.
                # The socket is still closed below; never fabricate a LEAVE ACK.
                result["leaveRequested"] = False
            finally:
                await client.disconnect()
    return result


async def _observe_preflight_traffic(
    client: AksTimingClient,
    observe_seconds: float,
    *,
    allowed_channels: frozenset[str],
) -> dict[str, Any]:
    """Return aggregate protocol metadata only; raw wire evidence is not kept."""
    started = time.monotonic()
    channels: Counter[str] = Counter()
    top_level_fields: set[str] = set()
    messages = 0
    ignored_asynchronous_frames = 0
    first_observed: datetime | None = None
    last_observed: datetime | None = None
    while (remaining := observe_seconds - (time.monotonic() - started)) > 0:
        try:
            line = await asyncio.wait_for(client.next_inbound_line(), timeout=remaining)
        except asyncio.TimeoutError:
            break
        except AksFrameLimitError:
            return {
                "observationSeconds": round(max(0.0, time.monotonic() - started), 3),
                "messagesReceived": messages,
                "messageRatePerSecond": 0.0,
                "channels": [{"channel": channel, "messages": count} for channel, count in sorted(channels.items())],
                "topLevelFields": sorted(top_level_fields)[:24],
                "firstObservedAt": _iso(first_observed) if first_observed else None,
                "lastObservedAt": _iso(last_observed) if last_observed else None,
                "ignoredAsynchronousFrames": ignored_asynchronous_frames,
                "diagnostic": "FRAME_LIMIT_EXCEEDED",
            }
        except ConnectionError:
            # The connected preflight already succeeded; a server can close a
            # quiet/rehearsal stream before the bounded observation expires.
            break
        observed_at = _utc_now()
        try:
            packet = parse_packet(line)
            if packet.command == "JSON" and packet.channel and packet.channel not in allowed_channels:
                ignored_asynchronous_frames += 1
                client.handle_line(line)
                continue
            messages += 1
            first_observed = first_observed or observed_at
            last_observed = observed_at
            channels[packet.channel or "ROOT"] += 1
            if packet.command == "JSON":
                payload = parse_json_payload(packet)
                if isinstance(payload, dict):
                    top_level_fields.update(str(field) for field in payload.keys())
        except Exception:
            messages += 1
            first_observed = first_observed or observed_at
            last_observed = observed_at
            channels["MALFORMED"] += 1
        client.handle_line(line)
    elapsed = max(0.0, time.monotonic() - started)
    return {
        "observationSeconds": round(elapsed, 3),
        "messagesReceived": messages,
        "messageRatePerSecond": round(messages / elapsed, 3) if elapsed else 0.0,
        "channels": [{"channel": channel, "messages": count} for channel, count in sorted(channels.items())],
        "topLevelFields": sorted(top_level_fields)[:24],
        "firstObservedAt": _iso(first_observed) if first_observed else None,
        "lastObservedAt": _iso(last_observed) if last_observed else None,
        "ignoredAsynchronousFrames": ignored_asynchronous_frames,
    }


async def _health_monitor(stop: asyncio.Event, recorder: AksRawSessionRecorder, client: AksTimingClient, threshold: float) -> None:
    while not stop.is_set():
        await asyncio.sleep(min(10.0, threshold))
        if recorder._last_received and (_utc_now() - recorder._last_received).total_seconds() > threshold:
            logging.getLogger(__name__).warning("AKS recorder has received no messages for %.1f seconds.", threshold)
        logging.getLogger(__name__).info("AKS recorder health state=%s messages=%s files=%s reconnects=%s", client.connection_state.value, recorder._sequence, len(recorder._chunks), recorder._reconnect_count)


async def _disconnect_when_stopped(stop: asyncio.Event, client: AksTimingClient) -> None:
    await stop.wait()
    await client.disconnect()


async def _stop_after(stop: asyncio.Event, duration_seconds: float) -> None:
    await asyncio.sleep(duration_seconds)
    stop.set()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="AKS raw session recorder")
    commands = parser.add_subparsers(dest="command", required=True)
    record_parser = commands.add_parser("record", help="connect and capture raw inbound AKS protocol traffic")
    record_parser.add_argument("--session", required=True)
    record_parser.add_argument("--output-dir", required=True)
    record_parser.add_argument("--event-id")
    record_parser.add_argument("--rotate-seconds", type=float, default=DEFAULT_ROTATE_SECONDS)
    record_parser.add_argument("--rotate-messages", type=int)
    record_parser.add_argument("--fsync-every", type=int, default=1)
    record_parser.add_argument("--duration-seconds", type=float,
                               help="stop cleanly after this bounded recording duration")
    record_parser.add_argument("--operational-context", choices=("REHEARSAL", "ACTUAL_EVENT"), default="REHEARSAL",
                               help="evidence context persisted in the local manifest")
    preflight_parser = commands.add_parser("preflight", help="validate configuration and output storage without recording")
    preflight_parser.add_argument("--session", required=True, help="operator context only; no recording is created")
    preflight_parser.add_argument("--output-dir", required=True)
    preflight_parser.add_argument("--connect", action="store_true", help="perform LOGIN/JOIN, observe metadata, LEAVE, then disconnect")
    preflight_parser.add_argument("--observe-seconds", type=float, default=5.0,
                                  help="bounded post-JOIN metadata observation (0-60 seconds)")
    preflight_parser.add_argument("--discover-subscriptions", action="store_true",
                                  help="emit safe per-channel JOIN diagnostics; no payload is printed")
    preflight_parser.add_argument("--join-timeout-seconds", type=float, default=5.0,
                                  help="bounded timeout for each configured JOIN (0-10 seconds)")
    inspect_parser = commands.add_parser("inspect", help="summarize a raw recording directory or ZIP")
    inspect_parser.add_argument("recording")
    verify_parser = commands.add_parser("verify", help="validate loader compatibility and ordering")
    verify_parser.add_argument("recording")
    package_parser = commands.add_parser("package", help="package a completed directory without deleting it")
    package_parser.add_argument("recording")
    package_parser.add_argument("--output")
    args = parser.parse_args(argv)
    if args.command in {"inspect", "verify"}:
        loader = AksRecordingLoader(args.recording)
        report = loader.inspect()
        if args.command == "verify":
            sequences = [item.sequence_number for item in loader.iter_messages()]
            if sequences != list(range(1, len(sequences) + 1)):
                raise SystemExit("Recording order is not monotonic.")
        print(json.dumps(report.as_dict(), indent=2, default=str))
        return 0
    if args.command == "package":
        source = Path(args.recording)
        if not source.is_dir():
            raise SystemExit("package accepts a completed recording directory.")
        destination = Path(args.output) if args.output else source.with_suffix(".zip")
        if destination.exists():
            raise SystemExit(f"Refusing to overwrite existing archive: {destination}")
        with ZipFile(destination, "w", ZIP_DEFLATED) as zip_file:
            for file in sorted(source.rglob("*")):
                if file.is_file(): zip_file.write(file, f"{source.name}/{file.relative_to(source).as_posix()}")
        print(destination)
        return 0
    settings = AksSettings.from_env()
    if args.command == "preflight":
        print(json.dumps(asyncio.run(preflight(
            settings, args.output_dir, connect=args.connect,
            observe_seconds=args.observe_seconds, session_context=args.session,
            discover_subscriptions=args.discover_subscriptions or args.connect,
            join_timeout_seconds=args.join_timeout_seconds,
        )), indent=2))
        return 0
    recorder = AksRawSessionRecorder(args.session, args.output_dir, event_id=args.event_id, subscriptions=settings.subscriptions,
                                     rotate_seconds=args.rotate_seconds, rotate_messages=args.rotate_messages,
                                     fsync_every=args.fsync_every, operational_context=args.operational_context)
    print(json.dumps(asyncio.run(record(settings, recorder, duration_seconds=args.duration_seconds)), indent=2))
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
