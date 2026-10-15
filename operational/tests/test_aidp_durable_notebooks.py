"""Execute notebook domain cells locally; no Spark, OCI, AKS or ADB connection."""
import ast
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace

import pytest

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def contract(monkeypatch):
    monkeypatch.setenv("AIDP_PROJECT_ROOT", str(ROOT))
    scope = {}
    notebook = json.loads((ROOT / "notebooks_aidp/10_event_capture_foundation.ipynb").read_text())
    for cell in notebook["cells"]:
        if "aidp_shared" in cell.get("metadata", {}).get("tags", []):
            exec(compile("".join(cell["source"]), "foundation", "exec"), scope)
    return scope


def archive_fixture(tmp_path, lines):
    from app.integrations.aks.recorder import AksRawSessionRecorder
    from app.services.event_archive import LocalEventArchiveStore
    recorder = AksRawSessionRecorder("QA", tmp_path / "source")
    source = recorder.start()
    for payload in lines:
        recorder.record_line("JSON:1::" + json.dumps(payload) + "\r\n")
    recorder.stop()
    store = LocalEventArchiveStore(tmp_path / "archive")
    store.archive_segment(source)
    return tmp_path / "archive/race-intelligence/event-capture", source


def info(value):
    return {"timing": {"session": {"info": {"id": value}}}}


def status(**values):
    return {"timing": {"session": {"status": values}}}


def standings(position=2, lap=17):
    return {"timing": {"session": {"standings": {"overall": {"active": {
        "21": {"position": position, "lapNumber": lap, "gapFirstTime": 1200, "gapPreviousTime": 300},
        "SC": {"position": 1, "lapNumber": lap},
    }}}}}}


def laps(lap, time, valid=True):
    return {"timing": {"analysis": {"laps": {"21": {"participant": 21, "laps": {
        str(lap): {"lapNum": lap, "time": time, "isValid": valid}
    }}}}}}


@pytest.mark.parametrize("boundary", ["identity", "status", "grid"])
def test_real_notebook_epoch_reset_and_factual_metrics(contract, tmp_path, boundary):
    prefix = [info(1), status(isClosed=False, isFinished=False, isSessionRunning=False, elapsedLaps=0),
              standings(3, 0), status(isClosed=False, isFinished=False, isSessionRunning=True, elapsedLaps=0, sessionStartTime=1),
              standings(2, 17), laps(17, 90000), standings(2, 16)]
    if boundary == "identity":
        reset = [info(2)]
    elif boundary == "status":
        reset = [status(isClosed=True, isFinished=True), status(isClosed=False, isFinished=False), info(2)]
    else:
        reset = [status(isClosed=True, isFinished=True), standings(1, 0), status(isClosed=False, isFinished=False), info(2)]
    root, source = archive_fixture(tmp_path, prefix + reset + [standings(1, 2), laps(2, 95000)])
    segments, frames = contract["read_archive"](root)
    original = (source / "raw/alkamel-raw-000001.jsonl").read_bytes().splitlines(keepends=True)
    assert [r["raw_payload"].encode() for r in frames] == original
    assert [r["raw_sha256"] for r in frames] == [hashlib.sha256(b).hexdigest() for b in original]
    events, coverage = contract["normalize"](segments, frames)
    assert max(e["source_epoch"] for e in events) == 2
    assert next(e for e in events if e["raw_sequence"] == 7)["source_epoch"] == 1  # regression is not a reset
    gold = contract["gold_rows"](events)
    old, fresh = sorted(gold["baseball_card_evidence"], key=lambda r: r["source_epoch"])
    assert (old["best_valid_lap"], old["start_position"]) == (90.0, 2)
    assert (fresh["latest_observed_position"], fresh["peak_observed_position"], fresh["observed_lap"], fresh["best_valid_lap"]) == (1, 1, 2, 95.0)
    assert fresh["gap_to_leader"] == 1.2 and fresh["interval"] == .3
    assert fresh["start_position"] is None and fresh["final_position"] is None and fresh["position_change"] is None
    assert all(r["kart_number"] != "SC" for r in gold["participant_state"])
    contract["assert_private_free"](fresh)
    assert "timing.analysis.laps" in coverage
    assert contract["normalize"](segments, frames)[0] == events  # stable process-independent hashes


