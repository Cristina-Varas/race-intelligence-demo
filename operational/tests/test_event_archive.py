import json
from pathlib import Path
import sys

import pytest

BACKEND_ROOT = Path(__file__).parents[1] / "app" / "backend"
sys.path.insert(0, str(BACKEND_ROOT))

from app.integrations.aks.recorder import AksRawSessionRecorder
from app.integrations.aks.recording import AksRecordingLoader
from app.services.event_archive import EventArchiveConflict, EventArchiveError, LocalEventArchiveStore, OCIObjectStorageEventArchiveStore, materialize_archive_uri, validate_completed_segment


class _NotFound(Exception):
    status = 404


class _Response:
    def __init__(self, body): self.data = body


class _Objects:
    def __init__(self, names): self.objects = [type("Object", (), {"name": name})() for name in names]


class FakeOCI:
    def __init__(self): self.objects = {}
    def get_object(self, namespace, bucket, name):
        if name not in self.objects: raise _NotFound()
        return _Response(self.objects[name])
    def put_object(self, namespace, bucket, name, body, *, if_none_match):
        assert if_none_match == "*"
        if name in self.objects:
            error = Exception("PreconditionFailed")
            error.status = 412
            raise error
        self.objects[name] = bytes(body)
    def list_objects(self, namespace, bucket, prefix): return _Response(_Objects([name for name in self.objects if name.startswith(prefix)]))


def _segment(tmp_path, session="ARCHIVE_QA"):
    recorder=AksRawSessionRecorder(session, tmp_path, rotate_messages=1)
    path=recorder.start()
    recorder.record_line("ACK:1::\r\n")
    recorder.record_line('JSON:2::{"timing":{"session":{"info":{"sessionDbId":4040}}}}\r\n')
    recorder.stop()
    return path


def test_archives_finished_segment_idempotently_and_materializes_loader_compatible_evidence(tmp_path):
    source=_segment(tmp_path); store=LocalEventArchiveStore(tmp_path / "archive")
    first=store.archive_segment(source); second=store.archive_segment(source)
    assert first.status == "ARCHIVED" and second.status == "ALREADY_ARCHIVED"
    assert first.manifest["source"] == "AKS" and first.manifest["rawFileCount"] == 2
    assert first.manifest["messageCount"] == 2 and first.manifest["jsonMessageCount"] == 1
    assert "Participant Name" not in json.dumps(first.manifest) and "Photo Asset" not in json.dumps(first.manifest)
    restored=store.materialize_segment("ARCHIVE_QA", source.name, tmp_path / "cache")
    assert [item.command for item in AksRecordingLoader(restored).iter_messages()] == ["ACK", "JSON"]
    via_uri=materialize_archive_uri(f"archive://ARCHIVE_QA/{source.name}", archive_root=tmp_path / "archive", cache_dir=tmp_path / "uri-cache")
    assert [item.command for item in AksRecordingLoader(via_uri).iter_messages()] == ["ACK", "JSON"]
    assert [item.segment_id for item in store.list_segments()] == [source.name]


@pytest.mark.parametrize("identical", [True, False])
def test_atomic_object_creation_race(identical):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    class RacingOCI(FakeOCI):
        def __init__(self):
            super().__init__()
            self.barrier, self.lock = Barrier(2), Lock()
        def put_object(self, *args, **kwargs):
            self.barrier.wait(timeout=5)
            with self.lock:
                return super().put_object(*args, **kwargs)
    client = RacingOCI()
    store = OCIObjectStorageEventArchiveStore(namespace="qa", bucket="qa", client=client)
    bodies = [b"original", b"original" if identical else b"conflict"]
    def write(body):
        try:
            return store._put_immutable("evidence", body)
        except EventArchiveConflict:
            return "CONFLICT"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(write, bodies))
    assert results.count(True) == 1
    assert results.count(False if identical else "CONFLICT") == 1
    winner = results.index(True)
    assert client.objects["evidence"] == bodies[winner]


def test_concurrent_identical_segments_accept_winning_archive_timestamp(tmp_path):
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    class RacingOCI(FakeOCI):
        def __init__(self):
            super().__init__()
            self.barrier, self.lock = Barrier(2), Lock()
        def put_object(self, *args, **kwargs):
            if args[2].endswith("archive-manifest.json"):
                self.barrier.wait(timeout=5)
            with self.lock:
                return super().put_object(*args, **kwargs)
    source = _segment(tmp_path)
    client = RacingOCI()
    store = OCIObjectStorageEventArchiveStore(namespace="qa", bucket="qa", client=client)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: store.archive_segment(source), range(2)))
    assert sorted(r.status for r in results) == ["ALREADY_ARCHIVED", "ARCHIVED"]
    assert results[0].manifest == results[1].manifest


