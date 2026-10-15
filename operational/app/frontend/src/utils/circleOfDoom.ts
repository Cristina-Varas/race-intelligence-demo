import type { TrackTopology } from '../types/raceIntelligence'
export const circleAngle = (progress: number) => -90 + ((progress % 1 + 1) % 1) * 360
export function sectorForProgress(topology: TrackTopology, progress: number) { return topology.sectors.find((sector) => { const start = sector.mainRouteStartProgress; const end = sector.mainRouteEndProgress; return start <= end ? progress >= start && progress < end : progress >= start || progress < end })?.sectorId ?? 'sector_1' }
export function jokerRoute(topology: TrackTopology, routeId: 'joker_1' | 'joker_2') { return topology.alternateRoutes.find((route) => route.routeId === routeId) }
export const CIRCLE_RADIAL_LANES = [-16, -8, 8, 16] as const
export const CIRCLE_COLLISION_DEGREES = 7
export function circleDisplayLanes<T extends { progress: number; isNextTarget: boolean; driverId: string }>(drivers: T[]) { const used: number[] = []; return [...drivers].sort((a, b) => Number(b.isNextTarget) - Number(a.isNextTarget) || a.driverId.localeCompare(b.driverId)).map(driver => { const angle = circleAngle(driver.progress); const collides = used.some(other => Math.abs(((angle - other + 540) % 360) - 180) < CIRCLE_COLLISION_DEGREES); const lane = collides ? CIRCLE_RADIAL_LANES[used.length % CIRCLE_RADIAL_LANES.length] : 0; used.push(angle); return { ...driver, lane } }) }

type CircleLabelCandidate = { driverId: string; progress: number; isNextTarget: boolean; status: 'AHEAD' | 'BEHIND'; isSelected?: boolean }
const circularDistance = (left: number, right: number) => Math.abs(((left - right + 540) % 360) - 180)

/** Presentation-only label lanes. Marker angle and radial lane remain untouched. */
export function circleLabelLayout<T extends CircleLabelCandidate>(drivers: T[], vmProgress: number) {
  const priority = (driver: T) => driver.isNextTarget ? 0 : driver.isSelected ? 1 : driver.status === 'AHEAD' ? 2 : 3
  const visibleByStatus = new Set<string>()
  const occupied = [circleAngle(vmProgress)]
  return [...drivers]
    .sort((left, right) => priority(left) - priority(right) || left.driverId.localeCompare(right.driverId))
    .map((driver) => {
      const angle = circleAngle(driver.progress)
      const statusAlreadyVisible = visibleByStatus.has(driver.status)
      const shouldShow = driver.isNextTarget || Boolean(driver.isSelected) || !statusAlreadyVisible
      if (!shouldShow) return { ...driver, showLabel: false, labelRadialOffset: 0, labelTangentOffset: 0 }
      const collisions = occupied.filter((other) => circularDistance(angle, other) < CIRCLE_COLLISION_DEGREES).length
      const lane = [0, -12, 12, -22, 22][Math.min(collisions, 4)]
      occupied.push(angle)
      visibleByStatus.add(driver.status)
      return { ...driver, showLabel: true, labelRadialOffset: 14, labelTangentOffset: lane }
    })
}
