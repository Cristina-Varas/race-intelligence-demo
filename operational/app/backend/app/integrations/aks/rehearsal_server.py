"""Small AKS-compatible local server for recorder rehearsals, never production timing."""
from __future__ import annotations

import argparse
import asyncio
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
import json
import ssl
from pathlib import Path
from typing import Iterable, Iterator

from .protocol import format_packet, parse_packet
from .recording import AksRecordedMessage, AksRecordingLoader


@dataclass(frozen=True)
class RehearsalLine:
    line: str
    recorded_at: datetime | None = None


class AksRehearsalServer:
    """Enough AKS protocol to exercise the real TCP client and raw recorder.

    The stream iterator is consumed once globally, so a reconnect continues at
    the next source line instead of replaying prior evidence.
    """
    def __init__(self, lines: Iterable[RehearsalLine], *, host: str = "127.0.0.1", port: int = 0,
                 speed: float = 0, respect_channels: bool = False, disconnect_after_messages: int | None = None,
                 stall_after_messages: int | None = None, stall_seconds: float = 0,
                 reject_login: bool = False, reject_join: bool = False, ssl_context: ssl.SSLContext | None = None):
        self._lines = iter(lines)
        self.host, self.port, self.speed = host, port, speed
        self.respect_channels = respect_channels
        self.disconnect_after_messages = disconnect_after_messages
        self.stall_after_messages, self.stall_seconds = stall_after_messages, stall_seconds
        self.reject_login, self.reject_join, self.ssl_context = reject_login, reject_join, ssl_context
        self.server: asyncio.AbstractServer | None = None
        self.done = asyncio.Event()
        self.delivered: list[str] = []
        self.command_counts: Counter[str] = Counter()
        self.joined_channels: set[str] = set()
        self.connections = 0
        self._disconnect_injected = False
        self._stall_injected = False
        self._stream_lock = asyncio.Lock()

    @property
    def bound_port(self) -> int:
        assert self.server and self.server.sockets
        return int(self.server.sockets[0].getsockname()[1])

    async def start(self) -> "AksRehearsalServer":
        self.server = await asyncio.start_server(self._handle, self.host, self.port, ssl=self.ssl_context)
        return self

    async def stop(self) -> None:
        if self.server:
            self.server.close()
            await self.server.wait_closed()

    async def _handle(self, reader: asyncio.StreamReader, writer: asyncio.StreamWriter) -> None:
        self.connections += 1
        joined = False
        stream_task: asyncio.Task[None] | None = None
        try:
            while not reader.at_eof():
                wire = await reader.readline()
                if not wire:
                    break
                try:
                    packet = parse_packet(wire)
                except Exception:
                    continue
                self.command_counts[packet.command] += 1
                if packet.command == "LOGIN":
                    if self.reject_login:
                        writer.write(format_packet("ERROR", packet.message_id, data="LOGIN_REJECTED").encode())
                        await writer.drain()
                        return
                    reply = {"name": "AKS rehearsal", "ver": "2.0", "min_ver": "1.0.0", "pingRate": 60, "timeout": 120}
                    writer.write(format_packet("REPLY", packet.message_id, data=json.dumps(reply, separators=(",", ":"))).encode())
                    await writer.drain()
                elif packet.command == "JOIN":
                    if self.reject_join:
                        writer.write(format_packet("ERROR", packet.message_id, packet.channel, "JOIN_REJECTED").encode())
                        await writer.drain()
                        continue
                    writer.write(format_packet("JOIN", packet.message_id, packet.channel, requires_ack=True).encode())
                    await writer.drain()
                    self.joined_channels.add(packet.channel)
                    if not joined:
                        joined = True
                        stream_task = asyncio.create_task(self._stream(writer))
                elif packet.command == "PING":
                    writer.write(format_packet("ACK", packet.message_id, requires_ack=True).encode())
                    await writer.drain()
                elif packet.command == "LEAVE":
                    writer.write(format_packet("LEAVE", packet.message_id, packet.channel, requires_ack=True).encode())
                    await writer.drain()
                if stream_task and stream_task.done():
                    break
        finally:
            if stream_task and not stream_task.done():
                stream_task.cancel()
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass

    async def _stream(self, writer: asyncio.StreamWriter) -> None:
        previous: datetime | None = None
        async with self._stream_lock:
            for item in self._lines:
                if self.respect_channels:
                    try:
                        if parse_packet(item.line).channel and parse_packet(item.line).channel not in self.joined_channels:
                            continue
                    except Exception:
                        pass
                if previous and item.recorded_at and self.speed > 0:
                    await asyncio.sleep(max(0.0, (item.recorded_at - previous).total_seconds()) / self.speed)
                previous = item.recorded_at or previous
                if self.stall_after_messages and not self._stall_injected and len(self.delivered) >= self.stall_after_messages:
                    self._stall_injected = True
                    await asyncio.sleep(self.stall_seconds)
                writer.write(item.line.encode("utf-8"))
                await writer.drain()
                self.delivered.append(item.line)
                if self.disconnect_after_messages and not self._disconnect_injected and len(self.delivered) >= self.disconnect_after_messages:
                    self._disconnect_injected = True
                    writer.close()
                    return
            self.done.set()
            # No source remains. Stop accepting reconnects so an operator sees
            # a completed rehearsal rather than a misleading reconnect loop.
            if self.server:
                self.server.close()
            writer.close()


def recording_lines(path: str | Path, *, start_offset_seconds: float = 0, duration_seconds: float | None = None) -> Iterator[RehearsalLine]:
    """Stream a selected temporal slice without materializing a recording."""
    first: datetime | None = None
    for message in AksRecordingLoader(path).iter_messages():
        if message.recorded_at:
            first = first or message.recorded_at
            elapsed = (message.recorded_at - first).total_seconds()
            if elapsed < start_offset_seconds:
                continue
            if duration_seconds is not None and elapsed > start_offset_seconds + duration_seconds:
                break
        yield RehearsalLine(message.wire_line, message.recorded_at)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Local AKS rehearsal stream server")
    parser.add_argument("--recording", required=True, help="explicit local recording directory or ZIP")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=11001)
    parser.add_argument("--speed", type=float, default=0, help="0 streams as fast as possible")
    parser.add_argument("--as-fast-as-possible", action="store_true")
    parser.add_argument("--start-offset-seconds", type=float, default=0)
    parser.add_argument("--duration-seconds", type=float)
    parser.add_argument("--disconnect-after-messages", type=int)
    parser.add_argument("--stall-after-messages", type=int)
    parser.add_argument("--stall-seconds", type=float, default=0)
    args = parser.parse_args(argv)

    async def run() -> None:
        speed = 0 if args.as_fast_as_possible else args.speed
        server = await AksRehearsalServer(recording_lines(args.recording, start_offset_seconds=args.start_offset_seconds, duration_seconds=args.duration_seconds), host=args.host, port=args.port, speed=speed, disconnect_after_messages=args.disconnect_after_messages, stall_after_messages=args.stall_after_messages, stall_seconds=args.stall_seconds).start()
        print(f"AKS rehearsal server listening on {args.host}:{server.bound_port}", flush=True)
        try:
            await server.done.wait()
        finally:
            await server.stop()
    asyncio.run(run())
    return 0


if __name__ == "__main__":  # pragma: no cover
    raise SystemExit(main())
