import type { EventTrackGeometryPoint, LiveEventPosition, LiveEventStanding, LiveEventState } from '../types/raceIntelligence'

export const LIVE_WALL_GAP_THRESHOLD_SECONDS = 0.5 // Display filtering only; source candidates are untouched.
export function wallGap(row?: Pick<LiveEventStanding, 'position' | 'gapFirstSeconds'>) {
  if (row?.position === 1) return 'LEADER'
  const value = row?.gapFirstSeconds
  return value == null || !Number.isFinite(value) ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(3)} s`
}
export function wallSeconds(value: number | null | undefined) { return value == null || !Number.isFinite(value) ? '—' : `${value.toFixed(3)} s` }
export function wallLapTime(value: number | null | undefined) {
  if (value == null || !Number.isFinite(value) || value <= 0) return '—'
  const millis = Math.round(value * 1000)
  return `${Math.floor(millis / 60000)}:${((millis % 60000) / 1000).toFixed(3).padStart(6, '0')}`
}
export function wallClock(value?: string | null) {
  if (!value || !Number.isFinite(Date.parse(value))) return '—'
  return new Date(value).toISOString().slice(11, 19)
}
export function wallPositions(rows: LiveEventPosition[]) {
  // Same AKS microdegree conversion as integrations/aks/replay_bundle.py.
  // Only this view is converted. Original state/normalized events remain untouched.
  return rows.flatMap(row => {
    if (row.latitude == null || row.longitude == null) return []
    const latitude = row.latitude / 1_000_000, longitude = row.longitude / 1_000_000
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return []
    return [{ ...row, latitude, longitude }]
  })
}
export function wallProjection(points: EventTrackGeometryPoint[]) {
  const valid = points.filter(p => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
  const minLat = Math.min(...valid.map(p => p.latitude)), maxLat = Math.max(...valid.map(p => p.latitude))
  const minLon = Math.min(...valid.map(p => p.longitude)), maxLon = Math.max(...valid.map(p => p.longitude))
  const lat = valid.length ? (minLat + maxLat) / 2 : 0, lon = valid.length ? (minLon + maxLon) / 2 : 0
  const cosine = Math.cos(lat * Math.PI / 180)
  const scale = valid.length ? Math.min(660 / Math.max(.00001, (maxLon - minLon) * cosine), 520 / Math.max(.00001, maxLat - minLat)) : 1
  return (point: EventTrackGeometryPoint) => ({ x: 380 + (point.longitude - lon) * cosine * scale, y: 310 - (point.latitude - lat) * scale })
}
export function compatibleReference(reference: EventTrackGeometryPoint[], positions: EventTrackGeometryPoint[]) {
  if (reference.length < 2) return false
  if (!positions.length) return true
  const lat = reference.map(p => p.latitude), lon = reference.map(p => p.longitude)
  // Guard against using a different venue. This does not snap/project onto the route.
  return positions.every(p => p.latitude >= Math.min(...lat) - .002 && p.latitude <= Math.max(...lat) + .002 && p.longitude >= Math.min(...lon) - .002 && p.longitude <= Math.max(...lon) + .002)
}
export function wallMoments(candidates: NonNullable<LiveEventState['eventMomentCandidates']>, threshold = LIVE_WALL_GAP_THRESHOLD_SECONDS) {
  const priority: Record<string, number> = { LEADER_CHANGE: 0, POSITION_CHANGE: 1, GAP_CHANGE: 2 }
  const latest = Math.max(...candidates.map(m => Date.parse(m.observedAt)).filter(Number.isFinite), 0)
  return candidates.filter(m => m.momentType in priority && latest - Date.parse(m.observedAt) <= 60000 && (m.momentType !== 'GAP_CHANGE' || Math.abs(m.current - m.previous) >= threshold))
    .map((m, index) => ({ ...m, index })).sort((a,b) => priority[a.momentType] - priority[b.momentType] || Date.parse(b.observedAt) - Date.parse(a.observedAt) || b.index - a.index).slice(0, 4)
}
