import { afterEach, describe, expect, it, vi } from 'vitest'

import { createEventMediaMarker, createEventRaceEvent, createEventSession, fetchEventParticipants, fetchEventSessions, fetchEventStoryline, fetchTrackTopology, runSimulation } from './raceIntelligence'

afterEach(() => vi.unstubAllGlobals())

describe('runSimulation', () => {
  it('posts the explicit custom scenario payload and returns no fallback result', async () => {
    const response = { mode: 'custom', scenarioType: 'SYNTHETIC WHAT-IF' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => response })
    vi.stubGlobal('fetch', fetchMock)
    const payload = { raceLaps: 40, virtualMaxAdvantageSecondsPerLap: 0.3, startingDelaySeconds: -1.1, simulations: 5000, fieldMode: 'historical' as const }
    await expect(runSimulation(payload)).resolves.toEqual(response)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/simulation/run'), expect.objectContaining({
      method: 'POST', body: JSON.stringify(payload), headers: { 'Content-Type': 'application/json' },
    }))
  })
})

describe('fetchTrackTopology', () => {
  it('uses the authoritative topology endpoint rather than the legacy track endpoint', async () => {
    const topology = { mainRoute: { lengthMeters: 2448.0699568362184 } }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => topology })
    vi.stubGlobal('fetch', fetchMock)
    await expect(fetchTrackTopology()).resolves.toEqual(topology)
    expect(fetchMock).toHaveBeenCalledWith(expect.stringContaining('/api/track/topology'), expect.anything())
    expect(fetchMock.mock.calls[0][0]).not.toMatch(/\/api\/track$/)
  })
})

describe('Actual Event serving requests', () => {
  it('uses read-only Event API paths and encodes the session identifier', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => [] })
    vi.stubGlobal('fetch', fetchMock)

    await Promise.all([
      fetchEventSessions(),
      fetchEventParticipants('MAX VS/100'),
      fetchEventStoryline('MAX VS/100'),
    ])

    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/api/event/sessions'),
      expect.stringContaining('/api/event/sessions/MAX%20VS%2F100/participants'),
      expect.stringContaining('/api/event/sessions/MAX%20VS%2F100/storyline'),
    ])
    expect(fetchMock.mock.calls.every(([, options]) => !options?.method && !options?.body)).toBe(true)
  })
})

describe('Actual Event capture requests', () => {
  it('posts only to the existing Event Capture API boundary', async () => {
    const acknowledgement = { id: 'ack-1', sessionId: 'SESSION_1', operation: 'CAPTURE_RACE_EVENT', syncStatus: 'PENDING' }
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => acknowledgement })
    vi.stubGlobal('fetch', fetchMock)
    await createEventSession({ eventId: 'EVENT_1', sessionType: 'RACE', idempotencyKey: 'create-1' })
    await createEventRaceEvent('SESSION_1', { eventType: 'PASS', participantId: 'A', targetParticipantId: 'B', idempotencyKey: 'pass-1' })
    await createEventMediaMarker('SESSION_1', { title: 'Moment', markerType: 'GENERAL', priority: 'MEDIUM', idempotencyKey: 'marker-1' })
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      expect.stringContaining('/api/event/sessions'),
      expect.stringContaining('/api/event/sessions/SESSION_1/events'),
      expect.stringContaining('/api/event/sessions/SESSION_1/media-markers'),
    ])
    expect(fetchMock.mock.calls.every(([, options]) => options?.method === 'POST' && options.headers?.['Content-Type'] === 'application/json')).toBe(true)
  })
})
