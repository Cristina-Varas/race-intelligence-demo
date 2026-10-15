import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { LiveEventState } from '../types/raceIntelligence'
import { LiveRaceWall } from './LiveRaceWall'
const mock = vi.hoisted(()=>({view:{} as any,select:vi.fn(),geometry:vi.fn()}))
vi.mock('../hooks/useLiveEventSession',()=>({useLiveEventSession:()=>({...mock.view,selectParticipant:mock.select})}))
vi.mock('../api/raceIntelligence',()=>({fetchEventTrackGeometry:mock.geometry}))
afterEach(()=>{cleanup();vi.clearAllMocks()})
it('keeps top twelve, pins selection, shares row/marker selection, and hides lifecycle diagnostics', async()=>{
  const standings = Array.from({length:15},(_,i)=>({participantId:`AKS_${i+1}`,externalParticipantNumber:String(i+1),position:i+1,lapNumber:7,gapFirstSeconds:i||null,gapPreviousSeconds:null}))
  const state = {sessionId:'S',stateVersion:10,standings,positions:{GPS_CORRECTED:[{sourceEntityId:'15',participantId:'AKS_15',externalParticipantNumber:'15',positionSource:'GPS_CORRECTED',latitude:40615000,longitude:-3585000}]},connection:{status:'LIVE',stale:false},sourceMode:'REPLAY',latestLaps:{AKS_15:{lapTimeSeconds:142.776,lapValid:true}}} as unknown as LiveEventState
  mock.view={state,selectedParticipantId:'AKS_15'}
  mock.geometry.mockResolvedValue({points:[{latitude:40.61,longitude:-3.59},{latitude:40.62,longitude:-3.58}]})
  const {container,rerender}=render(<LiveRaceWall sessionId="S" />)
  await waitFor(()=>expect(screen.getByText(/BUILDING TRACK REFERENCE/)).toBeTruthy())
  expect(container.querySelectorAll('[data-wall-standing]')).toHaveLength(13)
  expect(container.querySelector('.lcr-pinned')?.textContent).toContain('#15')
  expect(screen.getByText('2:22.776')).toBeTruthy()
  expect(container.querySelector('.lcr-diagnostics')).toBeNull()
  fireEvent.click(container.querySelector('[data-wall-standing="AKS_1"]')!)
  expect(mock.select).toHaveBeenLastCalledWith('AKS_1')
  fireEvent.click(container.querySelector('[data-live-marker="15"]')!)
  expect(mock.select).toHaveBeenLastCalledWith('AKS_15')
  state.connection.stale=true;state.connection.status='STALE';state.stateVersion++
  rerender(<LiveRaceWall sessionId="S" />)
  expect(screen.getByText('STALE DATA · LAST KNOWN POSITIONS')).toBeTruthy()
  expect(container.querySelectorAll('[data-wall-standing]')).toHaveLength(13)
  expect(mock.geometry).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button',{name:'SYSTEM HEALTH +'}))
  expect(container.querySelector('.lcr-diagnostics')?.textContent).toContain('stateVersion 11')
})