def test_concurrent_conflicting_segments_preserve_winner(tmp_path):
    import shutil
    from concurrent.futures import ThreadPoolExecutor
    from threading import Barrier, Lock
    class RacingOCI(FakeOCI):
        def __init__(self):
            super().__init__()
            self.barrier, self.lock = Barrier(2), Lock()
        def put_object(self, *args, **kwargs):
            if args[2].endswith("alkamel-raw-000002.jsonl"):
                self.barrier.wait(timeout=5)
            with self.lock:
                return super().put_object(*args, **kwargs)
    one = _segment(tmp_path / "one")
    two = tmp_path / "two" / one.name
    shutil.copytree(one, two)
    changed = two / "raw/alkamel-raw-000002.jsonl"
    changed.write_bytes(changed.read_bytes().replace(b"4040", b"5050"))
    client = RacingOCI()
    store = OCIObjectStorageEventArchiveStore(namespace="qa", bucket="qa", client=client)
    def archive(path):
        try:
            return store.archive_segment(path).status
        except EventArchiveConflict:
            return "CONFLICT"
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(archive, [one, two]))
    assert sorted(results) == ["ARCHIVED", "CONFLICT"]
    winner = [one, two][results.index("ARCHIVED")]
    key = store._name("ARCHIVE_QA", one.name, "raw/alkamel-raw-000002.jsonl")
    assert client.objects[key] == (winner / "raw/alkamel-raw-000002.jsonl").read_bytes()


@pytest.mark.parametrize("same_size", [False, True])
def test_remote_manifest_semantically_equal_but_different_bytes_rejected(tmp_path, same_size):
    source = _segment(tmp_path)
    client = FakeOCI()
    store = OCIObjectStorageEventArchiveStore(namespace="qa", bucket="qa", client=client)
    first = store.archive_segment(source)
    name = store._name(first.logical_session_id, first.segment_id, "manifest.json")
    original = client.objects[name]
    changed = original.replace(b'\n  "', b'\n\t "') if same_size else json.dumps(json.loads(original), separators=(",", ":")).encode()
    assert changed != original and json.loads(changed) == json.loads(original)
    assert (len(changed) == len(original)) == same_size
    client.objects[name] = changed
    with pytest.raises(EventArchiveError, match="byte/hash"):
        store.archive_segment(source)


def test_readback_raw_hash_failure_and_non_precondition_errors(tmp_path):
    source = _segment(tmp_path)
    client = FakeOCI()
    store = OCIObjectStorageEventArchiveStore(namespace="qa", bucket="qa", client=client)
    archived = store.archive_segment(source)
    name = store._name(archived.logical_session_id, archived.segment_id, "raw/alkamel-raw-000001.jsonl")
    client.objects[name] = client.objects[name].replace(b'ACK', b'BAD')
    with pytest.raises(EventArchiveError, match="raw object integrity"):
        store.archive_segment(source)
    class Denied(FakeOCI):
        def put_object(self, *args, **kwargs):
            error = Exception("Denied")
            error.status = 403
            raise error
    denied = OCIObjectStorageEventArchiveStore(namespace="qa", bucket="qa", client=Denied())
    with pytest.raises(EventArchiveError, match="upload failed"):
        denied._put_immutable("test", b"test")


def test_refuses_unfinished_truncated_and_conflicting_evidence(tmp_path):
    source=_segment(tmp_path); manifest_path=source / "manifest.json"
    manifest=json.loads(manifest_path.read_text()); manifest["recording"]["status"]="RECORDING"; manifest_path.write_text(json.dumps(manifest))
    with pytest.raises(EventArchiveError): validate_completed_segment(source)
    manifest["recording"]["status"]="RECORDER_FINISHED"; manifest_path.write_text(json.dumps(manifest))
    raw=source / manifest["chunks"][0]["file"]; raw.write_text('{"lineNumber":1}\nnot-json\n')
    with pytest.raises(EventArchiveError): validate_completed_segment(source)

    source=_segment(tmp_path, "CONFLICT_QA"); store=LocalEventArchiveStore(tmp_path / "archive")
    store.archive_segment(source)
    raw=source / "raw" / "alkamel-raw-000001.jsonl"
    raw.write_text(raw.read_text().replace('"ACK"', '"OTHER"'))
    with pytest.raises(EventArchiveError): store.archive_segment(source)


def test_archive_session_isolation(tmp_path):
    store=LocalEventArchiveStore(tmp_path / "archive")
    one, two=_segment(tmp_path / "one", "SESSION_ONE"), _segment(tmp_path / "two", "SESSION_TWO")
    store.archive_segment(one); store.archive_segment(two)
    assert [item.logical_session_id for item in store.list_segments("SESSION_ONE")] == ["SESSION_ONE"]


def test_oci_layout_upload_verification_idempotency_and_materialization(tmp_path):
    source=_segment(tmp_path, "OCI_QA"); client=FakeOCI()
    store=OCIObjectStorageEventArchiveStore(namespace="EXAMPLE_NAMESPACE", bucket="example-event-archive", prefix="bronze/event_capture/sessions", client=client)
    first=store.archive_segment(source); second=store.archive_segment(source)
    base=f"bronze/event_capture/sessions/OCI_QA/{source.name}/"
    assert first.status == "ARCHIVED" and second.status == "ALREADY_ARCHIVED"
    assert base + "manifest.json" in client.objects and base + "raw/alkamel-raw-000001.jsonl" in client.objects
    restored=store.materialize_segment("OCI_QA", source.name, tmp_path / "oci-cache")
    assert [item.command for item in AksRecordingLoader(restored).iter_messages()] == ["ACK", "JSON"]
