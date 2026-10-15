"""Durable, post-session archive for finalized AKS raw recordings.

This module is deliberately not imported by the LIVE source service.  Operators
archive a completed recorder directory explicitly, after ``RECORDER_FINISHED``.
The archive contains raw evidence unchanged and is a future AIDP Bronze input,
not an event-critical persistence dependency.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import os
import re
import shutil
from typing import Any, Protocol


ARCHIVE_SCHEMA = "race-intelligence.event-archive.v1"
_SAFE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")


class EventArchiveError(RuntimeError):
    pass


class EventArchiveConflict(EventArchiveError):
    pass


@dataclass(frozen=True)
class ArchivedSegment:
    logical_session_id: str
    segment_id: str
    status: str
    manifest: dict[str, Any]
    location: str


class EventArchiveStore(Protocol):
    def archive_segment(self, segment_path: str | Path) -> ArchivedSegment: ...
    def list_segments(self, logical_session_id: str | None = None) -> list[ArchivedSegment]: ...
    def get_segment_manifest(self, logical_session_id: str, segment_id: str) -> dict[str, Any]: ...
    def materialize_segment(self, logical_session_id: str, segment_id: str, cache_dir: str | Path) -> Path: ...


def _safe(value: str, field: str) -> str:
    if not _SAFE.fullmatch(value):
        raise EventArchiveError(f"Unsafe {field}.")
    return value


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _read_json(path: Path) -> dict[str, Any]:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise EventArchiveError("Recording manifest is unreadable.") from exc
    if not isinstance(value, dict):
        raise EventArchiveError("Recording manifest must be an object.")
    return value


def validate_completed_segment(segment_path: str | Path) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """Validate a recorder directory without mutating it or opening a network."""
    root = Path(segment_path)
    manifest = _read_json(root / "manifest.json")
    recording = manifest.get("recording") if isinstance(manifest.get("recording"), dict) else {}
    if manifest.get("schema") != "maxv100.alkamel.session-manifest.v1":
        raise EventArchiveError("Unsupported recorder manifest schema.")
    if recording.get("status") != "RECORDER_FINISHED":
        raise EventArchiveError("Only RECORDER_FINISHED segments can be archived.")
    session = manifest.get("sessionId")
    if not isinstance(session, str) or not session:
        raise EventArchiveError("Recorder manifest has no logical session id.")
    chunks = manifest.get("chunks")
    if not isinstance(chunks, list) or not chunks:
        raise EventArchiveError("Recorder manifest has no raw chunks.")
    files, expected_sequence, byte_count, message_count, json_count = [], 1, 0, 0, 0
    for chunk in chunks:
        relative = chunk.get("file") if isinstance(chunk, dict) else None
        if not isinstance(relative, str) or not relative.startswith("raw/") or ".." in Path(relative).parts:
            raise EventArchiveError("Unsafe or missing raw chunk path.")
        path = root / relative
        if not path.is_file() or path.stat().st_size == 0:
            raise EventArchiveError("Raw chunk is missing or empty.")
        count = 0
        with path.open("r", encoding="utf-8") as handle:
            for line in handle:
                try:
                    envelope = json.loads(line)
                except json.JSONDecodeError as exc:
                    raise EventArchiveError("Raw JSONL is truncated or invalid.") from exc
                if not isinstance(envelope, dict) or envelope.get("lineNumber") != expected_sequence:
                    raise EventArchiveError("Raw message sequence is not continuous.")
                expected_sequence += 1; count += 1
                if envelope.get("command") == "JSON": json_count += 1
        if count == 0 or chunk.get("lineCount") != count or chunk.get("bytes") != path.stat().st_size:
            raise EventArchiveError("Raw chunk counts do not match its manifest.")
        byte_count += path.stat().st_size; message_count += count
        files.append({"path": relative, "bytes": path.stat().st_size, "sha256": _sha256(path)})
    if recording.get("lineCount") != message_count or recording.get("bytes") != byte_count or recording.get("jsonMessageCount") != json_count:
        raise EventArchiveError("Recorder totals do not match raw evidence.")
    return manifest, files


def _archive_manifest(source: dict[str, Any], files: list[dict[str, Any]], segment_id: str) -> dict[str, Any]:
    recording = source["recording"]
    return {
        "schema": ARCHIVE_SCHEMA, "archiveStatus": "ARCHIVED", "source": "AKS",
        "logicalSessionId": source["sessionId"], "segmentId": segment_id,
        "operationalContext": source.get("operationalContext"), "startedAt": source.get("openedAt"),
        "endedAt": source.get("closedAt"), "recorderStatus": recording["status"],
        "messageCount": recording["lineCount"], "jsonMessageCount": recording["jsonMessageCount"],
        "byteCount": recording["bytes"], "rawFileCount": len(files), "reconnectCount": recording.get("reconnectCount", 0),
        "eventContractVersion": "1.0", "sourceEpoch": source.get("sourceEpoch"),
        "archivedAt": datetime.now(timezone.utc).isoformat(), "files": files,
        # This is provenance only, never a transformed serving structure.
        "recorderManifestSha256": None,
    }


class LocalEventArchiveStore:
    """Deterministic filesystem archive used for tests and offline operations."""
    def __init__(self, root: str | Path): self.root = Path(root)

    def _target(self, session: str, segment: str) -> Path:
        return self.root / "race-intelligence" / "event-capture" / _safe(session, "session id") / _safe(segment, "segment id")

    def archive_segment(self, segment_path: str | Path) -> ArchivedSegment:
        source_root = Path(segment_path); source, files = validate_completed_segment(source_root)
        session, segment = _safe(source["sessionId"], "session id"), _safe(source_root.name, "segment id")
        target = self._target(session, segment); archive = _archive_manifest(source, files, segment)
        archive["recorderManifestSha256"] = _sha256(source_root / "manifest.json")
        if target.exists():
            existing = self.get_segment_manifest(session, segment)
            comparable = {k: existing.get(k) for k in ("recorderManifestSha256", "files", "logicalSessionId", "segmentId")}
            expected = {k: archive.get(k) for k in comparable}
            if comparable != expected: raise EventArchiveConflict("Archive target already exists with different evidence.")
            return ArchivedSegment(session, segment, "ALREADY_ARCHIVED", existing, str(target))
        target.mkdir(parents=True)
        try:
            shutil.copy2(source_root / "manifest.json", target / "manifest.json")
            for item in files:
                destination = target / item["path"]; destination.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(source_root / item["path"], destination)
                if destination.stat().st_size != item["bytes"] or _sha256(destination) != item["sha256"]:
                    raise EventArchiveError("Archive copy verification failed.")
            (target / "archive-manifest.json").write_text(json.dumps(archive, sort_keys=True, indent=2) + "\n", encoding="utf-8")
        except Exception:
            shutil.rmtree(target, ignore_errors=True); raise
        return ArchivedSegment(session, segment, "ARCHIVED", archive, str(target))

    def get_segment_manifest(self, logical_session_id: str, segment_id: str) -> dict[str, Any]:
        return _read_json(self._target(logical_session_id, segment_id) / "archive-manifest.json")

    def list_segments(self, logical_session_id: str | None = None) -> list[ArchivedSegment]:
        base = self.root / "race-intelligence" / "event-capture"
        sessions = [base / _safe(logical_session_id, "session id")] if logical_session_id else sorted(base.glob("*")) if base.exists() else []
        result=[]
        for session in sessions:
            if not session.is_dir(): continue
            for segment in sorted(session.glob("*")):
                if segment.is_dir():
                    manifest=_read_json(segment / "archive-manifest.json")
                    result.append(ArchivedSegment(session.name, segment.name, manifest.get("archiveStatus", "ARCHIVED"), manifest, str(segment)))
        return result

    def materialize_segment(self, logical_session_id: str, segment_id: str, cache_dir: str | Path) -> Path:
        manifest=self.get_segment_manifest(logical_session_id, segment_id); source=self._target(logical_session_id, segment_id)
        target=Path(cache_dir) / _safe(logical_session_id,"session id") / _safe(segment_id,"segment id")
        if target.exists(): shutil.rmtree(target)
        shutil.copytree(source, target, ignore=shutil.ignore_patterns("archive-manifest.json"))
        validate_completed_segment(target)
        if manifest.get("recorderStatus") != "RECORDER_FINISHED": raise EventArchiveError("Archived segment is not finalized.")
        return target


class OCIObjectStorageEventArchiveStore:
    """OCI Object Storage implementation of the post-session archive contract.

    ``client`` permits deterministic tests. Production construction uses the OCI
    SDK configuration selected by ``OCI_CONFIG_FILE`` / ``OCI_CONFIG_PROFILE``.
    It is never constructed by the LIVE source service.
    """
    def __init__(self, *, namespace: str | None = None, bucket: str | None = None,
                 prefix: str | None = None, client: Any | None = None):
        self.namespace = namespace or os.getenv("OCI_OBJECT_STORAGE_NAMESPACE")
        self.bucket = bucket or os.getenv("OCI_EVENT_ARCHIVE_BUCKET")
        self.prefix = (prefix or os.getenv("OCI_EVENT_ARCHIVE_PREFIX") or "bronze/event_capture/sessions").strip("/")
        if not self.namespace or not self.bucket:
            raise EventArchiveError("OCI archive requires OCI_OBJECT_STORAGE_NAMESPACE and OCI_EVENT_ARCHIVE_BUCKET.")
        if client is None:
            try:
                import oci
                config = oci.config.from_file(os.getenv("OCI_CONFIG_FILE", "~/.oci/config"), os.getenv("OCI_CONFIG_PROFILE", "DEFAULT"))
                client = oci.object_storage.ObjectStorageClient(config)
            except ImportError as exc:
                raise EventArchiveError("OCI SDK is not installed; install the 'oci' package to activate OCI archive.") from exc
            except Exception as exc:
                raise EventArchiveError("OCI archive client could not be configured.") from exc
        self.client = client

    def _name(self, session: str, segment: str, relative: str) -> str:
        return f"{self.prefix}/{_safe(session, 'session id')}/{_safe(segment, 'segment id')}/{relative.lstrip('/')}"

    @staticmethod
    def _body(response: Any) -> bytes:
        data = getattr(response, "data", response)
        if isinstance(data, bytes): return data
        content = getattr(data, "content", None)
        if isinstance(content, bytes): return content
        raw = getattr(data, "raw", None)
        if raw and hasattr(raw, "stream"): return b"".join(raw.stream(1024 * 1024, decode_content=False))
        if hasattr(data, "read"): return data.read()
        raise EventArchiveError("OCI object response is unreadable.")

    @staticmethod
    def _not_found(exc: Exception) -> bool:
        return getattr(exc, "status", None) == 404

    def _get(self, name: str) -> bytes | None:
        try:
            return self._body(self.client.get_object(self.namespace, self.bucket, name))
        except Exception as exc:
            if self._not_found(exc): return None
            raise EventArchiveError("OCI object retrieval failed.") from exc

    def _create_only(self, name: str, body: bytes) -> bool:
        """OCI atomically rejects an existing key (HTTP 412); never overwrite it."""
        try:
            self.client.put_object(self.namespace, self.bucket, name, body, if_none_match="*")
        except Exception as exc:
            if getattr(exc, "status", None) == 412:
                return False
            raise EventArchiveError("OCI object upload failed.") from exc
        return True

    def _put_immutable(self, name: str, body: bytes) -> bool:
        created = self._create_only(name, body)
        copied = self._get(name)
        if copied is None or len(copied) != len(body) or hashlib.sha256(copied).digest() != hashlib.sha256(body).digest():
            if not created:
                raise EventArchiveConflict("OCI object already exists with different evidence.")
            raise EventArchiveError("OCI object upload verification failed.")
        return created

    def archive_segment(self, segment_path: str | Path) -> ArchivedSegment:
        source_root = Path(segment_path); source, files = validate_completed_segment(source_root)
        session, segment = _safe(source["sessionId"], "session id"), _safe(source_root.name, "segment id")
        archive = _archive_manifest(source, files, segment)
        manifest_bytes = (source_root / "manifest.json").read_bytes()
        if json.loads(manifest_bytes) != source:
            raise EventArchiveConflict("Local recorder manifest changed during validation.")
        archive["recorderManifestSha256"] = hashlib.sha256(manifest_bytes).hexdigest()
        archive_name = self._name(session, segment, "archive-manifest.json")
        prior = self._get(archive_name)
        if prior is not None:
            try: existing = json.loads(prior)
            except json.JSONDecodeError as exc: raise EventArchiveConflict("OCI archive manifest is invalid.") from exc
            if not isinstance(existing, dict) or {k: v for k, v in existing.items() if k != "archivedAt"} != {k: v for k, v in archive.items() if k != "archivedAt"}:
                raise EventArchiveConflict("OCI archive target exists with conflicting evidence.")
            self._verify_remote(session, segment, manifest_bytes, archive["recorderManifestSha256"], files)
            return ArchivedSegment(session, segment, "ALREADY_ARCHIVED", existing, f"oci://{self.bucket}/{self.prefix}/{session}/{segment}")
        # Preserve the recorder manifest at the required root location, then raw evidence.
        self._put_immutable(self._name(session, segment, "manifest.json"), manifest_bytes)
        for item in files:
            body = (source_root / item["path"]).read_bytes()
            if len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise EventArchiveConflict("Local raw evidence changed during upload.")
            self._put_immutable(self._name(session, segment, item["path"]), body)
        self._verify_remote(session, segment, manifest_bytes, archive["recorderManifestSha256"], files)
        created = self._create_only(archive_name, json.dumps(archive, sort_keys=True, indent=2).encode("utf-8") + b"\n")
        # archivedAt is the winning writer's timestamp, not evidence identity.
        existing = self.get_segment_manifest(session, segment)
        if not isinstance(existing, dict) or {k: v for k, v in existing.items() if k != "archivedAt"} != {k: v for k, v in archive.items() if k != "archivedAt"}:
            raise EventArchiveConflict("OCI archive manifest conflicts with verified evidence.")
        return ArchivedSegment(session, segment, "ARCHIVED" if created else "ALREADY_ARCHIVED", existing, f"oci://{self.bucket}/{self.prefix}/{session}/{segment}")

    def _verify_remote(self, session: str, segment: str, expected_bytes: bytes, expected_hash: str, files: list[dict[str, Any]]) -> None:
        manifest = self._get(self._name(session, segment, "manifest.json"))
        # Compare exact source-manifest bytes and every raw object size/hash.
        if manifest is None: raise EventArchiveError("OCI recorder manifest is missing.")
        if len(manifest) != len(expected_bytes) or hashlib.sha256(manifest).hexdigest() != expected_hash:
            raise EventArchiveError("OCI recorder manifest byte/hash verification failed.")
        for item in files:
            body = self._get(self._name(session, segment, item["path"]))
            if body is None or len(body) != item["bytes"] or hashlib.sha256(body).hexdigest() != item["sha256"]:
                raise EventArchiveError("OCI raw object integrity verification failed.")

    def get_segment_manifest(self, logical_session_id: str, segment_id: str) -> dict[str, Any]:
        body=self._get(self._name(logical_session_id, segment_id, "archive-manifest.json"))
        if body is None: raise FileNotFoundError("Archived segment does not exist.")
        try: return json.loads(body)
        except json.JSONDecodeError as exc: raise EventArchiveError("OCI archive manifest is unreadable.") from exc

    def list_segments(self, logical_session_id: str | None = None) -> list[ArchivedSegment]:
        prefix=f"{self.prefix}/" + (f"{_safe(logical_session_id, 'session id')}/" if logical_session_id else "")
        try: objects=getattr(self.client.list_objects(self.namespace, self.bucket, prefix=prefix).data, "objects", [])
        except Exception as exc: raise EventArchiveError("OCI archive listing failed.") from exc
        result=[]
        for item in objects:
            name=getattr(item,"name", item.get("name") if isinstance(item,dict) else "")
            if not isinstance(name,str) or not name.endswith("/archive-manifest.json"): continue
            manifest=self.get_segment_manifest(*name.removeprefix(f"{self.prefix}/").split("/")[-3:-1])
            result.append(ArchivedSegment(manifest["logicalSessionId"],manifest["segmentId"],manifest.get("archiveStatus","ARCHIVED"),manifest,f"oci://{self.bucket}/{name.rsplit('/',1)[0]}"))
        return result

    def materialize_segment(self, logical_session_id: str, segment_id: str, cache_dir: str | Path) -> Path:
        manifest=self.get_segment_manifest(logical_session_id,segment_id)
        target=Path(cache_dir)/_safe(logical_session_id,"session id")/_safe(segment_id,"segment id")
        if target.exists(): shutil.rmtree(target)
        target.mkdir(parents=True)
        try:
            recorder=self._get(self._name(logical_session_id,segment_id,"manifest.json"))
            if recorder is None: raise EventArchiveError("OCI recorder manifest is missing.")
            if hashlib.sha256(recorder).hexdigest() != manifest.get("recorderManifestSha256"):
                raise EventArchiveError("OCI recorder manifest byte/hash verification failed.")
            (target/"manifest.json").write_bytes(recorder)
            for item in manifest.get("files",[]):
                relative=item.get("path") if isinstance(item,dict) else None
                if not isinstance(relative,str) or not relative.startswith("raw/") or ".." in Path(relative).parts:
                    raise EventArchiveError("OCI archive file manifest is invalid.")
                body=self._get(self._name(logical_session_id,segment_id,relative))
                if body is None: raise EventArchiveError("OCI raw object is missing.")
                if len(body) != item.get("bytes") or hashlib.sha256(body).hexdigest() != item.get("sha256"):
                    raise EventArchiveError("OCI raw object integrity verification failed.")
                output=target/relative; output.parent.mkdir(parents=True,exist_ok=True); output.write_bytes(body)
            validate_completed_segment(target)
        except Exception:
            shutil.rmtree(target,ignore_errors=True); raise
        return target


def materialize_archive_uri(uri: str, *, archive_root: str | Path, cache_dir: str | Path) -> Path:
    """Resolve ``archive://session/segment`` to a local replay-reader directory."""
    if not uri.startswith("archive://"):
        return Path(uri)
    parts = uri.removeprefix("archive://").split("/")
    if len(parts) != 2 or not all(parts):
        raise EventArchiveError("Archive replay URI must be archive://<session>/<segment>.")
    return LocalEventArchiveStore(archive_root).materialize_segment(parts[0], parts[1], cache_dir)
