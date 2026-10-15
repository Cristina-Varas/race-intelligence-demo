"""Immutable supplied-track parsing and distance-based interpolation for replay."""
from __future__ import annotations

from bisect import bisect_left
from pathlib import Path
import json
import math
import xml.etree.ElementTree as ET
from typing import Any


EARTH_RADIUS_METERS = 6_371_008.8
PROJECT_ROOT = Path(__file__).resolve().parents[4]
SOURCE_PATH = PROJECT_ROOT / "data" / "track" / "source" / "kart_path.kml"
DERIVED_PATH = PROJECT_ROOT / "data" / "track" / "derived" / "track_geometry_normalized.json"
# Existing point on the lower-right straight selected as an illustrative replay anchor.
REPLAY_START_ANCHOR_INDEX = 322
REPLAY_DIRECTION = "reverse"


def haversine_meters(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    """Geodesic distance between WGS84 longitude/latitude coordinates."""
    lon_a, lat_a, lon_b, lat_b = map(math.radians, (longitude_a, latitude_a, longitude_b, latitude_b))
    distance = math.sin((lat_b - lat_a) / 2) ** 2 + math.cos(lat_a) * math.cos(lat_b) * math.sin((lon_b - lon_a) / 2) ** 2
    return EARTH_RADIUS_METERS * 2 * math.asin(math.sqrt(distance))


def heading_degrees(longitude_a: float, latitude_a: float, longitude_b: float, latitude_b: float) -> float:
    lon_a, lat_a, lon_b, lat_b = map(math.radians, (longitude_a, latitude_a, longitude_b, latitude_b))
    y = math.sin(lon_b - lon_a) * math.cos(lat_b)
    x = math.cos(lat_a) * math.sin(lat_b) - math.sin(lat_a) * math.cos(lat_b) * math.cos(lon_b - lon_a)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def parse_kml_coordinates(source_path: Path = SOURCE_PATH) -> list[tuple[float, float]]:
    root = ET.fromstring(source_path.read_text(encoding="utf-8"))
    coordinate_text = next((node.text for node in root.iter() if node.tag.endswith("coordinates") and node.text), None)
    if not coordinate_text:
        raise ValueError(f"Track source {source_path} contains no KML coordinates.")
    points: list[tuple[float, float]] = []
    for token in coordinate_text.split():
        values = token.split(",")
        if len(values) < 2:
            raise ValueError(f"Malformed KML coordinate {token!r} in {source_path}.")
        longitude, latitude = float(values[0]), float(values[1])
        if not (-180 <= longitude <= 180 and -90 <= latitude <= 90):
            raise ValueError(f"Coordinates are not reliable longitude/latitude values in {source_path}.")
        points.append((longitude, latitude))
    if len(points) < 2:
        raise ValueError(f"Track source {source_path} must contain at least two coordinates.")
    return points


def build_normalized_geometry(source_path: Path = SOURCE_PATH) -> dict[str, Any]:
    """Create a traceable closed render loop without modifying source coordinates."""
    source_points = parse_kml_coordinates(source_path)
    closure_distance = haversine_meters(*source_points[-1], *source_points[0])
    # The supplied path is within 16 m of its origin over a ~2.5 km circuit.
    # Add only the source origin as a derived rendering closure, never a fabricated point.
    closed_loop = closure_distance <= 25
    render_points = source_points + [source_points[0]] if closed_loop else source_points
    segments = [0.0]
    for previous, current in zip(render_points, render_points[1:]):
        segments.append(haversine_meters(*previous, *current))
    cumulative: list[float] = []
    total = 0.0
    for segment in segments:
        total += segment
        cumulative.append(total)
    if total <= 0:
        raise ValueError("Track length must be positive.")
    points: list[dict[str, float | int]] = []
    for index, ((longitude, latitude), segment, distance) in enumerate(zip(render_points, segments, cumulative)):
        next_point = render_points[(index + 1) % len(render_points)]
        previous_point = render_points[index - 1] if index else render_points[0]
        heading_target = next_point if index < len(render_points) - 1 else previous_point
        heading = heading_degrees(longitude, latitude, *heading_target) if index < len(render_points) - 1 else heading_degrees(*previous_point, longitude, latitude)
        points.append({
            "index": index,
            "latitude": latitude,
            "longitude": longitude,
            "segmentDistanceMeters": segment,
            "cumulativeDistanceMeters": distance,
            "normalizedDistance": distance / total,
            "headingDegrees": heading,
        })
    return {
        "metadata": {
            "sourceFile": source_path.name,
            "sourceSha256": "b14dc1e3b84107e10254f2e8071e4b3da6b3145368d737ab09b23a6ea646af1f",
            "coordinateSystem": "WGS84",
            "coordinateOrder": "longitude_latitude",
            "sourcePointCount": len(source_points),
            "derivedPointCount": len(points),
            "trackLengthMeters": total,
            "closedLoop": closed_loop,
            "sourceClosureDistanceMeters": closure_distance,
            "startFinishSource": "geometry_origin",
            "closureHandling": "derived_origin_repeat" if closed_loop else "open_source_path",
        },
        "points": points,
    }


def write_normalized_geometry(output_path: Path = DERIVED_PATH) -> dict[str, Any]:
    geometry = build_normalized_geometry()
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(geometry, indent=2) + "\n", encoding="utf-8")
    return geometry


