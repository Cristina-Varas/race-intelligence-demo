"""Session-scoped, normalized-event card projection. No raw reads or persistence.

Frontend reload preserves this state; backend restart starts a new observation
window. Snapshots are detached, suitable for a future frozen-moment consumer,
but this service does not retain or promise historical time travel.
"""
from copy import deepcopy
from datetime import datetime, timezone
from threading import RLock
from .baseball_card_evidence import CardEvidenceProjection
from .baseball_card_data import _event_row, _kart_sort_key


class LiveBaseballCards:
    def __init__(self, source_epochs=None, state_store=None):
        self.sessions = {}
        self.source_epochs = source_epochs
        self.state_store = state_store
        self.lock = source_epochs.lock if source_epochs else RLock()

    def _empty(self, event):
        return {'projection':CardEvidenceProjection(manage_source_boundaries=False),
                'sequence':-1,'version':0,'context':event.operational_context,'updatedAt':None,
                'sourceEpoch':getattr(event,'source_epoch',1)}

    def consume(self, event):
        with self.lock:
            entry = self.sessions.setdefault(event.session_id, self._empty(event))
            if event.sequence <= entry["sequence"]:
                return
            if entry['sourceEpoch'] != getattr(event,'source_epoch',1):
                fresh = self._empty(event)
                fresh['version'] = entry['version']
                self.sessions[event.session_id] = entry = fresh
            entry["sequence"] = event.sequence
            entry["version"] += 1
            if event.event_type in {"SESSION_STATE", "STANDINGS_UPDATE", "LAP_UPDATE"}:
                entry["projection"].publish(event)
                entry["updatedAt"] = event.observed_at

    def snapshot(self, session_id, source_mode):
        # A single lock freezes all rows and the logical version, including when
        # sync FastAPI export endpoints execute on a worker thread.
        with self.lock:
            entry = self.sessions.get(session_id)
            if entry is None:
                raise FileNotFoundError("No tracked hot-path card state exists for this session.")
            epoch = self.source_epochs.current(session_id) if self.source_epochs else entry['sourceEpoch']
            state = self.state_store.snapshot(session_id) if self.state_store else None
            compatible = entry['sourceEpoch']==epoch and (self.state_store is None or (state is not None and state['sourceEpoch']==epoch))
            records = deepcopy(entry["projection"].result()) if compatible else {}
            version, context, updated = entry["version"], entry["context"], entry["updatedAt"]
        rows = sorted((_event_row(0, record) for record in records.values()), key=_kart_sort_key)
        for index, row in enumerate(rows, 1):
            row.update({"Card No": index, "Campaign": "MAX VS 100", "Campaign Subtitle": "RACE INTELLIGENCE",
                        "Primary Result Label": "FACTUAL EVENT", "operationalContext": context})
        return {"sessionId": session_id, "mode": "event", "rows": rows, "metadata": {
            "sourceType": "LIVE_NORMALIZED_EVENT_PROJECTION", "sourceMode": source_mode,
            "sourceEpoch":epoch, "sourceState":"READY" if rows else "REBUILDING",
            "stateVersion": version, "generatedAt": datetime.now(timezone.utc).isoformat(),
            "updatedAt": updated, "operationalContext": context, "rowCount": len(rows),
            "eventContractVersion": "1.0", "evidenceDomain": "FACTUAL_OBSERVATION",
            "finalClassificationSupport": "NOT_SUPPORTED",
            "recovery": "In-memory tracked session; backend restart begins a new observation window.",
        }}
