"""Small, explicit helpers for the Spark-first AIDP operational pipeline.

This module deliberately has no PySpark import at module load time, so local
unit tests remain independent of an AIDP runtime.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any

RAW_SESSIONS = ("QP1", "R1", "R2", "TestKartTrack")
LANDING_COUNTS = {
    "analysis_laps": 781, "classification": 189, "weather": 53,
    "leader_sequence": 27, "lap_positions": 381, "best_sectors": 55,
    "lap_gaps": 362,
}
STRUCTURAL_KEYS = {
    "analysis_laps": ("session", "lap_number", "driver_id"),
    "classification": ("session", "driver_id"),
    "weather": ("session", "timestamp"),
    "leader_sequence": ("session", "lap_number"),
    "lap_positions": ("session", "lap_number", "driver_id"),
    "best_sectors": ("session", "driver_id"),
    "lap_gaps": ("session", "lap_number", "driver_id"),
}


def load_aidp_config(settings_path: Path) -> dict[str, Any]:
    """Read the deliberately simple ``aidp`` section without extra packages."""
    text = Path(settings_path).read_text(encoding="utf-8")
    section = re.search(r"^aidp:\n((?:^[ ]{2}[^\n]+\n?)+)", text, re.MULTILINE)
    if not section:
        raise KeyError("Missing aidp section in config/settings.yaml")
    values: dict[str, Any] = {}
    for key, raw in re.findall(r"^  ([a-z_]+):\s*\"?([^\"#\n]+)", section.group(1), re.MULTILINE):
        value = raw.strip()
        values[key] = int(value) if re.fullmatch(r"-?\d+", value) else value
    required = {"bronze_raw_volume", "bronze_landing_volume", "catalog", "silver_schema", "gold_historical_schema", "gold_scenario_schema", "weather_offset_hours"}
    missing = sorted(required - values.keys())
    if missing:
        raise KeyError(f"Missing aidp configuration values: {', '.join(missing)}")
    return values


def table_name(config: dict[str, Any], schema_key: str, table: str) -> str:
    return f"{config['catalog']}.{config[schema_key]}.{table}"


def normalize_aidp_catalog_types(df):
    """Replace only Spark TimestampNTZType fields with TimestampType fields."""
    from pyspark.sql import functions as F
    from pyspark.sql.types import TimestampNTZType, TimestampType

    normalized = df
    for field in df.schema.fields:
        if isinstance(field.dataType, TimestampNTZType):
            normalized = normalized.withColumn(field.name, F.col(field.name).cast(TimestampType()))
    return normalized


def resolve_table_location(spark, target: str) -> str | None:
    """Best-effort existing Delta location for actionable recreation errors."""
    try:
        row = spark.sql(f"DESCRIBE DETAIL {target}").select("location").first()
        return str(row.location) if row and row.location else None
    except Exception:
        return None


def landing_paths(config: dict[str, Any]) -> dict[str, str]:
    root = str(config["bronze_landing_volume"]).rstrip("/")
    return {name: f"{root}/{name}.parquet" for name in LANDING_COUNTS}


def missing_landing_paths(config: dict[str, Any], exists) -> list[str]:
    """Return expected landing paths missing from the supplied existence check."""
    return [path for path in landing_paths(config).values() if not exists(path)]


def landing_prerequisite_message(config: dict[str, Any], missing: list[str]) -> str:
    expected = "\n".join(f"- {name}: {count} rows ({landing_paths(config)[name]})" for name, count in LANDING_COUNTS.items())
    return (
        "Validated structured Bronze landing artifacts are required before AIDP processing. "
        "Upload/promote the locally validated extraction Parquet files; PDF parsing is intentionally not run in AIDP.\n"
        f"Missing paths:\n" + "\n".join(f"- {path}" for path in missing) + f"\nExpected artifacts:\n{expected}"
    )


def validate_landing_with_spark(spark, config: dict[str, Any]) -> list[dict[str, Any]]:
    """Read landing Parquet with Spark and return concise validation records."""
    rows: list[dict[str, Any]] = []
    for name, expected in LANDING_COUNTS.items():
        path = landing_paths(config)[name]
        frame = spark.read.parquet(path)
        keys = STRUCTURAL_KEYS[name]
        missing_columns = [key for key in keys if key not in frame.columns]
        count = frame.count()
        nulls = sum(frame.filter(" OR ".join(f"`{key}` IS NULL" for key in keys)).count() for _ in [0]) if not missing_columns else None
        duplicates = frame.groupBy(*keys).count().filter("count > 1").count() if not missing_columns else None
        rows.append({"dataset": name, "path": path, "expected_rows": expected, "actual_rows": count,
                     "row_count_passed": count == expected, "missing_key_columns": ", ".join(missing_columns),
                     "structural_key_null_rows": nulls, "duplicate_key_groups": duplicates})
    return rows
