"""Wire parsing and formatting for CRLF-delimited AKS V2 JSON commands."""
from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any


CRLF = "\r\n"


class AksProtocolError(ValueError):
    pass


@dataclass(frozen=True)
class AksPacket:
    command: str
    message_id: str
    requires_ack: bool
    channel: str
    data: str


@dataclass(frozen=True)
class AksLoginReply:
    server_name: str
    server_version: str
    minimum_protocol_version: str
    ping_rate_seconds: float
    timeout_seconds: float


def format_packet(command: str, message_id: str | int = "", channel: str = "", data: str = "", *, requires_ack: bool = False) -> str:
    command = command.upper().strip()
    if not command or ":" in command:
        raise AksProtocolError("AKS command must be a non-empty protocol token.")
    suffix = "+" if requires_ack else ""
    return f"{command}:{message_id}{suffix}:{channel}:{data}{CRLF}"


def parse_packet(line: str | bytes) -> AksPacket:
    if isinstance(line, bytes):
        try:
            line = line.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise AksProtocolError("AKS packet is not valid UTF-8.") from exc
    if not line.endswith(CRLF):
        raise AksProtocolError("AKS packet must be CRLF terminated.")
    try:
        command, message_id, channel, data = line[:-2].split(":", 3)
    except ValueError as exc:
        raise AksProtocolError("AKS packet does not contain the required protocol fields.") from exc
    if not command:
        raise AksProtocolError("AKS packet has no command.")
    requires_ack = message_id.endswith("+")
    return AksPacket(command.upper(), message_id.rstrip("+"), requires_ack, channel, data)


def response_matches_request(packet: AksPacket, request_id: str | int, command: str, channel: str | None = None) -> bool:
    """AKS V2 replies carry the client id with a trailing ``+`` marker."""
    return (packet.command == command.upper() and packet.requires_ack
            and packet.message_id == str(request_id).rstrip("+")
            and (channel is None or packet.channel == channel))


def build_login(message_id: str | int, *, user: str, password: str, app: str, app_version: str, protocol: str, protocol_version: str) -> str:
    payload = json.dumps({
        "user": user, "password": password, "app": app, "app_ver": app_version,
        "protocol": protocol, "protocol_ver": protocol_version,
    }, separators=(",", ":"))
    return format_packet("LOGIN", message_id, "", payload)


def parse_login_reply(packet: AksPacket) -> AksLoginReply:
    if packet.command not in {"REPLY", "LOGIN"}:
        raise AksProtocolError("Expected an AKS LOGIN reply.")
    try:
        payload: dict[str, Any] = json.loads(packet.data)
        return AksLoginReply(
            server_name=str(payload["name"]),
            server_version=str(payload["ver"]),
            minimum_protocol_version=str(payload["min_ver"]),
            ping_rate_seconds=float(payload["pingRate"]),
            timeout_seconds=float(payload["timeout"]),
        )
    except (KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
        raise AksProtocolError("Malformed AKS LOGIN reply.") from exc


def parse_json_payload(packet: AksPacket) -> Any:
    if packet.command != "JSON":
        raise AksProtocolError("Expected an AKS JSON packet.")
    try:
        return json.loads(packet.data)
    except json.JSONDecodeError as exc:
        raise AksProtocolError("Malformed AKS JSON payload.") from exc


def protocol_version_is_compatible(client_version: str, minimum_version: str) -> bool:
    def version(value: str) -> tuple[int, ...]:
        parts = value.split(".")
        if not parts or any(not part.isdigit() for part in parts):
            raise AksProtocolError("AKS protocol version is not a numeric dotted version.")
        return tuple(int(part) for part in parts)
    client, minimum = version(client_version), version(minimum_version)
    length = max(len(client), len(minimum))
    return client + (0,) * (length - len(client)) >= minimum + (0,) * (length - len(minimum))
