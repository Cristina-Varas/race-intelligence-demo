import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const api = vi.hoisted(() => ({fetchLiveSource:vi.fn(),fetchLiveMoments:vi.fn(),captureLiveMoment:vi.fn(),liveMomentsExportUrl:vi.fn()}))
vi.mock('../api/raceIntelligence',()=>api)
const live=vi.hoisted(()=>({state:null as null|{sourceEpoch:number}}))
vi.mock('../hooks/useLiveEventSession',()=>({useLiveEventSession:()=>live}))
import { LiveEventMoments } from './LiveEventMoments'
const frozen={moment_id:'M1',moment_type:'POSITION_CHANGE',observed_at:'2026-09-13T12:00:00Z',captured_at:'2026-09-13T12:00:01Z',primary_kart_number:21,latest_observed_position:2,peak_observed_position:1,observed_lap:12,gap_to_leader:.421,interval:.2,best_valid_lap:93.301,observed_leader_kart:40,capture_origin:'AUTOMATIC',operator_note:null}
const payload={moments:[frozen],candidates:[{candidateId:'C1',momentType:'POSITION_CHANGE',snapshot:frozen}],participants:[{participantId:'AKS_21',kartNumber:21},{participantId:'AKS_40',kartNumber:40}],metadata:{source_mode:'LIVE'}}
beforeEach(()=>{vi.clearAllMocks();api.fetchLiveSource.mockResolvedValue({sessionId:'S',mode:'LIVE'});api.fetchLiveMoments.mockResolvedValue(payload);api.captureLiveMoment.mockResolvedValue(frozen);api.liveMomentsExportUrl.mockImplementation((s,f)=>`/${s}/export.${f}`)})
afterEach(()=>{cleanup();live.state=null})
it('shows candidates/captured snapshots, promotes and offers identity-free exports',async()=>{
 const {container}=render(<LiveEventMoments/>);await screen.findByText('CAPTURED MOMENTS · 1')
 fireEvent.click(screen.getByRole('button',{name:/^CAPTURE$/}))
 await waitFor(()=>expect(api.captureLiveMoment).toHaveBeenCalledWith('S',{candidateId:'C1'}))
 expect(await screen.findByText('FROZEN EVENT SNAPSHOT')).toBeTruthy()
 expect(screen.getByRole('link',{name:'Export LIVE XLSX'}).getAttribute('href')).toBe('/S/export.xlsx')
 expect(screen.getByRole('link',{name:'Export LIVE CSV'}).getAttribute('href')).toBe('/S/export.csv')
 expect(container.querySelectorAll('img')).toHaveLength(0)
})
it('operator PASS requires two factual karts and remains explicitly asserted',async()=>{
 render(<LiveEventMoments/>);await screen.findByText('CAPTURED MOMENTS · 1')
 fireEvent.change(screen.getByLabelText('Capture type'),{target:{value:'PASS_CONFIRMED'}})
 expect((screen.getByRole('button',{name:'CAPTURE CURRENT MOMENT'}) as HTMLButtonElement).disabled).toBe(true)
 fireEvent.change(screen.getByLabelText('Primary kart'),{target:{value:'AKS_21'}})
 fireEvent.change(screen.getByLabelText('Second kart'),{target:{value:'AKS_40'}})
 const operator={...frozen,moment_id:'M2',moment_type:'PASS_CONFIRMED',capture_origin:'OPERATOR'}
 api.captureLiveMoment.mockResolvedValue(operator);api.fetchLiveMoments.mockResolvedValue({...payload,moments:[frozen,operator]})
 fireEvent.click(screen.getByRole('button',{name:'CAPTURE CURRENT MOMENT'}))
 await waitFor(()=>expect(api.captureLiveMoment).toHaveBeenCalledWith('S',expect.objectContaining({momentType:'PASS_CONFIRMED',primaryParticipantId:'AKS_21',secondaryParticipantId:'AKS_40'})))
 await screen.findAllByText('PASS CONFIRMED')
 expect(screen.getAllByText(/OPERATOR · FACTUAL ASSERTION/).length).toBeGreaterThan(0)
})
it('preserves selected frozen detail while live candidates change',async()=>{
 render(<LiveEventMoments/>);await screen.findByText('CAPTURED MOMENTS · 1')
 fireEvent.click(screen.getByRole('button',{name:'Frozen detail'}));const detail=screen.getByRole('article',{name:'Frozen event snapshot'})
 const before=detail.textContent
 api.fetchLiveMoments.mockResolvedValue({...payload,candidates:[{candidateId:'C2',momentType:'GAP_CHANGE',snapshot:{...frozen,latest_observed_position:7,observed_lap:18,gap_to_leader:8.2}}]})
 await waitFor(()=>expect(screen.getByText('GAP_CHANGE')).toBeTruthy(),{timeout:3500})
 expect(detail.textContent).toBe(before)
})
it('invalidates stale candidate UI on source epoch change but retains frozen moments',async()=>{
 api.fetchLiveMoments.mockResolvedValue({...payload,metadata:{source_mode:'LIVE',sourceEpoch:1,sourceState:'READY'}})
 const view=render(<LiveEventMoments/>);await screen.findByText('CAPTURED MOMENTS · 1')
 fireEvent.click(screen.getByRole('button',{name:'Frozen detail'}))
 const before=screen.getByRole('article',{name:'Frozen event snapshot'}).textContent
 live.state={sourceEpoch:2};view.rerender(<LiveEventMoments/>)
 expect(screen.getByText('REBUILDING LIVE EVENT EVIDENCE')).toBeTruthy()
 expect(screen.queryByRole('button',{name:/^CAPTURE$/})).toBeNull()
 expect((screen.getByRole('button',{name:'CAPTURE CURRENT MOMENT'}) as HTMLButtonElement).disabled).toBe(true)
 expect(screen.getByRole('article',{name:'Frozen event snapshot'}).textContent).toBe(before)
})
