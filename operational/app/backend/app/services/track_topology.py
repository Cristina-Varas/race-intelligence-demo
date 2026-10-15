"""Read-only Track Topology V2 parser and topology projection helpers.

The KML stays the authoritative input.  This module creates a derived, versioned
topology representation for rendering and future route-aware replay work; it
does not write any historical or scenario evidence.
"""
from __future__ import annotations

from bisect import bisect_left
from hashlib import sha256
import json
import math
from pathlib import Path
from typing import Any
import xml.etree.ElementTree as ET

from .track_geometry import EARTH_RADIUS_METERS, REPLAY_DIRECTION, haversine_meters


PROJECT_ROOT = Path(__file__).resolve().parents[4]
SOURCE_PATH = PROJECT_ROOT / "data" / "track_v2" / "source" / "MaxV100_New_track_with Sector.kml"
DERIVED_PATH = PROJECT_ROOT / "data" / "track_v2" / "derived" / "track_topology.json"

TRACK_ID = "max_v100_track_topology_v2"
# The source KML has no named start/finish Placemark.  Keep the previously
# approved replay anchor rather than silently claiming a new source anchor.
APPROVED_REPLAY_START = {"longitude": -1.017776444397555, "latitude": 52.07492952924461}
EXPECTED_LINE_ROUTES = {
    "Main Track": ("main", "MAIN"),
    "Joker Track 1": ("joker_1", "JOKER"),
    "Joker Track 2": ("joker_2", "JOKER"),
    "Penalty Track 1": ("penalty_1", "PENALTY"),
    "Penalty Track 2": ("penalty_2", "PENALTY"),
}
EXPECTED_SECTORS = ("S1 Start", "S2 Start", "S3 Start")


def _coordinates(text: str) -> list[tuple[float, float]]:
    points: list[tuple[float, float]] = []
    for token in text.split():
        values = token.split(",")
        if len(values) < 2:
            raise ValueError(f"Invalid KML coordinate {token!r}.")
        longitude, latitude = float(values[0]), float(values[1])
        if not -180 <= longitude <= 180 or not -90 <= latitude <= 90:
            raise ValueError(f"Invalid WGS84 coordinate {token!r}.")
        points.append((longitude, latitude))
    if not points:
        raise ValueError("KML geometry has no coordinates.")
    return points


def parse_track_kml(source_path: Path = SOURCE_PATH) -> dict[str, dict[str, Any]]:
    """Return named KML geometries without assigning unlabelled semantics."""
    root = ET.parse(source_path).getroot()
    parsed: dict[str, dict[str, Any]] = {}
    for placemark in root.iter():
        if not placemark.tag.endswith("Placemark"):
            continue
        name = next((node.text.strip() for node in placemark if node.tag.endswith("name") and node.text), None)
        if not name:
            continue
        geometry = next((node for node in placemark.iter() if node.tag.endswith(("LineString", "LinearRing", "Point"))), None)
        if geometry is None:
            continue
        coordinate_text = next((node.text for node in geometry.iter() if node.tag.endswith("coordinates") and node.text), None)
        if coordinate_text is None:
            raise ValueError(f"Placemark {name!r} has no coordinate payload.")
        parsed[name] = {"geometryType": geometry.tag.rsplit("}", 1)[-1], "coordinates": _coordinates(coordinate_text)}
    return parsed


def _length(points: list[tuple[float, float]]) -> float:
    return sum(haversine_meters(*left, *right) for left, right in zip(points, points[1:]))


def _closed(points: list[tuple[float, float]]) -> bool:
    return len(points) > 2 and haversine_meters(*points[0], *points[-1]) <= 1.0


def _project_to_segment(point: tuple[float, float], start: tuple[float, float], end: tuple[float, float]) -> tuple[float, tuple[float, float]]:
    """Project WGS84 points locally in metres; adequate for this ~2.5 km track."""
    longitude, latitude = point
    mean_latitude = math.radians((start[1] + end[1] + latitude) / 3)
    scale_x = EARTH_RADIUS_METERS * math.cos(mean_latitude) * math.pi / 180
    scale_y = EARTH_RADIUS_METERS * math.pi / 180
    vx, vy = (end[0] - start[0]) * scale_x, (end[1] - start[1]) * scale_y
    wx, wy = (longitude - start[0]) * scale_x, (latitude - start[1]) * scale_y
    denominator = vx * vx + vy * vy
    fraction = 0.0 if denominator == 0 else min(1.0, max(0.0, (wx * vx + wy * vy) / denominator))
    projected = (start[0] + fraction * (end[0] - start[0]), start[1] + fraction * (end[1] - start[1]))
    return fraction, projected


