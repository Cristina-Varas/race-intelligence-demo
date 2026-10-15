"""Append-only Event Moments and frozen factual participant snapshots.

This service deliberately contains no names, media, social handles, or identity
resolution.  `external_participant_number` is the only creative-team join key.
"""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime, timezone
from typing import Any, Iterable

from .event_capture import EventCaptureService
from .event_journal import now_utc
from .event_journal import EventJournal
from copy import deepcopy
from pathlib import Path
from threading import RLock
import hashlib
import os
import uuid
import logging

class SourceEvidenceConflict(RuntimeError):
    """Safe HTTP conflict: no stale evidence may be substituted."""

GAP_SIGNIFICANCE_SECONDS = 1.0
POSITION_CAPTURE_DELTA = 2
CAPTURE_COOLDOWN_SECONDS = 30
SAFE_AUTOMATIC_TYPES = {"POSITION_CHANGE", "LEADER_CHANGE"}
OPERATOR_TYPES = {"KEY_MOMENT", "PASS_CONFIRMED", "REACTION", "NOTE"}


MOMENT_TYPES = {
    "PRE_RACE", "START", "MID_RACE", "POSITION_CHANGE", "GAP_CHANGE",
    "LEADER_CHANGE", "PREDICTION_CHANGE", "TARGET_CHANGE", "CONFIRMED_PASS",
    "FASTEST_LAP", "CHALLENGER_PERFORMANCE", "KEY_MOMENT",
    "CONTROL_ROOM_REACTION", "END_OF_CAPTURE", "FINISH", "MANUAL_MARKER",
}
MODELLED_MOMENT_TYPES = {"PREDICTION_CHANGE", "TARGET_CHANGE"}


def _as_utc_iso(value: datetime | str | None) -> str:
    if value is None:
        return now_utc().isoformat()
    if isinstance(value, str):
        return value
    value = value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)
    return value.isoformat()


def moment_evidence_domain(moment_type: str) -> str:
    return "MODELLED_SCENARIO" if moment_type in MODELLED_MOMENT_TYPES else "FACTUAL_OBSERVATION"


