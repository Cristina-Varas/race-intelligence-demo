import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const api = vi.hoisted(() => ({
  createEventSession: vi.fn(), startEventSession: vi.fn(), completeEventSession: vi.fn(),
  createEventParticipant: vi.fn(), createEventLap: vi.fn(), createEventRaceEvent: vi.fn(), createEventMediaMarker: vi.fn(),
  fetchRecoverableEventCaptureSessions: vi.fn(),
}))
vi.mock('../api/raceIntelligence', () => api)

import { EventCaptureConsole } from './EventCaptureConsole'

const acknowledgement = (operation: string, syncStatus: 'PENDING' | 'SYNCED' = 'SYNCED') => ({ id: `${operation}-id`, sessionId: 'EVENT_01', operation, syncStatus, recordedAt: '2026-09-04T12:00:00Z', message: 'accepted' })

beforeEach(() => {
  api.createEventSession.mockResolvedValue(acknowledgement('CREATE_SESSION'))
  api.startEventSession.mockResolvedValue(acknowledgement('START_SESSION'))
  api.completeEventSession.mockResolvedValue(acknowledgement('COMPLETE_SESSION'))
  api.createEventParticipant.mockResolvedValue(acknowledgement('CREATE_PARTICIPANT'))
  api.createEventRaceEvent.mockResolvedValue(acknowledgement('CAPTURE_RACE_EVENT'))
  api.createEventMediaMarker.mockResolvedValue(acknowledgement('CAPTURE_MEDIA_MARKER', 'PENDING'))
  api.createEventLap.mockResolvedValue(acknowledgement('CAPTURE_LAP'))
  api.fetchRecoverableEventCaptureSessions.mockResolvedValue([])
})
afterEach(() => { cleanup(); vi.clearAllMocks() })

async function createAndStart() {
  fireEvent.change(screen.getByLabelText('EVENT ID*'), { target: { value: 'EVENT_01' } })
  fireEvent.click(screen.getByRole('button', { name: /create capture session/i }))
  await screen.findByText('CREATED')
  fireEvent.click(screen.getByRole('button', { name: /start recording/i }))
  await screen.findByText('RECORDING')
}
async function register(id: string, name = id) {
  fireEvent.change(screen.getByLabelText('PARTICIPANT ID*'), { target: { value: id } })
  fireEvent.change(screen.getByLabelText('DISPLAY NAME'), { target: { value: name } })
  fireEvent.click(screen.getByRole('button', { name: /register participant/i }))
  await waitFor(() => expect(api.createEventParticipant).toHaveBeenCalled())
}

