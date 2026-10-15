"""Reproducible loaders and normalisers for supplied timing files."""
from __future__ import annotations

import csv
import re
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd
from pandas.api.types import is_extension_array_dtype

SENTINELS = {-999, -999.0, "-999", "-999.0", "", "-", "N/A"}
FAMILIES = ("Classification", "AnalysisByLap", "Analysis", "Weather", "LapChart", "BestSectors", "LeaderSequence", "FastestLapSequence")
REQUIRED_SESSIONS = ("QP1", "R1", "R2", "TestKartTrack")
STRUCTURAL_INTEGER_COLUMNS = {
    "driver_id", "lap_number", "leader_driver_id", "position", "lap_position",
    "source_page", "pdf_lap_label", "target_lap_number", "final_position",
    "completed_laps", "reference_driver_id",
}


def resolve_raw_data_path(project_root: Path, aidp_raw_path: Path | None = None) -> Path:
    """Prefer the mounted AIDP Bronze root, then validate the local fallback."""
    project_root = Path(project_root)
    settings = (project_root / "config/settings.yaml").read_text()
    def configured(name: str) -> str:
        match = re.search(rf"^  {name}:\s*[\"']?([^\"'#\n]+)", settings, re.MULTILINE)
        if not match: raise KeyError(f"Missing paths.{name} in config/settings.yaml")
        return match.group(1).strip()
    mounted = Path(aidp_raw_path) if aidp_raw_path is not None else Path(configured("aidp_raw_data"))
    raw_root = mounted if mounted.exists() else project_root / configured("local_raw_data")
    missing = [session for session in REQUIRED_SESSIONS if not (raw_root / session).is_dir()]
    if missing: raise FileNotFoundError(f"Resolved raw data path '{raw_root}' is missing required sessions: {', '.join(missing)}")
    return raw_root

def dataframe_storage_diagnostics(frame: pd.DataFrame) -> pd.DataFrame:
    """Describe pandas storage types before an artifact is written.

    The array type is useful when comparing a local pandas runtime with AIDP's
    pandas/pyarrow combination; it does not alter the supplied dataframe.
    """
    rows: list[dict[str, Any]] = []
    for name in frame.columns:
        series = frame[name]
        array = series.array
        array_class = f"{array.__class__.__module__}.{array.__class__.__name__}"
        dtype = repr(series.dtype)
        rows.append(
            {
                "column": name,
                "dtype": dtype,
                "array_class": array_class,
                "arrow_backed": "arrow" in array_class.lower() or "pyarrow" in dtype.lower(),
                "null_count": int(series.isna().sum()),
            }
        )
    return pd.DataFrame(rows, columns=["column", "dtype", "array_class", "arrow_backed", "null_count"])


def _is_aidp(aidp: bool | None) -> bool:
    if aidp is not None:
        return aidp
    from aidp_environment import is_aidp_environment
    return is_aidp_environment()


def _native_storage_value(value: Any) -> Any:
    """Convert one pandas/NumPy scalar to an Arrow-friendly Python value."""
    if value is None or value is pd.NA or value is pd.NaT:
        return None
    if isinstance(value, np.generic):
        value = value.item()
    if isinstance(value, pd.Timestamp):
        return None if pd.isna(value) else value.to_pydatetime()
    if isinstance(value, pd.Timedelta):
        return None if pd.isna(value) else value.to_pytimedelta()
    if isinstance(value, float) and np.isnan(value):
        return None
    return value


def prepare_dataframe_for_storage(frame: pd.DataFrame, *, aidp: bool | None = None) -> pd.DataFrame:
    """Return a persistence-only copy when pandas extension storage is unsafe.

    AIDP's pandas/PyArrow bridge can reject nullable extension arrays (for
    example ``Int64`` masks).  In AIDP, every extension column is represented
    by native Python values and ``None`` nulls on a copy.  Locally, only string
    extensions are normalised for the known Arrow-string compatibility issue.
    """
    active = _is_aidp(aidp)
    columns = [
        name for name in frame.columns
        if is_extension_array_dtype(frame[name].dtype) and (active or isinstance(frame[name].dtype, pd.StringDtype))
    ]
    if not columns:
        return frame

    prepared = frame.copy()
    for name in columns:
        prepared[name] = pd.Series(
            [_native_storage_value(value) for value in prepared[name].tolist()],
            index=prepared.index,
            dtype=object,
        )
    return prepared

