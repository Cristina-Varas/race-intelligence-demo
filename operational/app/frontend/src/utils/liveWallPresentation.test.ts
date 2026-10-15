import { expect, it } from 'vitest'
import { wallGap, wallLapTime, wallMoments, wallPositions, wallProjection, compatibleReference } from './liveWallPresentation'
it('formats leader, signed zero, missing gaps and human lap time without changing values', () => {
  expect(wallGap({position:1,gapFirstSeconds:null})).toBe('LEADER')
  expect(wallGap({position:2,gapFirstSeconds:0})).toBe('+0.000 s')
  expect(wallGap({position:2,gapFirstSeconds:.332})).toBe('+0.332 s')
  expect(wallGap()).toBe('—')
  expect(wallLapTime(142.776)).toBe('2:22.776')
  expect(wallLapTime(null)).toBe('—')
})
it('converts native microdegrees without changing source rows and shares route/marker projection', () => {
  const row = {sourceEntityId:'SC',participantId:null,externalParticipantNumber:null,latitude:40615000,longitude:-3585000} as Parameters<typeof wallPositions>[0][number]
  const converted = wallPositions([row])
  expect(converted[0].latitude).toBe(40.615)
  expect(row.latitude).toBe(40615000)
  expect(converted[0].participantId).toBeNull()
  const reference = [{latitude:40.611,longitude:-3.59},{latitude:40.62,longitude:-3.58}]
  expect(compatibleReference(reference,converted)).toBe(true)
  expect(compatibleReference(reference,[{latitude:50,longitude:2}])).toBe(false)
  const project = wallProjection([...reference,...converted])
  expect(project(converted[0])).toEqual(project({latitude:40.615,longitude:-3.585}))
  expect(project(converted[0]).x).toBeGreaterThan(0)
  expect(project(converted[0]).x).toBeLessThan(760)
})
it('prioritizes significant factual moments without mutating or inferring source candidates', () => {
  const base = {participantId:'AKS_1',previous:2,current:1,observedAt:'2026-09-11T12:00:00Z'}
  const candidates = [{...base,momentType:'GAP_CHANGE',previous:1,current:1.1},{...base,momentType:'POSITION_CHANGE'},{...base,momentType:'LEADER_CHANGE'},{...base,momentType:'PASS'}]
  expect(wallMoments(candidates).map(m=>m.momentType)).toEqual(['LEADER_CHANGE','POSITION_CHANGE'])
  expect(candidates).toHaveLength(4)
  expect(wallMoments(Array.from({length:10},()=>({...base,momentType:'POSITION_CHANGE'})))).toHaveLength(4)
})