describe('EventCaptureConsole', () => {
  it('renders a session lifecycle and blocks evidence until recording starts', async () => {
    render(<EventCaptureConsole />)
    expect(screen.getByRole('heading', { name: /create an event capture session/i })).toBeTruthy()
    await createAndStart()
    expect(api.startEventSession).toHaveBeenCalledWith('EVENT_01')
    expect(screen.getByText(/operator submitted via race operations api/i)).toBeTruthy()
  })

  it('registers participants and captures a physical pass only between different participants', async () => {
    render(<EventCaptureConsole />); await createAndStart(); await register('KART_01', 'One'); await register('KART_02', 'Two')
    const selects = screen.getAllByLabelText(/participant\*/i)
    fireEvent.change(selects[0], { target: { value: 'KART_01' } }); fireEvent.change(selects[1], { target: { value: 'KART_01' } })
    expect(screen.getByRole('alert').textContent).toMatch(/must be different/i)
    expect((screen.getByRole('button', { name: /capture physical pass/i }) as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(selects[1], { target: { value: 'KART_02' } }); fireEvent.click(screen.getByRole('button', { name: /capture physical pass/i }))
    await waitFor(() => expect(api.createEventRaceEvent).toHaveBeenCalledWith('EVENT_01', expect.objectContaining({ eventType: 'PASS', participantId: 'KART_01', targetParticipantId: 'KART_02' })))
  })

  it('shows PENDING acknowledgement for a media marker and does not invent race time', async () => {
    render(<EventCaptureConsole />); await createAndStart()
    fireEvent.submit(document.getElementById('capture-media')!)
    await waitFor(() => expect(api.createEventMediaMarker).toHaveBeenCalled())
    expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0)
    const [, payload] = api.createEventMediaMarker.mock.calls[0]
    expect(payload).toMatchObject({ markerType: 'GENERAL', title: 'Marked moment' })
    expect(payload).not.toHaveProperty('raceTimeSeconds')
    expect(payload).not.toHaveProperty('lapNumber')
  })

  it('keeps optional manual lap fields absent and reports API errors without false success', async () => {
    api.createEventLap.mockRejectedValueOnce(new Error('Backend unavailable'))
    render(<EventCaptureConsole />); await createAndStart(); await register('KART_01')
    fireEvent.change(screen.getByLabelText('PARTICIPANT*'), { target: { value: 'KART_01' } }); fireEvent.change(screen.getByLabelText('LAP NUMBER*'), { target: { value: '2' } }); fireEvent.click(screen.getByRole('button', { name: /capture manual lap/i }))
    expect((await screen.findByRole('alert')).textContent).toMatch(/backend unavailable/i)
    expect(screen.queryByText('CAPTURE_LAP')).toBeNull()
  })

  it('requires completion confirmation and then makes factual capture read-only', async () => {
    render(<EventCaptureConsole />); await createAndStart()
    fireEvent.click(screen.getByRole('button', { name: /complete session/i }))
    expect(screen.getByText(/complete session\?/i)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /confirm complete/i }))
    await screen.findByText(/capture locked/i)
    expect((screen.getByRole('button', { name: /capture incident/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('recovers a journal-backed recording session and participant registry after reload', async () => {
    api.fetchRecoverableEventCaptureSessions.mockResolvedValueOnce([{
      sessionId: 'RECOVER_01', eventId: 'EVENT_01', sessionType: 'RACE', sessionName: 'Resume race', status: 'RECORDING',
      source: 'RACE_OPERATIONS_API', operator: 'Operator 1', createdAt: '2026-09-04T12:00:00Z', startedAt: '2026-09-04T12:02:00Z', endedAt: null,
      participants: [{ participantId: 'MAX', displayName: 'Virtual Max', kartId: 'K1', participantType: 'MAX', specialRole: null, source: 'RACE_OPERATIONS_API' }],
      recentCaptures: [{ id: 'pass-1', operation: 'CAPTURE_RACE_EVENT', entityKind: 'race_event', syncStatus: 'PENDING', recordedAt: '2026-09-04T12:03:00Z', participantId: 'MAX', targetParticipantId: null, lapNumber: 3, eventType: 'PASS', title: null }],
    }])
    render(<EventCaptureConsole />)
    expect(await screen.findByText(/resume accepted capture/i)).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Recoverable capture session'), { target: { value: 'RECOVER_01' } })
    fireEvent.click(screen.getByRole('button', { name: /resume session/i }))
    expect(await screen.findByText('RECORDING')).toBeTruthy()
    expect(screen.getAllByRole('option', { name: /virtual max/i }).length).toBeGreaterThan(0)
    expect(screen.getAllByText('PENDING').length).toBeGreaterThan(0)
  })

  it('views a recovered completed session but keeps factual capture locked', async () => {
    api.fetchRecoverableEventCaptureSessions.mockResolvedValueOnce([{
      sessionId: 'RECOVER_DONE', eventId: 'EVENT_01', sessionType: 'RACE', sessionName: 'Completed race', status: 'COMPLETED',
      source: 'RACE_OPERATIONS_API', operator: 'Operator 1', createdAt: '2026-09-04T12:00:00Z', startedAt: '2026-09-04T12:02:00Z', endedAt: '2026-09-04T12:30:00Z',
      participants: [], recentCaptures: [],
    }])
    render(<EventCaptureConsole />)
    await screen.findByText(/resume accepted capture/i)
    fireEvent.change(screen.getByLabelText('Recoverable capture session'), { target: { value: 'RECOVER_DONE' } })
    fireEvent.click(screen.getByRole('button', { name: /view completed session/i }))
    expect(await screen.findByText(/capture locked/i)).toBeTruthy()
    expect((screen.getByRole('button', { name: /capture incident/i }) as HTMLButtonElement).disabled).toBe(true)
  })

  it('shows recovery API failure without claiming an active session', async () => {
    api.fetchRecoverableEventCaptureSessions.mockRejectedValueOnce(new Error('Journal recovery unreachable'))
    render(<EventCaptureConsole />)
    expect((await screen.findByRole('alert')).textContent).toMatch(/journal recovery unreachable/i)
    expect(screen.queryByText('ACTIVE CAPTURE SESSION')).toBeNull()
  })
})