def _main_anchor(main: list[dict[str, float]], point: tuple[float, float]) -> dict[str, float]:
    best: dict[str, float] | None = None
    for index, (left, right) in enumerate(zip(main, main[1:])):
        start, end = (left["longitude"], left["latitude"]), (right["longitude"], right["latitude"])
        fraction, projected = _project_to_segment(point, start, end)
        separation = haversine_meters(*point, *projected)
        cumulative = left["cumulativeDistanceMeters"] + fraction * (right["cumulativeDistanceMeters"] - left["cumulativeDistanceMeters"])
        candidate = {
            "longitude": projected[0], "latitude": projected[1], "segmentIndex": float(index),
            "cumulativeDistanceMeters": cumulative, "normalizedProgress": cumulative / main[-1]["cumulativeDistanceMeters"],
            "separationMeters": separation,
        }
        if best is None or separation < best["separationMeters"]:
            best = candidate
    if best is None:
        raise ValueError("Main route needs at least one segment.")
    return best


def _build_main_route(points: list[tuple[float, float]]) -> tuple[dict[str, Any], dict[str, float]]:
    if not _closed(points):
        raise ValueError("The explicitly named Main Track must be a closed loop.")
    source = points[:-1]
    # The previous approved replay direction is retained.  Calibration against
    # the existing replay places this KML source order in that direction; the
    # KML itself does not explicitly assert an arrow of travel.
    provisional = [{"longitude": longitude, "latitude": latitude, "cumulativeDistanceMeters": 0.0} for longitude, latitude in source + [source[0]]]
    cumulative = 0.0
    for index in range(1, len(provisional)):
        previous, current = provisional[index - 1], provisional[index]
        cumulative += haversine_meters(previous["longitude"], previous["latitude"], current["longitude"], current["latitude"])
        current["cumulativeDistanceMeters"] = cumulative
    anchor = _main_anchor(provisional, (APPROVED_REPLAY_START["longitude"], APPROVED_REPLAY_START["latitude"]))
    start_index = int(anchor["segmentIndex"])
    rotated = source[start_index:] + source[:start_index] + [source[start_index]]
    geometry: list[dict[str, float]] = []
    total = 0.0
    for index, (longitude, latitude) in enumerate(rotated):
        if index:
            total += haversine_meters(*rotated[index - 1], longitude, latitude)
        geometry.append({"longitude": longitude, "latitude": latitude, "cumulativeDistanceMeters": total})
    for point in geometry:
        point["normalizedDistance"] = point["cumulativeDistanceMeters"] / total
    # Anchor metrics need the rotated progress, not the pre-rotation source progress.
    replay_anchor = _main_anchor(geometry, (APPROVED_REPLAY_START["longitude"], APPROVED_REPLAY_START["latitude"]))
    return {
        "routeId": "main", "routeType": "MAIN", "closedLoop": True, "lengthMeters": total,
        "geometry": geometry, "sourcePlacemark": "Main Track",
    }, replay_anchor


def _forward_distance(entry: float, exit: float, total: float) -> float:
    return exit - entry if exit >= entry else total - entry + exit


def _alternate_route(route_id: str, route_type: str, name: str, coordinates: list[tuple[float, float]], main_geometry: list[dict[str, float]]) -> dict[str, Any]:
    entry = _main_anchor(main_geometry, coordinates[0])
    exit = _main_anchor(main_geometry, coordinates[-1])
    route_length = _length(coordinates)
    main_length = float(main_geometry[-1]["cumulativeDistanceMeters"])
    replaced = _forward_distance(entry["cumulativeDistanceMeters"], exit["cumulativeDistanceMeters"], main_length)
    return {
        "routeId": route_id, "routeType": route_type, "closedLoop": False, "lengthMeters": route_length,
        "geometry": [{"longitude": longitude, "latitude": latitude} for longitude, latitude in coordinates],
        "entryAnchor": entry, "exitAnchor": exit, "replacedMainDistanceMeters": replaced,
        # Geometry metric only: it does not imply a time loss/gain or route choice.
        "routeDistanceDeltaMeters": route_length - replaced, "sourcePlacemark": name,
    }


