import type { EventTrackGeometryPoint, LiveEventPosition } from '../types/raceIntelligence'
import { wallPositions } from './liveWallPresentation'

type Point = EventTrackGeometryPoint
export type TrackReference = { points: Point[]; bounds: Point[]; ready: boolean; sourceEntityId: string | null }
// Same haversine / 85 m discontinuity rule as the existing replay track-geometry
// endpoint. Display geometry only: no snapping, spline, inferred lap or closure.
export function observedDistance(a: Point, b: Point) {
  const r = Math.PI / 180
  const h = Math.sin((b.latitude-a.latitude)*r/2)**2 + Math.cos(a.latitude*r)*Math.cos(b.latitude*r)*Math.sin((b.longitude-a.longitude)*r/2)**2
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0,1-h)))
}
const sample = (points: Point[]) => points.length <= 400 ? points.slice() : Array.from({length:400},(_,i)=>points[Math.floor(i*(points.length-1)/399)])
export class LiveTrackReference {
  private tracks = new Map<string, { points: Point[]; distance: number }>()
  private best: Point[] = []
  private source: string | null = null
  private frozen: TrackReference | null = null
  private bounds: Point[] = []
  constructor(readonly sessionId: string) {}
  observe(rows: LiveEventPosition[]): TrackReference {
    if (this.frozen) return this.frozen
    // Source transport ID groups trajectories; participant identity is never used.
    const valid = wallPositions(rows.filter(p=>p.positionSource === 'GPS_CORRECTED' && p.sourceEntityId !== 'SC' && !((p.rawStatusBits ?? 0) & 0x1000)))
    for (const p of valid) {
      if (!this.tracks.has(p.sourceEntityId) && this.tracks.size >= 128) continue
      let track = this.tracks.get(p.sourceEntityId) ?? {points:[],distance:0}
      const last = track.points[track.points.length-1]
      const distance = last ? observedDistance(last,p) : 0
      if (last && distance < .1) continue // Repeated latest state/heartbeat is not new geometry.
      if (distance > 85) track = {points:[],distance:0}
      const point = {latitude:p.latitude,longitude:p.longitude}
      track.points.push(point)
      track.distance += distance <=85 ? distance : 0
      if (track.points.length > 2400) { track.points.shift(); track.distance = 0 }
      this.tracks.set(p.sourceEntityId,track)
      if (track.points.length > this.best.length) { this.best=track.points.slice(); this.source=p.sourceEntityId }
      // Useful coverage means an observed return near the start after substantial
      // travel, NOT a race lap claim. Never draw an artificial closing segment.
      if (track.points.length >= 120 && track.distance >= 1000 && observedDistance(track.points[0],point) <= 35) {
        const points = sample(track.points)
        this.frozen={points,bounds:this.extent([...track.points,...valid]),ready:true,sourceEntityId:p.sourceEntityId}
        this.tracks.clear(); this.best=[]
        return this.frozen
      }
    }
    const extent = this.extent([...this.best,...valid])
    // Bootstrap expands only when evidence leaves the current padded extent;
    // no per-frame recenter/zoom. Once ready, bounds and reference are immutable.
    if (extent.length && (!this.bounds.length || extent.some(p=>p.latitude<this.bounds[0].latitude || p.latitude>this.bounds[1].latitude || p.longitude<this.bounds[0].longitude || p.longitude>this.bounds[1].longitude))) {
      const all = this.extent([...extent,...this.bounds])
      const latPad=Math.max(.0003,(all[1].latitude-all[0].latitude)*.1),lonPad=Math.max(.0003,(all[1].longitude-all[0].longitude)*.1)
      this.bounds=[{latitude:all[0].latitude-latPad,longitude:all[0].longitude-lonPad},{latitude:all[1].latitude+latPad,longitude:all[1].longitude+lonPad}]
    }
    return {points:sample(this.best),bounds:this.bounds,ready:false,sourceEntityId:this.source}
  }
  private extent(points: Point[]): Point[] {
    if (!points.length) return []
    return [{latitude:Math.min(...points.map(p=>p.latitude)),longitude:Math.min(...points.map(p=>p.longitude))},{latitude:Math.max(...points.map(p=>p.latitude)),longitude:Math.max(...points.map(p=>p.longitude))}]
  }
}