def write_parquet_portable(frame: pd.DataFrame, path: Path, *, aidp: bool | None = None, **kwargs) -> None:
    """Persist a dataframe without invoking AIDP's ExtensionArray conversion.

    The AIDP branch deliberately creates a PyArrow table from a plain Python
    dictionary.  Local runs retain the normal pandas writer unless a string
    extension needs its established compatibility normalisation.
    """
    active = _is_aidp(aidp)
    prepared = prepare_dataframe_for_storage(frame, aidp=active)
    if not active:
        prepared.to_parquet(path, **kwargs)
        return
    import pyarrow as pa
    import pyarrow.parquet as pq
    index = kwargs.pop("index", None)
    if index not in (None, False):
        raise ValueError("AIDP portable parquet writer supports index=False only")
    if kwargs:
        raise ValueError(f"Unsupported AIDP parquet options: {', '.join(kwargs)}")
    storage_dict = {
        name: [_native_storage_value(value) for value in prepared[name].tolist()]
        for name in prepared.columns
    }
    pq.write_table(pa.Table.from_pydict(storage_dict), path)

def write_csv_portable(frame: pd.DataFrame, path: Path, *, aidp: bool | None = None, **kwargs) -> None:
    """Persist a CSV using the same narrow, non-mutating normalisation."""
    prepare_dataframe_for_storage(frame, aidp=aidp).to_csv(path, **kwargs)


def _normalize_aidp_parquet_structure(frame: pd.DataFrame) -> pd.DataFrame:
    """Restore safe key dtypes after native-Python AIDP Parquet reconstruction."""
    if "session" in frame:
        frame["session"] = frame["session"].astype(pd.StringDtype(storage="python"))
    for name in STRUCTURAL_INTEGER_COLUMNS.intersection(frame.columns):
        series = frame[name]
        if series.notna().all() and pd.api.types.is_integer_dtype(series.dtype):
            frame[name] = series.astype("int64")
    return frame


def read_parquet_portable(path: Path, *, aidp: bool | None = None, **kwargs) -> pd.DataFrame:
    """Read project Parquet artifacts without AIDP's pandas dtype bridge.

    AIDP reads with PyArrow, then reconstructs a dataframe from native Python
    records.  This avoids malformed extension dtypes produced by
    ``pandas.read_parquet`` in the platform runtime.
    """
    active = _is_aidp(aidp)
    if not active:
        return pd.read_parquet(path, **kwargs)
    columns = kwargs.pop("columns", None)
    if kwargs:
        raise ValueError(f"Unsupported AIDP parquet read options: {', '.join(kwargs)}")
    import pyarrow.parquet as pq
    table = pq.read_table(path, columns=columns)
    frame = pd.DataFrame(table.to_pylist(), columns=table.column_names)
    return _normalize_aidp_parquet_structure(frame)


def source_family(filename: str) -> str:
    compact = re.sub(r"[^a-z]", "", filename.lower())
    for family in FAMILIES:
        if re.sub(r"[^a-z]", "", family.lower()) in compact:
            return family
    return "Other"


def inventory_raw_files(raw_dir: Path) -> pd.DataFrame:
    rows: list[dict[str, Any]] = []
    for path in sorted(raw_dir.rglob("*")):
        if not path.is_file() or path.name == ".DS_Store":
            continue
        ext = path.suffix.lower().lstrip(".")
        rows.append({"session": path.parent.name, "filename": path.name, "extension": ext,
                     "relative_path": path.relative_to(raw_dir).as_posix(), "file_size_bytes": path.stat().st_size,
                     "source_family": source_family(path.name), "source_format": ext.upper()})
    return pd.DataFrame(rows)


def detect_delimiter(path: Path) -> str:
    sample = path.read_text(encoding="utf-8-sig", errors="replace")[:8192]
    try:
        return csv.Sniffer().sniff(sample, delimiters=";,\t|").delimiter
    except csv.Error:
        return ";"