def test_invalid_lap_correction_replaces_best_and_all_channels_populate(contract, tmp_path):
    rows = [info(1), standings(), laps(17, 90000), laps(17, 90000, False),
            {"gps": {"21": {"lat": 1, "lon": 2, "name": "not-for-serving"}}},
            {"rgps": {"21": {"lat": 1.1, "lon": 2.1}}},
            {"timing": {"session": {"entry": {"21": {"name": "not-for-serving"}}, "standings": {"overall": {
                "finishLine": {"21": {"position": 4}}, "participantDetails": {"21": {"position": 2}}}}}}},
            {"timing": {"liveEvents": {"fl": {"participant": 21, "lapNumber": 17}}}},
            {"weather": {"temperature": 20}}, {"raceControl": {"flag": "GREEN"}}]
    root, _ = archive_fixture(tmp_path, rows)
    segments, raw = contract["read_archive"](root)
    events, coverage = contract["normalize"](segments, raw)
    result = contract["silver_rows"](events)
    assert all(result[k] for k in ("event_positions", "event_finish_line", "event_entries", "event_weather", "event_race_control", "event_live_events"))
    card = contract["gold_rows"](events)["baseball_card_evidence"][0]
    assert card["best_valid_lap"] is None
    assert card["latest_observed_position"] == 2  # finishLine is not active standings
    assert "not-for-serving" not in json.dumps(card)


def test_archive_hash_conflict_and_parser_error_fail_loudly(contract, tmp_path):
    root, _ = archive_fixture(tmp_path, [info(1)])
    segments, frames = contract["read_archive"](root)
    frames[0]["raw_payload"] += " "
    with pytest.raises(RuntimeError, match="hash mismatch"):
        contract["normalize"](segments, frames)
    manifest = next(root.glob("*/*/manifest.json"))
    manifest.write_text(json.dumps(json.loads(manifest.read_text()), separators=(",", ":")))
    with pytest.raises(RuntimeError, match="SHA-256"):
        contract["read_archive"](root)


def test_schema_inspection_fails_before_creating_any_table(contract):
    class Type:
        def __init__(self, name): self.name = name
        def simpleString(self): return self.name
    class Spark:
        catalog = SimpleNamespace(tableExists=lambda name: name == "existing")
        def createDataFrame(self, rows, ddl):
            return SimpleNamespace(schema=[SimpleNamespace(name="source_epoch", dataType=Type("bigint"))])
        def table(self, name):
            return SimpleNamespace(schema=[SimpleNamespace(name="session_id", dataType=Type("string"))])
        def sql(self, query): raise AssertionError("Must not create/drop/alter before schema preflight completes")
    with pytest.raises(RuntimeError, match="Incompatible schema"):
        contract["preflight"](Spark(), {"new": "source_epoch BIGINT", "existing": "source_epoch BIGINT"})


def test_notebook_hygiene_and_no_uncontrolled_legacy_publication():
    for path in sorted((ROOT / "notebooks_aidp").glob("*.ipynb")):
        if int(path.name[:2]) < 10: continue
        notebook = json.loads(path.read_text())
        for cell in notebook["cells"]:
            source = "".join(cell["source"])
            assert "/Users/" not in source and "/private/tmp" not in source
            if cell["cell_type"] == "code":
                ast.parse(source)
                assert not cell.get("outputs") and cell.get("execution_count") is None
        if 15 <= int(path.name[:2]) <= 19:
            assert any("legacy_qa_guard" in c.get("metadata", {}).get("tags", []) for c in notebook["cells"])
