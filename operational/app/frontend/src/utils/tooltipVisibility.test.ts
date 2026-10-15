import { describe, expect, it } from 'vitest'

import { tooltipVisible } from './tooltipVisibility'

describe('tooltipVisible', () => {
  it('is hidden initially and after desktop mouse leave or blur', () => {
    expect(tooltipVisible({ hovered: false, keyboardFocused: false, touchOpen: false })).toBe(false)
    expect(tooltipVisible({ hovered: false, keyboardFocused: false, touchOpen: false })).toBe(false)
  })

  it('shows for hover and keyboard focus independently', () => {
    expect(tooltipVisible({ hovered: true, keyboardFocused: false, touchOpen: false })).toBe(true)
    expect(tooltipVisible({ hovered: false, keyboardFocused: true, touchOpen: false })).toBe(true)
  })

  it('keeps touch visibility controlled separately and closable', () => {
    expect(tooltipVisible({ hovered: false, keyboardFocused: false, touchOpen: true })).toBe(true)
    expect(tooltipVisible({ hovered: false, keyboardFocused: false, touchOpen: false })).toBe(false)
  })
})