def standardize_column_name(value: str) -> str:
    return re.sub(r"_+", "_", re.sub(r"[^a-z0-9]+", "_", value.strip().lower())).strip("_")


def load_csv_safe(path: Path) -> tuple[pd.DataFrame, str]:
    delimiter = detect_delimiter(path)
    frame = pd.read_csv(path, sep=delimiter, dtype="string", encoding="utf-8-sig", keep_default_na=False)
    frame.columns = [standardize_column_name(column) for column in frame.columns]
    return frame.replace(list(SENTINELS), pd.NA), delimiter


def parse_numeric(value: Any) -> float:
    if value is None or pd.isna(value):
        return np.nan
    text = str(value).strip().replace("+", "")
    if text in SENTINELS or "lap" in text.lower():
        return np.nan
    text = text.replace(".", "").replace(",", ".") if "," in text and "." in text and text.rfind(",") > text.rfind(".") else text.replace(",", ".")
    try:
        return float(text)
    except ValueError:
        return np.nan


def parse_timing_seconds(value: Any) -> float:
    if value is None or pd.isna(value):
        return np.nan
    text = str(value).strip().lstrip("+")
    if text in SENTINELS or "lap" in text.lower():
        return np.nan
    parts = text.split(":")
    try:
        numbers = [float(part.replace(",", ".")) for part in parts]
    except ValueError:
        return np.nan
    if len(numbers) == 1:
        return numbers[0]
    if len(numbers) == 2:
        return numbers[0] * 60 + numbers[1]
    if len(numbers) == 3:
        return numbers[0] * 3600 + numbers[1] * 60 + numbers[2]
    return np.nan


def _number(frame: pd.DataFrame, column: str) -> pd.Series:
    return frame[column].map(parse_numeric) if column in frame else pd.Series(np.nan, index=frame.index)


def _time(frame: pd.DataFrame, column: str) -> pd.Series:
    return frame[column].map(parse_timing_seconds) if column in frame else pd.Series(np.nan, index=frame.index)


def standardize_analysis(frame: pd.DataFrame, session: str) -> pd.DataFrame:
    out = pd.DataFrame({"session": session, "driver_id": _number(frame, "number").astype("Int64"),
                        "lap_number": _number(frame, "lap_number").astype("Int64"),
                        "lap_time_seconds": _time(frame, "lap_time"), "sector1_seconds": _time(frame, "s1"),
                        "sector2_seconds": _time(frame, "s2"), "sector3_seconds": _time(frame, "s3"),
                        "hour": frame.get("hour", pd.Series(pd.NA, index=frame.index)),
                        "pit_marker": frame.get("crossing_finish_line_in_pit", pd.Series(pd.NA, index=frame.index))})
    out["is_pit_lap"] = out["pit_marker"].fillna("").str.strip().ne("")
    return out


def standardize_classification(frame: pd.DataFrame, session: str) -> pd.DataFrame:
    position_col = "position" if "position" in frame else "pos"
    best_col = "fl_time" if "fl_time" in frame else "time"
    return pd.DataFrame({"session": session, "driver_id": _number(frame, "number").astype("Int64"),
                         "position": _number(frame, position_col).astype("Int64"), "laps": _number(frame, "laps").astype("Int64"),
                         "best_lap_seconds": _time(frame, best_col), "gap_first_seconds": _time(frame, "gap_first"),
                         "schema_type": "race" if "position" in frame else "timed_session"})


def standardize_weather(frame: pd.DataFrame, session: str) -> pd.DataFrame:
    out = pd.DataFrame({"session": session, "timestamp": pd.to_datetime(frame.get("time_utc_str"), dayfirst=True, errors="coerce"),
                        "air_temp": _number(frame, "air_temp"), "track_temp": _number(frame, "track_temp"),
                        "humidity": _number(frame, "humidity"), "pressure": _number(frame, "pressure"),
                        "rain": _number(frame, "rain"), "wind_speed": _number(frame, "wind_speed"),
                        "wind_direction": _number(frame, "wind_direction")})
    return out
