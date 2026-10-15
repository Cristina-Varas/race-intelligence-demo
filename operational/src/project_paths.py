"""Portable project-root discovery for local and AIDP notebook sessions."""
from __future__ import annotations
from pathlib import Path
import os

MARKERS = ("src", "config/settings.yaml", "requirements.txt")
AIDP_PROJECT_ROOT = Path(os.getenv("AIDP_PROJECT_ROOT", "/Workspace/race-intelligence-demo/operational"))

def _valid(path: Path) -> bool:
    return all((path / marker).exists() for marker in MARKERS)

def find_project_root(start: Path | None = None, aidp_root: Path = AIDP_PROJECT_ROOT) -> Path:
    checked=[aidp_root]
    if _valid(aidp_root): return aidp_root
    cwd=Path.cwd() if start is None else Path(start)
    for candidate in (cwd, *cwd.parents):
        checked.append(candidate)
        if _valid(candidate): return candidate
    raise RuntimeError(f"Could not find project root from cwd '{cwd}'. Checked: {', '.join(map(str, checked))}. Expected markers: {', '.join(MARKERS)}")

def add_src_to_path(root: Path, sys_path=None) -> Path:
    import sys
    target=str(Path(root)/'src'); paths=sys.path if sys_path is None else sys_path
    if target not in paths: paths.insert(0,target)
    return Path(target)

# Notebook-facing name used by the AIDP bootstrap template.
ensure_src_on_path = add_src_to_path
