"""Low-level AKS GPS/RGPS presentation helpers; no Event Capture mapping."""
from __future__ import annotations

from typing import Any


GPS_STATUS_FLAGS = {
    0x001: "OfficialCar", 0x002: "Leader", 0x004: "Lapped", 0x008: "ClassLeader",
    0x010: "Stopped", 0x020: "ClassLapped", 0x040: "InPit", 0x080: "OutLap",
    0x100: "PositionUnknown", 0x200: "Retired", 0x400: "Late", 0x800: "EntryListTarget",
    0x1000: "NoGpsPosition", 0x2000: "Chequered", 0x4000: "Hidden",
}


def decode_coordinates(raw_lat: int | float | None, raw_lon: int | float | None) -> dict[str, float | None]:
    return {
        "latitude": float(raw_lat) / 1_000_000 if raw_lat is not None else None,
        "longitude": float(raw_lon) / 1_000_000 if raw_lon is not None else None,
    }


def decode_status(raw_status: int | None) -> dict[str, Any]:
    status = int(raw_status or 0)
    known_mask = 0
    flags = []
    for bit, name in GPS_STATUS_FLAGS.items():
        known_mask |= bit
        if status & bit:
            flags.append(name)
    return {"raw_status": status, "flags": flags, "unknown_bits": status & ~known_mask}
