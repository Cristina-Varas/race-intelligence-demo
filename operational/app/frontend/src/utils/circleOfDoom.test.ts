import { describe, expect, it } from 'vitest'

import { circleAngle, circleLabelLayout } from './circleOfDoom'

describe('circleLabelLayout', () => {
  const drivers = [
    { driverId: 'SYN_NEXT', progress: .2, isNextTarget: true, status: 'AHEAD' as const },
    { driverId: 'SYN_AHEAD', progress: .201, isNextTarget: false, status: 'AHEAD' as const },
    { driverId: 'SYN_SELECTED', progress: .202, isNextTarget: false, status: 'AHEAD' as const, isSelected: true },
    { driverId: 'SYN_BEHIND', progress: .7, isNextTarget: false, status: 'BEHIND' as const },
    { driverId: 'SYN_OTHER', progress: .71, isNextTarget: false, status: 'BEHIND' as const },
  ]

  it('keeps marker angles authoritative while prioritising next target and selected labels', () => {
    const labels = circleLabelLayout(drivers, .2)
    expect(circleAngle(.2)).toBe(circleAngle(.2))
    expect(labels.find((driver) => driver.driverId === 'SYN_NEXT')?.showLabel).toBe(true)
    expect(labels.find((driver) => driver.driverId === 'SYN_SELECTED')?.showLabel).toBe(true)
    expect(labels.find((driver) => driver.driverId === 'SYN_OTHER')?.showLabel).toBe(false)
    expect(labels.find((driver) => driver.driverId === 'SYN_NEXT')?.labelRadialOffset).toBe(14)
  })
})
