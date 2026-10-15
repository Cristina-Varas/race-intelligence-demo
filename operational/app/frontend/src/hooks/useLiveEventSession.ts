import { useCallback, useSyncExternalStore } from 'react'
import { liveEventWebSocketUrl } from '../api/raceIntelligence'
import type { LiveEventState } from '../types/raceIntelligence'

type View = { state: LiveEventState | null; error: string | null; selectedParticipantId: string | null }
const empty: View = { state: null, error: null, selectedParticipantId: null }
/** One socket per active session, shared by all operational consumers. */
export class LiveSessionStore {
  private value: View = empty
  private listeners = new Set<() => void>()
  private socket: WebSocket | null = null
  private timer: ReturnType<typeof setTimeout> | undefined
  private retries = 0
  constructor(private sessionId: string) {}
  snapshot = () => this.value
  private update(value: View) { this.value = value; this.listeners.forEach(listener => listener()) }
  select = (id: string) => this.update({ ...this.value, selectedParticipantId: id })
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) this.connect()
    return () => {
      this.listeners.delete(listener)
      if (!this.listeners.size) {
        clearTimeout(this.timer)
        const socket = this.socket; this.socket = null; socket?.close()
      }
    }
  }
  private connect() {
    const socket = new WebSocket(liveEventWebSocketUrl(this.sessionId))
    this.socket = socket
    let awaitingSnapshot = true
    socket.onopen = () => { this.retries = 0 }
    socket.onmessage = ({ data }) => {
      if (this.socket !== socket) return
      try {
        const message = JSON.parse(data) as { type: string; payload: LiveEventState | null }
        const state = message.payload
        if (message.type === 'SNAPSHOT' && state === null) {
          awaitingSnapshot = false
          this.update({ ...this.value, state: null, error: null })
          return
        }
        if (!state || state.sessionId !== this.sessionId) return
        if (!['SNAPSHOT', 'STATE_UPDATE', 'HEARTBEAT'].includes(message.type)) return
        if (!awaitingSnapshot && state.stateVersion < (this.value.state?.stateVersion ?? 0)) return
        if (awaitingSnapshot && message.type !== 'SNAPSHOT') return
        awaitingSnapshot = false
        this.update({ ...this.value, state, error: null })
      } catch { this.update({ ...this.value, error: 'Invalid live state message.' }) }
    }
    socket.onclose = () => {
      if (this.socket !== socket || !this.listeners.size) return
      this.update({ ...this.value, error: 'RECONNECTING', state: this.value.state ? {
        ...this.value.state, connection: { ...this.value.state.connection, status: 'RECONNECTING' },
      } : null })
      this.timer = setTimeout(() => this.connect(), Math.min(5000, 500 * 2 ** this.retries++))
    }
  }
}
const stores = new Map<string, LiveSessionStore>()
const noSubscribe = () => () => {}
export function useLiveEventSession(sessionId: string | null, enabled: boolean) {
  if (sessionId && !stores.has(sessionId)) stores.set(sessionId, new LiveSessionStore(sessionId))
  const store = sessionId && enabled ? stores.get(sessionId)! : null
  const view = useSyncExternalStore(store?.subscribe ?? noSubscribe, store?.snapshot ?? (() => empty))
  const selectParticipant = useCallback((id: string) => store?.select(id), [store])
  return { ...view, selectParticipant }
}
