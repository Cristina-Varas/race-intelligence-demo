import { expect, it } from 'vitest'
import { LiveTrackReference } from './liveTrackReference'
import type { LiveEventPosition } from '../types/raceIntelligence'
const point=(lat:number,lon:number,extra:Partial<LiveEventPosition>={}):LiveEventPosition=>({sourceEntityId:'source-1',participantId:null,externalParticipantNumber:null,positionSource:'GPS_CORRECTED',latitude:lat*1e6,longitude:lon*1e6,rawStatusBits:0,...extra})
it('builds from source GPS without participant identity, excluding SC/noGPS/null/invalid/raw',()=>{
  const accumulator=new LiveTrackReference('A')
  const result=accumulator.observe([point(40,3),point(40,3,{sourceEntityId:'SC'}),point(40,3,{sourceEntityId:'bad',rawStatusBits:0x1000}),point(40,3,{latitude:null}),point(100,3),point(40,3,{positionSource:'RGPS_RAW'})])
  expect(result.points).toHaveLength(1)
  expect(result.sourceEntityId).toBe('source-1')
  expect(result.ready).toBe(false)
  expect(accumulator.observe([point(40,3)]).points).toHaveLength(1)
})
it('splits discontinuities and never joins unrelated entities or closes missing sections',()=>{
  const accumulator=new LiveTrackReference('A')
  accumulator.observe([point(40,3)])
  accumulator.observe([point(40.0001,3)])
  const result=accumulator.observe([point(41,4),point(42,5,{sourceEntityId:'other'})])
  expect(result.points).toEqual([{latitude:40,longitude:3},{latitude:40.0001,longitude:3}])
  expect(result.ready).toBe(false)
})
it('locks bounded factual geometry and the shared transform after useful observed coverage',()=>{
  const accumulator=new LiveTrackReference('A')
  let result=accumulator.observe([])
  const evidence=[]
  for(let i=0;i<=360;i++){
    const row=point(40+.003*Math.sin(i*Math.PI/180),3+.004*Math.cos(i*Math.PI/180))
    evidence.push({latitude:row.latitude!/1e6,longitude:row.longitude!/1e6})
    result=accumulator.observe([row])
  }
  expect(result.ready).toBe(true)
  expect(result.points.length).toBeLessThanOrEqual(400)
  for(const p of result.points)expect(evidence).toContainEqual(p)
  expect(accumulator.observe([point(40.001,3)])).toBe(result)
  expect(new LiveTrackReference('B').observe([])).toEqual({points:[],bounds:[],ready:false,sourceEntityId:null})
})
