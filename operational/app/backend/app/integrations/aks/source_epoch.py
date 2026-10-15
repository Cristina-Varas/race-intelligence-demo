"""Canonical, process-local source timing-session boundary (not a lap heuristic)."""
from dataclasses import replace
from threading import RLock
from uuid import uuid4


class SourceEpochs:
    def __init__(self):
        self.lock = RLock()
        self.process_id = uuid4().hex
        self.sessions = {}

    def current(self, session):
        return self.sessions.get(session, {}).get('epoch', 1)

    def tag(self, event):
        """Called once before ordered delivery; all consumers see the same epoch."""
        s = self.sessions.setdefault(event.session_id, {'epoch': 1, 'identity': None,
            'closed': False, 'identity_pending': False, 'sequence': -1})
        if event.source_process_id == self.process_id:
            return event
        if event.sequence <= s['sequence']:
            return replace(event, source_epoch=s['epoch'], source_process_id=self.process_id)
        s['sequence'] = event.sequence
        reason = None
        if event.event_type == 'SESSION_STATE' and event.source_channel == 'timing.session.info':
            identity = event.payload.get('id')
            if identity is not None:
                if s['identity'] is not None and identity != s['identity'] and not s['identity_pending']:
                    reason = 'SOURCE_ID_CHANGED'
                s['identity'] = identity
                s['identity_pending'] = False
        elif event.event_type == 'SESSION_STATE' and event.source_channel == 'timing.session.status':
            if s['closed'] and event.payload.get('isClosed') is False and event.payload.get('isFinished') is False:
                reason = 'CLOSED_TO_OPEN'
            s['closed'] = s['closed'] or event.payload.get('isClosed') is True
        elif event.event_type == 'STANDINGS_UPDATE' and s['closed']:
            rows = event.payload.get('rows', [])
            if rows and all(row.get('lapNumber') == 0 for row in rows):
                reason = 'CLOSED_ZERO_LAP_GRID'
        if event.event_type == 'STANDINGS_UPDATE' and any((r.get('lapNumber') or 0)>0 for r in event.payload.get('rows',[])):
            s['identity_pending'] = False
        if reason:
            s['epoch'] += 1
            s['closed'] = False
            # A subsequent info frame can describe this same reset. Bind it,
            # rather than counting the status/grid and identity signals twice.
            s['identity_pending'] = reason != 'SOURCE_ID_CHANGED'
        return replace(event, source_epoch=s['epoch'], source_process_id=self.process_id,
                       source_boundary=reason)
