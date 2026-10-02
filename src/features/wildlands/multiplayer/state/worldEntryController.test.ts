import { describe, expect, it, vi } from 'vitest'
import type { PresenceConnectionStatus } from '../domain/presence'
import type { WorldEntryState } from '../domain/worldEntry'
import { WorldEntryController } from './worldEntryController'

// The controller alone, with a fake scene, fake sockets and manual timers.

function stage(prepare: () => Promise<void> = () => Promise.resolve(), onFailure?: (error: unknown) => void) {
  const calls: string[] = []
  const sockets: { status: PresenceConnectionStatus; connected: number; disconnected: number }[] = []
  const timers = new Map<number, { run: () => void; ms: number }>()
  let nextTimer = 0
  const states: WorldEntryState[] = []
  const controller = new WorldEntryController({
    scene: {
      holdScene: () => calls.push('hold'),
      revealScene: () => calls.push('reveal'),
      prepare: () => { calls.push('prepare'); return prepare() },
    },
    openSocket: status => {
      const socket = { status, connected: 0, disconnected: 0 }
      sockets.push(socket)
      return { connect: () => { socket.connected++ }, disconnect: () => { socket.disconnected++ } }
    },
    onChange: state => states.push(state),
    onFailure,
    timers: {
      set: (run, ms) => { timers.set(++nextTimer, { run, ms }); return nextTimer },
      clear: handle => { timers.delete(handle as number) },
    },
  })
  const fire = (ms: number) => {
    for (const [id, timer] of [...timers]) if (timer.ms === ms) { timers.delete(id); timer.run() }
  }
  return { controller, calls, sockets, timers, states, fire, socket: () => sockets[sockets.length - 1] }
}
const settle = async () => { for (let i = 0; i < 5; i++) await Promise.resolve() }

describe('WorldEntryController', () => {
  it('holds the scene before opening the one socket, with a 12 s wait', () => {
    const s = stage()
    s.controller.start()
    s.controller.start()
    expect(s.calls).toEqual(['hold'])
    expect(s.sockets).toHaveLength(1)
    expect(s.socket().connected).toBe(1)
    expect([...s.timers.values()].map(timer => timer.ms)).toEqual([12_000])
  })

  it('reveals once, after the snapshot and the preparation, and clears the timeout', async () => {
    let finish!: () => void
    const s = stage(() => new Promise(resolve => { finish = resolve }))
    s.controller.start()
    s.socket().status.snapshot('player')
    expect(s.timers.size).toBe(0)
    await settle()
    expect(s.calls).toEqual(['hold', 'prepare'])
    finish()
    await settle()
    expect(s.calls).toEqual(['hold', 'prepare', 'reveal'])
    expect(s.controller.current.phase).toBe('ready')
    // Later snapshots are area changes: no prepare, no second reveal.
    s.socket().status.snapshot('player')
    await settle()
    expect(s.calls).toEqual(['hold', 'prepare', 'reveal'])
  })

  it('a loss holds the scene and arms a fresh 15 s wait; a loss mid-wait keeps the running timer', async () => {
    const s = stage()
    s.controller.start()
    s.socket().status.snapshot('player')
    await settle()
    s.socket().status.lost()
    expect(s.calls[s.calls.length - 1]).toBe('hold')
    expect([...s.timers.values()].map(timer => timer.ms)).toEqual([15_000])
    s.socket().status.lost()
    expect(s.timers.size).toBe(1)
    s.fire(15_000)
    expect(s.controller.current).toMatchObject({ phase: 'connection-error', failed: 'reconnect' })
    expect(s.socket().disconnected).toBe(1)
  })

  it('retry replaces the socket: one new socket, the old one disconnected and muted', async () => {
    const s = stage()
    s.controller.start()
    s.fire(12_000)
    expect(s.controller.current.phase).toBe('connection-error')
    const old = s.socket()
    s.controller.retry()
    s.controller.retry()
    expect(s.sockets).toHaveLength(2)
    expect(old.disconnected).toBeGreaterThanOrEqual(1)
    expect(s.timers.size).toBe(1)
    old.status.snapshot('player')
    old.status.replaced()
    await settle()
    expect(s.controller.current.phase).toBe('connecting')
    expect(s.calls).not.toContain('prepare')
  })

  it('a session change replaces the socket: the old one is disconnected, one timer runs', () => {
    const s = stage()
    s.controller.start()
    s.socket().status.snapshot('player')
    s.socket().status.lost()
    const first = s.socket()
    s.controller.renew()
    expect(s.timers.size).toBe(1)
    expect(s.sockets).toHaveLength(2)
    expect(first.disconnected).toBe(1)
    expect(s.socket().connected).toBe(1)
  })

  it('4001: replaced for good, no socket opened afterwards', () => {
    const s = stage()
    s.controller.start()
    s.socket().status.replaced()
    expect(s.controller.current.phase).toBe('replaced')
    expect(s.timers.size).toBe(0)
    s.controller.retry()
    s.controller.renew()
    s.fire(12_000)
    expect(s.sockets).toHaveLength(1)
  })

  it('a failed preparation shows an error, closes the socket and is reported', async () => {
    const failure = vi.fn()
    const s = stage(() => Promise.reject(new Error('chunk worker died')), failure)
    s.controller.start()
    s.socket().status.snapshot('player')
    await settle()
    expect(s.controller.current).toMatchObject({ phase: 'connection-error', failed: 'entry' })
    expect(failure).toHaveBeenCalledOnce()
    expect(s.calls).not.toContain('reveal')
    expect(s.socket().disconnected).toBe(1)
  })

  it('dispose stops the timer and the socket', () => {
    const s = stage()
    s.controller.start()
    s.controller.dispose()
    expect(s.timers.size).toBe(0)
    expect(s.socket().disconnected).toBe(1)
    s.socket().status.snapshot('player')
    expect(s.controller.current.authority).toBe(false)
  })
})