def automatic_moment_candidates(rows: Iterable[dict[str, Any]], *, position_debounce_seconds: int = 20,
                                gap_change_threshold_seconds: float = GAP_SIGNIFICANCE_SECONDS,
                                gap_debounce_seconds: int = 30) -> list[dict[str, Any]]:
    """Produce deterministic, non-pass candidates from ordered factual standings.

    The caller persists candidates.  No GPS or position change is ever converted
    to a physical pass.
    """
    ordered = sorted(rows, key=lambda row: (str(row.get("observedAt") or ""), str(row.get("snapshotId") or ""), str(row.get("participantId") or "")))
    previous_by_participant: dict[str, dict[str, Any]] = {}
    leader_by_snapshot: dict[str, str | None] = {}
    last_emitted: dict[tuple[str, str], datetime] = {}
    candidates: list[dict[str, Any]] = []

    def allow(kind: str, participant_id: str, value: datetime, seconds: int) -> bool:
        previous = last_emitted.get((kind, participant_id))
        if previous and (value - previous).total_seconds() < seconds:
            return False
        last_emitted[(kind, participant_id)] = value
        return True

    for row in ordered:
        participant_id = row.get("participantId")
        observed = row.get("observedAt")
        if not participant_id or not observed:
            continue
        stamp = observed if isinstance(observed, datetime) else datetime.fromisoformat(str(observed).replace("Z", "+00:00"))
        stamp = stamp.replace(tzinfo=timezone.utc) if stamp.tzinfo is None else stamp.astimezone(timezone.utc)
        previous = previous_by_participant.get(participant_id)
        if previous is not None and previous.get("position") is not None and row.get("position") is not None:
            delta = int(previous["position"]) - int(row["position"])
            if delta and allow("POSITION_CHANGE", participant_id, stamp, position_debounce_seconds):
                candidates.append({"momentType": "POSITION_CHANGE", "primaryParticipantId": participant_id,
                                   "observedAt": _as_utc_iso(stamp), "priorValue": previous["position"],
                                   "currentValue": row["position"], "deltaValue": delta, "unit": "positions",
                                   "sourceSnapshotId": row.get("snapshotId"), "triggerRule": "FACTUAL_POSITION_DELTA"})
        if previous is not None and previous.get("gapFirstSeconds") is not None and row.get("gapFirstSeconds") is not None:
            delta = float(row["gapFirstSeconds"]) - float(previous["gapFirstSeconds"])
            if abs(delta) >= gap_change_threshold_seconds and allow("GAP_CHANGE", participant_id, stamp, gap_debounce_seconds):
                candidates.append({"momentType": "GAP_CHANGE", "primaryParticipantId": participant_id,
                                   "observedAt": _as_utc_iso(stamp), "priorValue": previous["gapFirstSeconds"],
                                   "currentValue": row["gapFirstSeconds"], "deltaValue": delta, "unit": "seconds",
                                   "sourceSnapshotId": row.get("snapshotId"), "triggerRule": "FACTUAL_GAP_DELTA"})
        snapshot_id = str(row.get("snapshotId") or observed)
        if row.get("position") == 1 and snapshot_id not in leader_by_snapshot:
            leader_by_snapshot[snapshot_id] = participant_id
            previous_leader = leader_by_snapshot.get("__last__")
            if previous_leader and previous_leader != participant_id:
                candidates.append({"momentType": "LEADER_CHANGE", "primaryParticipantId": participant_id,
                                   "relatedParticipantId": previous_leader, "observedAt": _as_utc_iso(stamp),
                                   "sourceSnapshotId": row.get("snapshotId"), "triggerRule": "FACTUAL_LEADER_CHANGE"})
            leader_by_snapshot["__last__"] = participant_id
        previous_by_participant[participant_id] = row
    return candidates


class EventMomentService:
    def __init__(self, capture: EventCaptureService):
        self.capture = capture

    def moments(self, session_id: str) -> list[dict[str, Any]]:
        entries = [entry for entry in self.capture.journal.latest_entries().values()
                   if entry.get("sessionId") == session_id and entry.get("entityKind") == "event_moment"]
        return sorted((dict(entry["record"], captureId=entry["id"], syncStatus=entry["syncStatus"]) for entry in entries),
                      key=lambda row: (row.get("observed_at") or row.get("created_at") or "", row.get("moment_id") or ""), reverse=True)

    def moment(self, session_id: str, moment_id: str) -> dict[str, Any] | None:
        return next((row for row in self.moments(session_id) if row.get("moment_id") == moment_id), None)

    def snapshots(self, session_id: str, moment_id: str) -> list[dict[str, Any]]:
        entries = [entry["record"] for entry in self.capture.journal.latest_entries().values()
                   if entry.get("sessionId") == session_id and entry.get("entityKind") == "participant_snapshot"
                   and entry.get("record", {}).get("moment_id") == moment_id]
        return sorted(entries, key=lambda row: (str(row.get("position") or 999999), str(row.get("participant_id") or "")))

    def create(self, *, session_id: str, record: dict[str, Any], snapshots: list[dict[str, Any]],
               idempotency_key: str | None = None) -> dict[str, Any]:
        moment_id = record["moment_id"]
        existing = self.moment(session_id, moment_id)
        if existing is not None:
            return existing
        acknowledgement = self.capture.capture(operation="CAPTURE_EVENT_MOMENT", session_id=session_id,
                                               entity_kind="event_moment", record=record,
                                               idempotency_key=idempotency_key)
        for snapshot in snapshots:
            self.capture.capture(operation="CAPTURE_PARTICIPANT_SNAPSHOT", session_id=session_id,
                                 entity_kind="participant_snapshot", record=snapshot,
                                 idempotency_key=f"{moment_id}:{snapshot['participant_id']}")
        return {**record, "captureId": acknowledgement["id"], "syncStatus": acknowledgement["syncStatus"]}


