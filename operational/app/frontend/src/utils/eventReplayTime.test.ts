import { describe, expect, it } from 'vitest'

import { eventUtcIso, eventUtcIsoAt, eventUtcMilliseconds } from './eventReplayTime'

describe('event replay UTC timestamps', () => {
  it('interprets offset-free serving timestamps as UTC rather than browser-local time', () => {
    expect(eventUtcIso('2026-09-03T14:00:44.680000')).toBe('2026-09-03T14:00:44.680Z')
    expect(eventUtcMilliseconds('2026-09-03T14:00:44.680000')).toBe(Date.parse('2026-09-03T14:00:44.680Z'))
  })

  it('preserves an explicit UTC instant when serializing replay query parameters', () => {
    const timestamp = eventUtcMilliseconds('2026-09-03T13:59:44.680000')
    expect(timestamp).not.toBeNull()
    expect(eventUtcIsoAt(timestamp as number)).toBe('2026-09-03T13:59:44.680Z')
  })
})
