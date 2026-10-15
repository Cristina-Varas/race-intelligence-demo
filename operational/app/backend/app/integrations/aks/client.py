"""Async SSL/TCP AKS client foundation. It is intentionally not started by FastAPI."""
from __future__ import annotations

import asyncio
from collections import deque
from datetime import datetime, timezone
from enum import Enum
import logging
import ssl
from typing import Any, Callable

from ...config import AksSettings
from ...shutdown import TLS_CLOSE_SECONDS
from .protocol import (
    AksLoginReply, AksPacket, AksProtocolError, build_login, format_packet,
    parse_json_payload, parse_login_reply, parse_packet, protocol_version_is_compatible, response_matches_request,
)
from .state import AksStateStore


class AksFrameLimitError(ConnectionError):
    """A bounded AKS frame exceeded the configured reader capacity."""

    def __init__(self):
        super().__init__("FRAME_LIMIT_EXCEEDED")


class AksConnectionState(str, Enum):
    DISCONNECTED = "DISCONNECTED"
    CONNECTING = "CONNECTING"
    AUTHENTICATED = "AUTHENTICATED"
    SUBSCRIBED = "SUBSCRIBED"
    RECONNECTING = "RECONNECTING"
    ERROR = "ERROR"


class AksTimingClient:
    """Long-lived client with explicit lifecycle; consumers never mutate AKS state."""

    def __init__(self, settings: AksSettings, state_store: AksStateStore | None = None):
        self.settings = settings
        self.state_store = state_store or AksStateStore()
        self.connection_state = AksConnectionState.DISCONNECTED
        self.server_name: str | None = None
        self.server_version: str | None = None
        self.minimum_protocol_version: str | None = None
        self.ping_rate_seconds: float | None = None
        self.timeout_seconds: float | None = None
        self.last_packet_at: datetime | None = None
        self.last_ping_at: datetime | None = None
        self.last_ack_at: datetime | None = None
        self.last_message_at: datetime | None = None
        self.messages_received = 0
        self.json_messages_received = 0
        self.malformed_messages = 0
        self.reconnect_count = 0
        self.last_protocol_error: str | None = None
        self._writer: asyncio.StreamWriter | None = None
        self._reader: asyncio.StreamReader | None = None
        self._subscriptions: set[str] = set()
        self._message_sequence = 0
        self._last_ping_message_id: str | None = None
        # Diagnostic JOIN verification may receive data before a response.  It
        # is retained as raw inbound evidence for the next observer/read loop.
        self._buffered_inbound: deque[bytes] = deque()
        self._logger = logging.getLogger(__name__)

    @property
    def subscriptions(self) -> frozenset[str]:
        return frozenset(self._subscriptions)

    def configure_subscriptions(self, channels: list[str] | tuple[str, ...] | set[str]) -> None:
        """Declare channels before connecting; each is JOINed after every LOGIN."""
        self._subscriptions = {channel for channel in channels if channel}

    def diagnostics(self) -> dict[str, Any]:
        return {
            "connection_state": self.connection_state.value, "messages_received": self.messages_received,
            "json_messages_received": self.json_messages_received, "malformed_messages": self.malformed_messages,
            "reconnect_count": self.reconnect_count, "last_message_at": self.last_message_at.isoformat() if self.last_message_at else None,
        }

    def _ssl_context(self) -> ssl.SSLContext:
        if self.settings.tls_verify:
            return ssl.create_default_context(cafile=self.settings.ca_bundle)
        self._logger.warning("AKS_TLS_VERIFY=false: certificate verification is disabled for the AKS connection only.")
        return ssl._create_unverified_context()

    async def connect(self) -> None:
        if not self.settings.host:
            raise RuntimeError("AKS_HOST is required before opening an AKS connection.")
        self.connection_state = AksConnectionState.CONNECTING
        ssl_context = self._ssl_context() if self.settings.tls_enabled else None
        self._reader, self._writer = await asyncio.open_connection(
            self.settings.host, self.settings.port, ssl=ssl_context,
            server_hostname=self.settings.host if ssl_context else None,
            limit=self.settings.stream_limit_bytes,
        )
        await self.login()

    async def disconnect(self) -> None:
        writer = self._writer
        self._writer = self._reader = None
        self.connection_state = AksConnectionState.DISCONNECTED
        self.tls_close_result = {"tlsGracefulClose": True, "tlsCloseTimeout": False}
        if writer is None:
            return
        try:
            writer.close()
            await asyncio.wait_for(writer.wait_closed(), TLS_CLOSE_SECONDS)
        except (asyncio.TimeoutError, ConnectionResetError, BrokenPipeError, ssl.SSLZeroReturnError, ssl.SSLEOFError) as exc:
            self.tls_close_result = {"tlsGracefulClose": False, "tlsCloseTimeout": isinstance(exc, asyncio.TimeoutError)}
            writer.transport.abort()
            self._logger.warning("AKS_TLS_CLOSE_ABORTED reason=%s", type(exc).__name__)
        except BaseException:
            writer.transport.abort()
            raise

    def _next_message_id(self) -> str:
        self._message_sequence += 1
        return str(self._message_sequence)

    async def _send(self, wire: str) -> None:
        if not self._writer:
            raise ConnectionError("AKS connection is not open.")
        self._writer.write(wire.encode("utf-8"))
        await self._writer.drain()

    async def login(self) -> str:
        message_id = self._next_message_id()
        await self._send(build_login(
            message_id, user=self.settings.user, password=self.settings.password, app=self.settings.app,
            app_version=self.settings.app_version, protocol=self.settings.protocol,
            protocol_version=self.settings.protocol_version,
        ))
        return message_id

    async def join(self, channel: str) -> str:
        if not channel:
            raise ValueError("AKS channel is required.")
        self._subscriptions.add(channel)
        self.state_store.reset_channel(channel)
        message_id = self._next_message_id()
        await self._send(format_packet("JOIN", message_id, channel))
        self.connection_state = AksConnectionState.SUBSCRIBED
        return message_id

    async def leave(self, channel: str) -> str:
        self._subscriptions.discard(channel)
        self.state_store.reset_channel(channel)
        message_id = self._next_message_id()
        await self._send(format_packet("LEAVE", message_id, channel))
        return message_id

    async def leave_subscriptions(self) -> None:
        """Request a clean protocol LEAVE for every configured channel.

        This is deliberately separate from :meth:`disconnect`: a recorder must
        retain its subscription intent across a transient disconnect so that
        ``run_with_reconnect`` can restore it.  Short-lived preflight sessions,
        on the other hand, should explicitly leave before closing the socket.
        """
        for channel in sorted(tuple(self._subscriptions)):
            await self.leave(channel)

    async def ping(self) -> str:
        message_id = self._next_message_id()
        await self._send(format_packet("PING", message_id))
        self._last_ping_message_id = message_id
        self.last_ping_at = datetime.now(timezone.utc)
        return message_id

    async def keepalive_loop(self, stop: asyncio.Event) -> None:
        """Ping at the server-provided cadence without imposing a local default."""
        if not self.ping_rate_seconds or self.ping_rate_seconds <= 0:
            return
        while not stop.is_set():
            try:
                await asyncio.wait_for(stop.wait(), timeout=self.ping_rate_seconds)
            except asyncio.TimeoutError:
                await self.ping()

    async def restore_subscriptions(self) -> None:
        # Official AKS V2: JOIN:n:channel: is confirmed by JOIN:n+:channel:.
        # Discovery buffers interleaved JSON; read_loop records it raw-first.
        for channel in self._subscriptions:
            self.state_store.reset_channel(channel)
        self.last_subscription_results = await self.discover_subscriptions()

    @staticmethod
    def _frame_metadata(line: bytes | str, request_message_id: str) -> dict[str, Any]:
        """Describe a protocol frame without exposing its payload or identity data."""
        raw = line if isinstance(line, bytes) else line.encode("utf-8", errors="replace")
        if raw.strip() == b"":
            return {"frameLength": len(raw), "fieldCount": 0, "responseType": "EMPTY",
                    "messageIdPresent": False, "matchesJoinRequestId": False,
                    "parserRecognized": True, "asynchronous": True, "emptyFrame": True}
        text = raw.decode("utf-8", errors="replace")
        field_count = len(text.removesuffix("\r\n").split(":", 3))
        metadata: dict[str, Any] = {
            "frameLength": len(raw), "fieldCount": field_count,
            "responseType": "UNKNOWN", "messageIdPresent": False,
            "matchesJoinRequestId": False, "parserRecognized": False,
            "asynchronous": True,
        }
        try:
            packet = parse_packet(line)
        except AksProtocolError:
            metadata["parserErrorCategory"] = "MALFORMED_FRAME"
            return metadata
        metadata.update({
            "responseType": packet.command,
            "messageIdPresent": bool(packet.message_id),
            "matchesJoinRequestId": packet.message_id == request_message_id and packet.requires_ack,
            "parserRecognized": True,
        })
        metadata["asynchronous"] = not metadata["matchesJoinRequestId"]
        return metadata

    async def _read_socket_line(self, timeout_seconds: float | None = None) -> bytes:
        if not self._reader:
            raise ConnectionError("AKS connection is not open.")
        # ``readuntil`` preserves the StreamReader buffer on LimitOverrunError;
        # unlike ``readline`` it does not discard an oversized inbound frame.
        read = self._reader.readuntil(b"\r\n")
        try:
            line = await asyncio.wait_for(read, timeout=timeout_seconds) if timeout_seconds is not None else await read
        except (asyncio.LimitOverrunError, ValueError):
            self.connection_state = AksConnectionState.ERROR
            self._logger.warning("AKS FRAME_LIMIT_EXCEEDED; inbound frame remains unread for safe reconnect.")
            raise AksFrameLimitError() from None
        except asyncio.IncompleteReadError:
            # ``readuntil`` raises at EOF while ``readline`` previously
            # returned an empty byte string. A partial unterminated fragment is
            # not a complete AKS frame and is never treated as one.
            raise ConnectionError("AKS socket disconnected.") from None
        if not line:
            raise ConnectionError("AKS socket disconnected.")
        return line

    async def next_inbound_line(self) -> bytes:
        """Consume diagnostic-buffered input before reading the live socket."""
        if self._buffered_inbound:
            return self._buffered_inbound.popleft()
        return await self._read_socket_line()

    async def discover_subscriptions(self, *, timeout_seconds: float = 5.0) -> list[dict[str, Any]]:
        """Safely inspect JOIN behaviour without treating a missing ACK as denial.

        This preflight-only method is intentionally separate from normal
        recording. It sends one JOIN at a time because the live response shape
        is not yet proven, retains every received frame for the later observer,
        and evaluates every configured channel even after a timeout or unknown
        response. No raw payload is returned.
        """
        if timeout_seconds <= 0 or timeout_seconds > 10:
            raise ValueError("JOIN timeout_seconds must be between 0 and 10.")
        requested = sorted(self._subscriptions)
        if len(requested) > 12:
            raise ValueError("AKS discovery supports at most 12 subscriptions per bounded preflight.")
        self._subscriptions.clear()
        results: list[dict[str, Any]] = []
        for channel in requested:
            started = asyncio.get_running_loop().time()
            request_message_id = self._next_message_id()
            await self._send(format_packet("JOIN", request_message_id, channel))
            frames: list[dict[str, Any]] = []
            status = "NO_RESPONSE"
            observed_data = False
            empty_frames = 0
            while True:
                remaining = timeout_seconds - (asyncio.get_running_loop().time() - started)
                if remaining <= 0:
                    break
                try:
                    line = await self._read_socket_line(remaining)
                except asyncio.TimeoutError:
                    break
                except AksFrameLimitError:
                    status = "FRAME_LIMIT_EXCEEDED"
                    break
                except ConnectionError:
                    status = "DISCONNECTED"
                    break
                frame = self._frame_metadata(line, request_message_id)
                frame["elapsedMs"] = round((asyncio.get_running_loop().time() - started) * 1000)
                frames.append(frame)
                if frame.get("emptyFrame"):
                    empty_frames += 1
                    continue
                self._buffered_inbound.append(line)
                observed_data = observed_data or frame["responseType"] == "JSON"
                if not frame["parserRecognized"]:
                    status = "PROTOCOL_ERROR"
                    continue
                packet = parse_packet(line)
                if packet.command == "ERROR" and packet.message_id == request_message_id:
                    status = "REJECTED"
                    break
                if not frame["matchesJoinRequestId"]:
                    continue
                if response_matches_request(packet, request_message_id, "JOIN", channel):
                    status = "JOIN_CONFIRMED"
                    self._subscriptions.add(channel)
                    self.connection_state = AksConnectionState.SUBSCRIBED
                    break
                status = "PROTOCOL_ERROR"
            if status in {"NO_RESPONSE", "PROTOCOL_ERROR"} and observed_data:
                status = "DATA_OBSERVED_NO_JOIN_CONFIRMATION"
            results.append({
                "channel": channel, "joinSent": True, "status": status,
                "elapsedMs": round((asyncio.get_running_loop().time() - started) * 1000),
                "responseFrames": frames, "dataBeforeJoinConfirmation": observed_data,
                "dataFramesObserved": sum(frame["responseType"] == "JSON" for frame in frames),
                "bytesObserved": sum(frame["frameLength"] for frame in frames),
                "largestFrameBytes": max((frame["frameLength"] for frame in frames), default=0),
                "emptyFramesIgnored": empty_frames,
            })
        return results

    async def verify_subscriptions(self) -> None:
        """Legacy strict preflight assertion; normal recording stays tolerant."""
        if not self._reader:
            raise ConnectionError("AKS connection is not open.")
        results = await self.discover_subscriptions()
        failed = [result["channel"] for result in results if result["status"] != "JOIN_CONFIRMED"]
        if failed:
            raise AksProtocolError(f"AKS JOIN was not acknowledged for {', '.join(failed)}.")

    def handle_line(self, line: str | bytes) -> AksPacket | None:
        now = datetime.now(timezone.utc)
        try:
            packet = parse_packet(line)
            self.messages_received += 1
            self.last_packet_at = self.last_message_at = now
            if packet.command == "ACK":
                if self._last_ping_message_id is None or packet.message_id == self._last_ping_message_id:
                    self.last_ack_at = now
            elif packet.command == "JSON":
                payload = parse_json_payload(packet)
                if packet.channel:
                    self.state_store.apply_channel(packet.channel, payload, message_id=packet.message_id, received_at=now.isoformat(), raw_payload=packet.data)
                elif isinstance(payload, dict):
                    self.state_store.apply_root_delta(payload, message_id=packet.message_id, received_at=now.isoformat(), raw_payload=packet.data)
                else:
                    raise AksProtocolError("Root AKS JSON payload must be an object.")
                self.json_messages_received += 1
            elif packet.command in {"REPLY", "LOGIN"}:
                self._apply_login_reply(packet)
            elif packet.command == "ERROR":
                raise AksProtocolError(f"AKS server ERROR: {packet.data or 'unspecified error'}")
            return packet
        except AksProtocolError as exc:
            self.malformed_messages += 1
            self.last_protocol_error = str(exc)
            return None

    def _apply_login_reply(self, packet: AksPacket) -> None:
        reply: AksLoginReply = parse_login_reply(packet)
        if not protocol_version_is_compatible(self.settings.protocol_version, reply.minimum_protocol_version):
            self.connection_state = AksConnectionState.ERROR
            raise AksProtocolError("AKS server requires an incompatible minimum protocol version.")
        self.server_name = reply.server_name
        self.server_version = reply.server_version
        self.minimum_protocol_version = reply.minimum_protocol_version
        self.ping_rate_seconds = reply.ping_rate_seconds
        self.timeout_seconds = reply.timeout_seconds
        self.connection_state = AksConnectionState.AUTHENTICATED

    def connection_timed_out(self, now: datetime | None = None) -> bool:
        if not self.timeout_seconds or not self.last_packet_at:
            return False
        return ((now or datetime.now(timezone.utc)) - self.last_packet_at).total_seconds() > self.timeout_seconds

    async def read_loop(self, on_received_line: Callable[[bytes], None] | None = None) -> None:
        if not self._reader:
            raise ConnectionError("AKS connection is not open.")
        while True:
            line = await self.next_inbound_line()
            if line.strip() == b"":
                continue
            if on_received_line:
                on_received_line(line)
            packet = self.handle_line(line)
            if packet is None and self.last_protocol_error and self.last_protocol_error.startswith("AKS server ERROR:"):
                raise AksProtocolError(self.last_protocol_error)

    async def await_login_reply(self, on_received_line: Callable[[bytes], None] | None = None) -> None:
        if not self._reader:
            raise ConnectionError("AKS connection is not open.")
        while self.connection_state == AksConnectionState.CONNECTING:
            line = await self._read_socket_line()
            if line.strip() == b"":
                continue
            if on_received_line:
                on_received_line(line)
            packet = self.handle_line(line)
            if packet is None and self.last_protocol_error:
                raise AksProtocolError(self.last_protocol_error)
        if self.connection_state != AksConnectionState.AUTHENTICATED:
            raise AksProtocolError("AKS LOGIN did not establish an authenticated connection.")

    async def run_with_reconnect(
        self, stop: asyncio.Event, *, max_delay_seconds: float = 30.0,
        on_received_line: Callable[[bytes], None] | None = None,
        on_connection_state: Callable[[str], None] | None = None,
    ) -> None:
        delay = 1.0
        while not stop.is_set():
            try:
                await self.connect()
                if stop.is_set(): break
                if on_connection_state:
                    on_connection_state("CONNECTED")
                await self.await_login_reply(on_received_line)
                if stop.is_set(): break
                await self.restore_subscriptions()
                if on_connection_state and self.last_subscription_results and all(
                    result["status"] == "JOIN_CONFIRMED" for result in self.last_subscription_results
                ):
                    on_connection_state("SUBSCRIPTIONS_RESTORED")
                delay = 1.0
                keepalive = asyncio.create_task(self.keepalive_loop(stop))
                try:
                    await self.read_loop(on_received_line)
                finally:
                    keepalive.cancel()
                    try:
                        await keepalive
                    except asyncio.CancelledError:
                        pass
            except (ConnectionError, OSError, ssl.SSLError):
                if stop.is_set(): break
                self.connection_state = AksConnectionState.RECONNECTING
                self.reconnect_count += 1
                if on_connection_state:
                    on_connection_state("RECONNECTING")
                await self.disconnect()
                if not stop.is_set():
                    try:
                        await asyncio.wait_for(stop.wait(), timeout=delay)
                    except asyncio.TimeoutError:
                        pass
                delay = min(delay * 2, max_delay_seconds)
