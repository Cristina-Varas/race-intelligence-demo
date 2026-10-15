import { useEffect, useState } from 'react'
import { fetchLiveSource } from '../api/raceIntelligence'
import type { CustomSimulationResult } from '../types/raceIntelligence'
import { BaseballCardData } from './BaseballCardData'

export function EventBaseballSource({modelledScenario}:{modelledScenario?:CustomSimulationResult|null}) {
  const [source,setSource]=useState<Awaited<ReturnType<typeof fetchLiveSource>>|null>(null)
  const [choice,setChoice]=useState<'live'|'replay'>('live')
  const [failed,setFailed]=useState(false)
  useEffect(()=>{let active=true;fetchLiveSource().then(s=>{if(active)setSource(s)}).catch(()=>{if(active)setFailed(true)});return()=>{active=false}},[])
  return <><label>EVENT SOURCE <select aria-label="Event card source" value={choice} onChange={e=>setChoice(e.target.value as 'live'|'replay')}><option value="live">Current hot path · {source?.mode ?? 'connecting'}</option><option value="replay">Approved recording · 11 September 2026</option></select></label>
    {choice==='replay' ? <BaseballCardData key="recording" sessionId="REHEARSAL_LIVE_CHECK" eventSource="replay" modelledScenario={modelledScenario}/> : source ? <BaseballCardData key={source.sessionId} sessionId={source.sessionId} eventSource="live" modelledScenario={modelledScenario}/> : <p role="status">{failed?'Current source unavailable. No recording was substituted.':'Connecting to the current Event Operations source…'}</p>}
  </>
}
