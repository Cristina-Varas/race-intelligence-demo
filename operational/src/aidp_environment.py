"""Notebook-scoped dependency support for Oracle AIDP Workbench."""
from __future__ import annotations
from importlib.util import find_spec
from pathlib import Path
from datetime import date, datetime, timedelta
import math

PACKAGE_IMPORTS = {"pandas":"pandas", "numpy":"numpy", "pyarrow":"pyarrow", "matplotlib":"matplotlib", "pdfplumber":"pdfplumber", "pyyaml":"yaml", "scikit-learn":"sklearn", "pytest":"pytest"}

def is_aidp_environment(workspace: Path = Path('/Workspace'), bronze: Path = Path('/Volumes/race_intelligence/bronze/raw_timing')) -> bool:
    return workspace.exists() or bronze.exists()

def missing_distributions(distributions: list[str]) -> list[str]:
    unknown=[d for d in distributions if d not in PACKAGE_IMPORTS]
    if unknown: raise ValueError(f"Unsupported runtime distributions: {', '.join(unknown)}")
    return [d for d in distributions if find_spec(PACKAGE_IMPORTS[d]) is None]

def ensure_notebook_dependencies(distributions: list[str], *, aidp: bool | None = None, magic=None) -> list[str]:
    """Install missing AIDP notebook-scoped packages sequentially via %pip."""
    missing=missing_distributions(distributions)
    active=is_aidp_environment() if aidp is None else aidp
    if missing and not active: raise ModuleNotFoundError(f"Missing local dependencies: {', '.join(missing)}. Install requirements.txt in the local environment.")
    if missing:
        if magic is None:
            from IPython import get_ipython
            magic=get_ipython()
        if magic is None: raise RuntimeError("AIDP dependency installation requires an active IPython notebook runtime.")
        for distribution in missing: magic.run_line_magic('pip', f'install {distribution}')
        unresolved=missing_distributions(missing)
        if unresolved: raise ModuleNotFoundError(f"AIDP installation did not make imports available: {', '.join(unresolved)}")
    return missing

def _json_safe(value):
    """Presentation-only conversion; source pandas objects are never mutated."""
    import numpy as np
    import pandas as pd
    if value is pd.NA or value is None: return None
    if isinstance(value, np.generic): value=value.item()
    if isinstance(value, float) and math.isnan(value): return None
    if isinstance(value, (pd.Timestamp, datetime, date)): return value.isoformat()
    if isinstance(value, (pd.Timedelta, timedelta)): return str(value)
    return value

def safe_display(obj, max_rows: int | None = None, *, aidp: bool | None = None, display_fn=None, text_fn=print):
    """Render pandas objects safely in AIDP without changing analytical dtypes."""
    import pandas as pd
    active=is_aidp_environment() if aidp is None else aidp
    if display_fn is None:
        from IPython.display import display as display_fn
    if not active or not isinstance(obj, (pd.DataFrame, pd.Series)):
        return display_fn(obj)
    frame=obj.to_frame() if isinstance(obj, pd.Series) else obj
    if max_rows is not None: frame=frame.head(max_rows)
    normalized=frame.astype(object).map(_json_safe)
    try: return display_fn(normalized)
    except Exception: return text_fn(normalized.to_string(max_rows=max_rows))

def configure_pandas_for_aidp(*, aidp: bool | None = None) -> str:
    """Disable Arrow-backed pandas string storage only in AIDP runtimes."""
    import pandas as pd
    active = is_aidp_environment() if aidp is None else aidp
    if active:
        pd.options.mode.string_storage = 'python'
    return pd.options.mode.string_storage


def optional_matplotlib(*, backend: str | None = None, message_fn=print):
    """Return pyplot when available, otherwise leave analytical work runnable."""
    try:
        import matplotlib
        if backend is not None:
            matplotlib.use(backend, force=True)
        import matplotlib.pyplot as plt
    except ImportError:
        message_fn("Visualization skipped: matplotlib is unavailable in this environment.")
        return None
    return plt
