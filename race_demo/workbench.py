"""Explicit, append-free publication to operator-provisioned AIDP demo tables.

No catalog/schema creation, overwrite, SQL interpolation of data or credentials.
The runtime supplies Spark and authorizes storage access outside the repository.
"""
import os
import re

from .pipeline import canonical, digest


def table_name(layer):
    schema = os.environ.get("AIDP_DEMO_SCHEMA", "")
    parts = schema.split(".")
    if len(parts) not in (1, 2) or any(not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", p) for p in parts):
        raise ValueError("Set AIDP_DEMO_SCHEMA to a pre-provisioned demo schema, optionally catalog.schema.")
    if not parts[-1].endswith("_demo"):
        raise ValueError("The schema must end in _demo; do not use a production schema.")
    if layer not in {"bronze", "silver", "gold_profiles", "gold_deviations", "gold_scenarios", "gold_curve"}:
        raise ValueError("Unsupported demo layer.")
    return f"{schema}.race_intelligence_{layer}_v1"


def publish_table(spark, layer, rows):
    """Identical reruns are read-only; conflicting data require a new demo schema."""
    if not rows:
        raise ValueError("Cannot publish empty demo data.")
    name = table_name(layer)
    normalized = sorted((dict(row) for row in rows), key=canonical)
    expected_hash = digest(normalized)
    if not spark.catalog.tableExists(name):
        spark.createDataFrame(normalized).write.format("delta").mode("errorifexists").saveAsTable(name)
    observed = sorted((row.asDict(recursive=True) for row in spark.table(name).collect()), key=canonical)
    if digest(observed) != expected_hash:
        raise ValueError(f"Conflict or read-back mismatch in demo layer {layer}; nothing overwritten.")
    return {"layer": layer, "rows": len(rows), "sha256": expected_hash, "read_back": "PASS"}
