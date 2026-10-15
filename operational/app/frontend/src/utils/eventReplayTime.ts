/**
 * Event-serving timestamps are UTC recorder evidence. Oracle TIMESTAMP values
 * reach the browser without an offset, so a missing offset means UTC here —
 * never the browser's local time zone.
 */
export function eventUtcMilliseconds(value: string | null | undefined): number | null {
  if (!value) return null
  const normalized = /(?:Z|[+-]\d{2}:\d{2})$/i.test(value) ? value : `${value}Z`
  const milliseconds = Date.parse(normalized)
  return Number.isFinite(milliseconds) ? milliseconds : null
}

export function eventUtcIso(value: string | null | undefined): string | null {
  const milliseconds = eventUtcMilliseconds(value)
  return milliseconds === null ? null : new Date(milliseconds).toISOString()
}

export function eventUtcIsoAt(milliseconds: number): string {
  return new Date(milliseconds).toISOString()
}
