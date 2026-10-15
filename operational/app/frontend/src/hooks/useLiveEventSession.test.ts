import { afterEach, expect, it, vi } from 'vitest'
import { LiveSessionStore } from './useLiveEventSession'

class Socket {
  static all: Socket[] = []
  onmessage: ((value: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onopen: (() => void) | null = null
  close = vi.fn()
  constructor() { Socket.all.push(this) }
  send(type: string, version: number, status = 'LIVE') {
    this.onmessage?.({ data: JSON.stringify({ type, payload: { sessionId: 'S', stateVersion: version,
      connection: { status }, standings: [{ participantId: 'AKS_1', position: version }],
      positions: { GPS_CORRECTED: [{ sourceEntityId: '1', latitude: version }] } } }) })
  }
}
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); Socket.all = [] })
it('does not reopen on navigation/unmount or after a pending reconnect is cancelled', () => {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket)
  const store = new LiveSessionStore('S'), off = store.subscribe(vi.fn())
  const first = Socket.all[0]
  off(); first.onclose?.(); vi.advanceTimersByTime(10000)
  expect(Socket.all).toHaveLength(1)
  const offAgain = store.subscribe(vi.fn())
  Socket.all[1].onclose?.(); offAgain(); vi.advanceTimersByTime(10000)
  expect(Socket.all).toHaveLength(2)
})
it('shares one socket, applies state not just timestamps, preserves selection and rejects old revisions', () => {
  vi.stubGlobal('WebSocket', Socket)
  const store = new LiveSessionStore('S')
  const offA = store.subscribe(vi.fn()), offB = store.subscribe(vi.fn())
  expect(Socket.all).toHaveLength(1)
  const socket = Socket.all[0]
  socket.send('SNAPSHOT', 1); store.select('AKS_1'); socket.send('STATE_UPDATE', 2)
  expect(store.snapshot().state?.standings[0].position).toBe(2)
  expect(store.snapshot().state?.positions.GPS_CORRECTED[0].latitude).toBe(2)
  expect(store.snapshot().selectedParticipantId).toBe('AKS_1')
  socket.send('STATE_UPDATE', 1)
  expect(store.snapshot().state?.stateVersion).toBe(2)
  socket.send('HEARTBEAT', 2, 'STALE')
  expect(store.snapshot().state?.connection.status).toBe('STALE')
  offA(); expect(socket.close).not.toHaveBeenCalled(); offB(); expect(socket.close).toHaveBeenCalledOnce()
})
it('reconnects with a fresh authoritative snapshot and preserves selection across a version reset', () => {
  vi.useFakeTimers(); vi.stubGlobal('WebSocket', Socket)
  const store = new LiveSessionStore('S'), off = store.subscribe(vi.fn())
  Socket.all[0].send('SNAPSHOT', 20); store.select('AKS_1'); Socket.all[0].onclose?.()
  expect(store.snapshot().state?.connection.status).toBe('RECONNECTING')
  vi.advanceTimersByTime(500)
  expect(Socket.all).toHaveLength(2)
  Socket.all[1].send('SNAPSHOT', 1)
  expect(store.snapshot().state?.stateVersion).toBe(1)
  expect(store.snapshot().selectedParticipantId).toBe('AKS_1')
  off()
})
it('accepts the first source update after an empty initial snapshot', () => {
  vi.stubGlobal('WebSocket', Socket)
  const store = new LiveSessionStore('S'), off = store.subscribe(vi.fn())
  Socket.all[0].onmessage?.({ data: JSON.stringify({ type: 'SNAPSHOT', payload: null }) })
  Socket.all[0].send('STATE_UPDATE', 1)
  expect(store.snapshot().state?.stateVersion).toBe(1)
  off()
})