class HotPathMomentService:
    """Retained side of the existing candidate engine, not a second detector.

    One durable envelope contains the entire frozen snapshot. LIVE and REPLAY
    use separate journals. Single-process operation; no database/network work.
    """
    def __init__(self, candidates, cards, mode, directory=None):
        self.candidate_engine, self.cards, self.mode = candidates, cards, mode.upper()
        if self.mode not in {"LIVE", "REPLAY"}: raise ValueError("Invalid moment source mode")
        self.directory = Path(directory or os.getenv("EVENT_MOMENTS_DIR", str(Path.home()/'.race-intelligence'/'event-moments'))).resolve()
        if Path(__file__).resolve().parents[4] in (self.directory, *self.directory.parents):
            raise ValueError("Event Moment runtime journals must be outside Git")
        self.source_epochs = cards.source_epochs
        self.lock = self.source_epochs.lock if self.source_epochs else RLock()
        self.epochs = {}
        self.sequences = {}
        self.retained, self.live, self.pending, self.journals = {}, {}, {}, {}

    def _load(self, session):
        if session not in self.retained:
            journal = EventJournal(self.directory/self.mode/hashlib.sha256(session.encode()).hexdigest())
            journal.path = journal.directory/'event_moments.jsonl'
            entries = journal.latest_entries()
            self.retained[session] = {key: value['record'] for key,value in entries.items() if value.get('sessionId') == session}
            self.journals[session] = journal
        return self.retained[session]

    def _freeze(self, session, candidate=None, primary=None, secondary=None):
        context = self.live.get(session)
        if not context: raise SourceEvidenceConflict("REBUILDING LIVE EVENT EVIDENCE: no current snapshot")
        self._check_epoch(session,context.get('epoch'),candidate)
        if context.get('sourceState') != 'READY':
            raise SourceEvidenceConflict('REBUILDING LIVE EVENT EVIDENCE')
        rows = context['rows']; by_id = {r['Participant ID']:r for r in rows}
        primary = primary or (candidate or {}).get('participantId')
        if primary and primary not in by_id: raise ValueError("Select a factual participant")
        if secondary and secondary not in by_id: raise ValueError("Select a factual second participant")
        row = by_id.get(primary, {}); second = by_id.get(secondary,{})
        leader = next((r.get('Kart No') for r in rows if r.get('latestObservedPosition') == 1),None)
        c = candidate or {}; kind = c.get('momentType')
        previous_leader = by_id.get(c.get('previous'),{}).get('Kart No') if kind=='LEADER_CHANGE' else None
        if kind == 'LEADER_CHANGE' and (not c.get('previous') or c.get('previous')==c.get('current') or c.get('current')!=primary or row.get('latestObservedPosition')!=1 or previous_leader is None or previous_leader==leader):
            logging.getLogger(__name__).warning('INCOHERENT_LEADER_EVIDENCE')
            raise SourceEvidenceConflict('Incoherent leader evidence; capture rejected')
        return deepcopy({'source_epoch':context['epoch'],'source_process_id':self.source_epochs.process_id if self.source_epochs else None,
            'session_id':session,'observed_at':context['observedAt'],'recorded_at':context['recordedAt'],
            'state_version':context['version'],'operational_context':context['context'], 'source_mode':self.mode,
            'source':'AKS','evidence_domain':'FACTUAL_OBSERVATION','primary_participant_id':primary,
            'primary_kart_number':row.get('Kart No'),'secondary_participant_id':secondary,
            'secondary_kart_number':second.get('Kart No'),'observed_leader_kart':leader,'observed_field_size':len(rows),
            'latest_observed_position':row.get('latestObservedPosition'),'peak_observed_position':row.get('Peak Position'),
            'observed_lap':row.get('observedLap'),'gap_to_leader':row.get('gapToLeaderSeconds'),
            'interval':row.get('intervalSeconds'),'best_valid_lap':row.get('bestLapSeconds'),
            'previous_gap':c.get('previous') if kind=='GAP_CHANGE' else None,
            'current_gap':c.get('current') if kind=='GAP_CHANGE' else None,
            'gap_delta':c['current']-c['previous'] if kind=='GAP_CHANGE' else None,
            'previous_position':c.get('previous') if kind=='POSITION_CHANGE' else None,
            'current_position':c.get('current') if kind=='POSITION_CHANGE' else None,
            'previous_leader_kart':previous_leader,'current_leader_kart':leader if kind=='LEADER_CHANGE' else None})

    def _check_epoch(self, session, epoch, candidate=None):
        current = self.source_epochs.current(session) if self.source_epochs else self.epochs.get(session,1)
        card = self.cards.snapshot(session,self.mode)['metadata']
        if epoch != current or card.get('sourceEpoch') != current or card.get('sourceState') != 'READY' or (candidate and candidate.get('sourceEpoch') != current):
            logging.getLogger(__name__).warning('SOURCE_EPOCH_CONFLICT')
            raise SourceEvidenceConflict('SOURCE RESET / REBUILDING: incompatible source epoch')

    def consume(self, event):
        if event.evidence_domain != 'FACTUAL_OBSERVATION': return
        with self.lock:
            if event.sequence <= self.sequences.get(event.session_id,-1): return
            self.sequences[event.session_id] = event.sequence
            epoch = getattr(event,'source_epoch',1)
            if self.epochs.get(event.session_id) != epoch:
                self.epochs[event.session_id] = epoch
                self.pending.pop(event.session_id,None)
                self.live.pop(event.session_id,None)
            if event.event_type not in {'STANDINGS_UPDATE','SESSION_STATE','LAP_UPDATE'}: return
            snapshot = self.cards.snapshot(event.session_id,self.mode)
            self.live[event.session_id] = {'rows':snapshot['rows'],'version':snapshot['metadata']['stateVersion'],
                'epoch':snapshot['metadata']['sourceEpoch'],'sourceState':snapshot['metadata']['sourceState'],
                'context':event.operational_context,'observedAt':event.observed_at,'recordedAt':event.recorded_at}
            if event.event_type != 'STANDINGS_UPDATE': return
            retained = self._load(event.session_id)
            pending = self.pending.setdefault(event.session_id,{})
            for c in self.candidate_engine.candidates.get(event.session_id,[]):
                if c.get('eventId') != event.event_id: continue
                # Keep the engine's transient stream intact; the retained/UI
                # boundary presents only meaningful gap signals.
                if c['momentType']=='GAP_CHANGE' and abs(c['current']-c['previous'])<GAP_SIGNIFICANCE_SECONDS: continue
                key=c['candidateId']
                if key in pending: continue
                try: frozen=self._freeze(event.session_id,c)
                except SourceEvidenceConflict: continue
                pending[key]={'candidateId':key,'momentType':c['momentType'],'snapshot':frozen}
                # Gap signals remain promotable candidates, never automatic captures.
                kind=c['momentType']; significant = kind=='LEADER_CHANGE' or (kind=='POSITION_CHANGE' and abs(c['current']-c['previous'])>=POSITION_CAPTURE_DELTA)
                prior=[r for r in retained.values() if r['moment_type']==kind and r['primary_participant_id']==c['participantId'] and r['capture_origin']=='AUTOMATIC' and r.get('source_epoch')==epoch and r.get('source_process_id')==frozen.get('source_process_id')]
                recent=max((r['captured_at'] for r in prior),default=None)
                cooldown=recent and (now_utc()-datetime.fromisoformat(recent)).total_seconds()<CAPTURE_COOLDOWN_SECONDS
                if significant and (kind=='LEADER_CHANGE' or not cooldown): self._capture(event.session_id,kind,'AUTOMATIC',frozen,key)
            while len(pending)>100: pending.pop(next(iter(pending)))

    def _capture(self, session, kind, origin, frozen, key=None, note=None):
        self._check_epoch(session,frozen.get('source_epoch'))
        if kind=='LEADER_CHANGE' and (frozen.get('previous_leader_kart') is None or frozen.get('previous_leader_kart')==frozen.get('current_leader_kart')):
            raise SourceEvidenceConflict('Incoherent leader evidence; capture rejected')
        if origin=='AUTOMATIC' and kind not in SAFE_AUTOMATIC_TYPES: raise ValueError("Unsupported automatic moment")
        moment_id='moment_'+hashlib.sha256((key or uuid.uuid4().hex).encode()).hexdigest()
        retained=self._load(session)
        if moment_id in retained: return deepcopy(retained[moment_id])
        record={**deepcopy(frozen),'moment_id':moment_id,'captured_at':now_utc().isoformat(),'moment_type':kind,
            'capture_origin':origin,'operator_asserted':origin=='OPERATOR','headline':kind.replace('_',' '),
            'operator_note':note,'review_status':'UNREVIEWED','social_selected':False,
            'disclosure':'FACTUAL EVENT MOMENT — '+('OPERATOR ASSERTED' if origin=='OPERATOR' else 'DERIVED FROM OBSERVED EVENT TIMING')}
        self.journals[session].append({'id':moment_id,'sessionId':session,'operation':'MOMENT_CAPTURED','record':record})
        retained[moment_id]=record
        return deepcopy(record)

    def capture(self,session,kind='KEY_MOMENT',primary=None,secondary=None,note=None,candidate_id=None):
        with self.lock:
            if candidate_id:
                c=self.pending.get(session,{}).get(candidate_id)
                if not c: raise SourceEvidenceConflict("Candidate expired or source reset; no newer state was substituted")
                return self._capture(session,c['momentType'],'OPERATOR',c['snapshot'],candidate_id,note)
            if kind not in OPERATOR_TYPES: raise ValueError("Unsupported operator type")
            if kind=='PASS_CONFIRMED' and (not primary or not secondary or primary==secondary): raise ValueError("PASS_CONFIRMED requires two different factual karts")
            return self._capture(session,kind,'OPERATOR',self._freeze(session,primary=primary,secondary=secondary),note=note)

    def snapshot(self,session):
        with self.lock:
            rows=deepcopy(sorted(self._load(session).values(),key=lambda r:(r['captured_at'],r['moment_id'])))
            context=self.live.get(session,{})
            current = self.source_epochs.current(session) if self.source_epochs else self.epochs.get(session,1)
            compatible = context.get('epoch')==current
            if not compatible: context={}
            priority={'LEADER_CHANGE':0,'POSITION_CHANGE':1,'GAP_CHANGE':2}
            candidates=sorted(deepcopy([c for c in self.pending.get(session,{}).values() if c['snapshot'].get('source_epoch')==current and compatible]),key=lambda c:c['snapshot']['observed_at'] or '',reverse=True)
            candidates.sort(key=lambda c:priority[c['momentType']])
            return {'moments':rows,'candidates':candidates[:20],'participants':[{'participantId':r['Participant ID'],'kartNumber':r['Kart No']} for r in context.get('rows',[])],
                'metadata':{'sourceEpoch':current,'sourceState':context.get('sourceState','REBUILDING'),'session_id':session,'generated_at':now_utc().isoformat(),'source_mode':self.mode,
                'operational_context':context.get('context') or (rows[-1]['operational_context'] if rows else None),
                'state_version_at_export':context.get('version'),'captured_moment_count':len(rows),
                'automatic_count':sum(r['capture_origin']=='AUTOMATIC' for r in rows),'operator_count':sum(r['capture_origin']=='OPERATOR' for r in rows),'export_schema_version':'live-event-moments-1.0'}}
