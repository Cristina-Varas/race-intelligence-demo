"""Local factual hot-path moments. Existing ADB/legacy moment API is unchanged."""
from typing import Optional
from fastapi import APIRouter, Request, Response, HTTPException
from pydantic import BaseModel, ConfigDict, Field
from ..services.event_moment_export import frozen_moments_export
from ..services.event_moments import SourceEvidenceConflict

router=APIRouter(prefix='/api/event/sessions/{session_id}/live-moments',tags=['event'])

class CaptureMoment(BaseModel):
    model_config=ConfigDict(extra='forbid')
    momentType: str = 'KEY_MOMENT'
    primaryParticipantId: Optional[str] = None
    secondaryParticipantId: Optional[str] = None
    candidateId: Optional[str] = None
    note: Optional[str] = Field(default=None,max_length=300)

@router.get('')
def moments(session_id:str,request:Request):
    return request.app.state.captured_live_moments.snapshot(session_id)

@router.post('',status_code=201)
def capture(session_id:str,payload:CaptureMoment,request:Request):
    if request.app.state.live_source.stopping: raise HTTPException(503,'Live source is stopping')
    try:
        return request.app.state.captured_live_moments.capture(session_id,payload.momentType,payload.primaryParticipantId,payload.secondaryParticipantId,payload.note,payload.candidateId)
    except SourceEvidenceConflict as exc: raise HTTPException(409,str(exc)) from None
    except FileNotFoundError as exc: raise HTTPException(404,str(exc)) from None
    except ValueError as exc: raise HTTPException(422,str(exc)) from None

@router.get('/export.{format}')
def export(session_id:str,format:str,request:Request):
    if format not in {'xlsx','csv'}: raise HTTPException(422,'Use XLSX or CSV')
    snapshot=request.app.state.captured_live_moments.snapshot(session_id)
    content=frozen_moments_export(snapshot,format)
    return Response(content,media_type='text/csv' if format=='csv' else 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',headers={'Content-Disposition':f'attachment; filename="event_moments.{format}"'})