def build_track_topology(source_path: Path = SOURCE_PATH) -> dict[str, Any]:
    parsed = parse_track_kml(source_path)
    missing = set(EXPECTED_LINE_ROUTES).union(EXPECTED_SECTORS).difference(parsed)
    if missing:
        raise ValueError(f"Topology source {source_path} is missing explicit placemarks: {sorted(missing)}")
    if any(parsed[name]["geometryType"] != "LineString" for name in EXPECTED_LINE_ROUTES):
        raise ValueError("Named route Placemarks must use LineString geometry.")
    if any(parsed[name]["geometryType"] != "Point" for name in EXPECTED_SECTORS):
        raise ValueError("Named sector boundaries must use Point geometry.")
    main, approved_anchor_projection = _build_main_route(parsed["Main Track"]["coordinates"])
    alternate_routes = [
        _alternate_route(route_id, route_type, name, parsed[name]["coordinates"], main["geometry"])
        for name, (route_id, route_type) in EXPECTED_LINE_ROUTES.items() if route_id != "main"
    ]
    sector_starts = [_main_anchor(main["geometry"], parsed[name]["coordinates"][0]) for name in EXPECTED_SECTORS]
    sectors = []
    total = float(main["lengthMeters"])
    for index, start in enumerate(sector_starts):
        end = sector_starts[(index + 1) % len(sector_starts)]
        sectors.append({
            "sectorId": f"sector_{index + 1}", "sectorNumber": index + 1, "startAnchor": start, "endAnchor": end,
            "mainRouteStartProgress": start["normalizedProgress"], "mainRouteEndProgress": end["normalizedProgress"],
            "lengthMeters": _forward_distance(start["cumulativeDistanceMeters"], end["cumulativeDistanceMeters"], total),
            "sourcePlacemark": EXPECTED_SECTORS[index],
        })
    source_bytes = source_path.read_bytes()
    return {
        "trackId": TRACK_ID,
        "metadata": {
            "sourceFile": source_path.name, "sourceSha256": sha256(source_bytes).hexdigest(),
            "coordinateSystem": "WGS84", "coordinateOrder": "longitude_latitude",
            "mainRouteLengthMeters": main["lengthMeters"], "direction": REPLAY_DIRECTION,
            "directionSource": "EXISTING_APPROVED_REPLAY_DIRECTION",
            "startAnchorSource": "EXISTING_APPROVED_REPLAY_ANCHOR",
            "sectorGeometryAvailable": True,
            "routeOrderCalibration": "KML source order aligned to the existing approved replay direction; KML has no explicit direction marker.",
        },
        "mainRoute": main,
        "alternateRoutes": alternate_routes,
        "sectors": sectors,
        "startAnchor": {**APPROVED_REPLAY_START, "source": "EXISTING_APPROVED_REPLAY_ANCHOR", "mainRouteProjection": approved_anchor_projection},
    }


def write_track_topology(output_path: Path = DERIVED_PATH, source_path: Path = SOURCE_PATH) -> dict[str, Any]:
    topology = build_track_topology(source_path)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(topology, indent=2) + "\n", encoding="utf-8")
    return topology


def load_track_topology(path: Path = DERIVED_PATH) -> dict[str, Any]:
    if not path.exists():
        return write_track_topology(path)
    return json.loads(path.read_text(encoding="utf-8"))


def position_on_main_route(topology: dict[str, Any], progress: float) -> dict[str, float]:
    """Interpolate a position on the canonical main route only."""
    geometry = topology["mainRoute"]["geometry"]
    total = float(topology["mainRoute"]["lengthMeters"])
    target = (float(progress) % 1.0) * total
    distances = [float(point["cumulativeDistanceMeters"]) for point in geometry]
    index = bisect_left(distances, target)
    if index <= 0:
        return {key: float(geometry[0][key]) for key in ("latitude", "longitude")}
    current, previous = geometry[min(index, len(geometry) - 1)], geometry[index - 1]
    span = current["cumulativeDistanceMeters"] - previous["cumulativeDistanceMeters"]
    fraction = 0.0 if span == 0 else (target - previous["cumulativeDistanceMeters"]) / span
    return {
        "longitude": float(previous["longitude"] + (current["longitude"] - previous["longitude"]) * fraction),
        "latitude": float(previous["latitude"] + (current["latitude"] - previous["latitude"]) * fraction),
    }
