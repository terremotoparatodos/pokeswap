// PRESENCE UX-1 — drives one world entry: the socket, its timers and when the
// scene may be drawn. The transitions themselves are `domain/worldEntry.ts`.
//
// Every socket gets its own generation. Status reported by a socket that was
// since replaced (retry, session change) is ignored, so a late message from an
// old room can neither reveal the scene nor start another attempt.

import type { PresenceConnectionStatus } from '../domain/presence'
import { initialWorldEntry, nextWorldEntry, waitLimitMs, type WorldEntryEvent, type WorldEntryState } from '../domain/worldEntry'

/** The engine as the entry sees it: drawn or held, and able to build its current area. */
export interface EntryScene {
  holdScene(): void
  revealScene(): void
  prepare(): Promise<void>
}

/** One presence socket. `connect` starts it; `disconnect` stops it and its own retries for good. */
export interface EntrySocket {
  connect(): void
  disconnect(): void
}

export interface EntryTimers {
  set(run: () => void, ms: number): unknown
  clear(handle: unknown): void
}

export interface WorldEntryOptions {
  scene: EntryScene
  /** Creates (does not connect) one socket that reports to `status`. */
  openSocket(status: PresenceConnectionStatus): EntrySocket
  onChange(state: WorldEntryState): void
  /** Reports a failure the player only sees as an error screen. */
  onFailure?(error: unknown): void
  timers?: EntryTimers
}

const browserTimers: EntryTimers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

export class WorldEntryController {
  private state = initialWorldEntry(true)
  private socket: EntrySocket | null = null
  private generation = 0
  private prepareTicket = 0
  private timer: unknown = null
  private disposed = false
  private readonly timers: EntryTimers

  constructor(private readonly options: WorldEntryOptions) {
    this.timers = options.timers ?? browserTimers
  }

  get current(): WorldEntryState { return this.state }

  /** First entry: hold the scene before anything can be drawn, then open the socket. */
  start(): void {
    if (this.disposed || this.socket) return
    this.options.scene.holdScene()
    this.options.onChange(this.state)
    this.open()
    this.syncTimer(true)
  }

  /** The error screen's button: exactly one new attempt. */
  retry(): void {
    if (this.disposed || this.state.phase !== 'connection-error') return
    this.dispatch({ type: 'retry' })
    this.open()
    this.syncTimer(true)
  }

  /** The browser session changed: a new socket, never out of an error or a replaced session. */
  renew(): void {
    if (this.disposed || !this.socket) return
    const phase = this.state.phase
    if (phase !== 'ready' && phase !== 'connecting' && phase !== 'reconnecting') return
    this.dispatch({ type: 'renew' })
    this.open()
    this.syncTimer(true)
  }

  dispose(): void {
    this.disposed = true
    this.clearTimer()
    this.closeSocket()
  }

  private open(): void {
    this.closeSocket()
    const generation = ++this.generation
    const current = (run: () => void) => () => {
      if (!this.disposed && generation === this.generation) run()
    }
    const socket = this.options.openSocket({
      snapshot: current(() => this.snapshot(generation)),
      lost: current(() => {
        this.dispatch({ type: 'lost' })
        this.syncTimer(false)
      }),
      replaced: current(() => {
        this.dispatch({ type: 'replaced' })
        this.clearTimer()
        this.closeSocket()
      }),
    })
    this.socket = socket
    socket.connect()
  }

  private snapshot(generation: number): void {
    const before = this.state
    this.dispatch({ type: 'snapshot' })
    if (this.state === before) return
    // Authority arrived: the timeout no longer applies, the area is built next.
    this.clearTimer()
    const ticket = ++this.prepareTicket
    const stillCurrent = () => !this.disposed && ticket === this.prepareTicket && generation === this.generation
    this.options.scene.prepare().then(
      () => { if (stillCurrent()) this.dispatch({ type: 'prepared' }) },
      error => {
        if (!stillCurrent()) return
        this.options.onFailure?.(error)
        this.dispatch({ type: 'prepare-failed' })
        if (this.state.phase === 'connection-error') this.closeSocket()
      },
    )
  }

  private dispatch(event: WorldEntryEvent): void {
    const before = this.state
    const after = nextWorldEntry(before, event)
    if (after === before) return
    this.state = after
    if (before.live && !after.live) this.options.scene.holdScene()
    if (!before.live && after.live) this.options.scene.revealScene()
    this.options.onChange(after)
  }

  /** Arms the wait's timeout (`restart`: a new wait begins) or clears it when nothing is waited for. */
  private syncTimer(restart: boolean): void {
    const limit = waitLimitMs(this.state)
    if (limit === null) { this.clearTimer(); return }
    if (this.timer !== null && !restart) return
    this.clearTimer()
    const generation = this.generation
    this.timer = this.timers.set(() => {
      this.timer = null
      if (this.disposed || generation !== this.generation) return
      this.dispatch({ type: 'timeout' })
      // Never a client-chosen place: the attempt just stops until the player retries.
      if (this.state.phase === 'connection-error') this.closeSocket()
    }, limit)
  }

  private clearTimer(): void {
    if (this.timer !== null) this.timers.clear(this.timer)
    this.timer = null
  }

  private closeSocket(): void {
    // Whatever the closed socket still reports (or a prepare it started) is stale now.
    this.generation++
    const socket = this.socket
    this.socket = null
    socket?.disconnect()
  }
}