def load_normalized_geometry(path: Path = DERIVED_PATH) -> dict[str, Any]:
    if not path.exists():
        return write_normalized_geometry(path)
    return json.loads(path.read_text(encoding="utf-8"))


def rebase_geometry_for_replay(track: dict[str, Any], anchor_index: int = REPLAY_START_ANCHOR_INDEX, direction: str = REPLAY_DIRECTION) -> dict[str, Any]:
    """Build the derived replay loop from an anchor in the authoritative race direction.

    Source coordinates stay immutable. ``reverse`` means normalized replay
    distance advances toward the source point preceding the anchor.
    """
    points = track["points"]
    if not 0 <= anchor_index < len(points) - 1:
        raise ValueError("Replay start anchor must identify a non-closing geometry point.")
    if direction not in {"forward", "reverse"}:
        raise ValueError("Replay direction must be 'forward' or 'reverse'.")
    source_points = points[:-1]
    anchor = points[anchor_index]
    if direction == "reverse":
        ordered = source_points[anchor_index::-1] + source_points[:anchor_index:-1] + [source_points[anchor_index]]
    else:
        ordered = source_points[anchor_index:] + source_points[:anchor_index] + [source_points[anchor_index]]
    rebased_points: list[dict[str, float | int]] = []
    cumulative = 0.0
    for index, point in enumerate(ordered):
        if index == 0:
            segment = 0.0
        else:
            previous = ordered[index - 1]
            segment = haversine_meters(float(previous["longitude"]), float(previous["latitude"]), float(point["longitude"]), float(point["latitude"]))
            cumulative += segment
        rebased_points.append({
            **point,
            "index": index,
            "segmentDistanceMeters": segment,
            "cumulativeDistanceMeters": cumulative,
        })
    for index, point in enumerate(rebased_points):
        # The closing copy is the same physical point as index 0, so its next
        # direction is the first real segment of the replay loop as well.
        heading_target = rebased_points[index + 1] if index < len(rebased_points) - 1 else rebased_points[1]
        point["headingDegrees"] = heading_degrees(float(point["longitude"]), float(point["latitude"]), float(heading_target["longitude"]), float(heading_target["latitude"]))
        point["normalizedDistance"] = cumulative and float(point["cumulativeDistanceMeters"]) / cumulative
    total = cumulative
    metadata = {
        **track["metadata"],
        "replayStartAnchor": {
            "sourceGeometryIndex": anchor_index,
            "sourceNormalizedDistance": float(anchor["normalizedDistance"]),
            "latitude": float(anchor["latitude"]),
            "longitude": float(anchor["longitude"]),
            "sourceCumulativeDistanceMeters": float(anchor["cumulativeDistanceMeters"]),
            "label": "illustrative_replay_start_anchor",
        },
        "replayGeometryRebased": True,
        "replayDirection": direction,
        "trackLengthMeters": total,
    }
    return {"metadata": metadata, "points": rebased_points}


def position_at_normalized_distance(track: dict[str, Any], progress: float) -> dict[str, float]:
    """Interpolate along cumulative physical distance, wrapping 1.0 to geometry origin."""
    points = track["points"]
    total = float(track["metadata"]["trackLengthMeters"])
    wrapped = float(progress) % 1.0
    target = wrapped * total
    distances = [float(point["cumulativeDistanceMeters"]) for point in points]
    index = bisect_left(distances, target)
    if index <= 0:
        point = points[0]
        return {key: float(point[key]) for key in ("latitude", "longitude", "cumulativeDistanceMeters", "normalizedDistance", "headingDegrees")}
    current = points[min(index, len(points) - 1)]
    previous = points[index - 1]
    span = float(current["cumulativeDistanceMeters"]) - float(previous["cumulativeDistanceMeters"])
    ratio = 0.0 if span == 0 else (target - float(previous["cumulativeDistanceMeters"])) / span
    return {
        "latitude": float(previous["latitude"]) + (float(current["latitude"]) - float(previous["latitude"])) * ratio,
        "longitude": float(previous["longitude"]) + (float(current["longitude"]) - float(previous["longitude"])) * ratio,
        "cumulativeDistanceMeters": target,
        "normalizedDistance": wrapped,
        "headingDegrees": float(previous["headingDegrees"]) + (float(current["headingDegrees"]) - float(previous["headingDegrees"])) * ratio,
    }
