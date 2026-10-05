import { afterEach, describe, expect, it, vi } from 'vitest'
import type { RemoteActorsPort } from '../domain/presence'
import { CLOSE_CODE, PRESENCE_PROTOCOL, closeDecision, joinRefusalDecision } from '../domain/closePolicy'
import type { WorldEntryState } from '../domain/worldEntry'

// CLOUD JOIN-ORDER-2 — the client side of the join-order contract (docs/design/CLOUD_JOIN_ORDER_2_REPORT.md):
//   - every join of a page carries the page id (TAB_ID) and the page's next attempt; overlapping sockets of
//     one page get increasing attempts; «Jugar acá» is just the next attempt; a reload starts over;
//   - 4410 (an attempt the page already moved past) is silent for the abandoned socket: no status, no retry,
//     and the page's current connection is neither closed, moved nor retried because of it;
//   - 4410/4422 reaching the page's own socket stops it without any automatic retry (never a loop).
// Order is driven by held promises (each join resolves or rejects only when the test says so).

const sdk = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void
  interface Join {
    options: Record<string, unknown>
    resolve(): void
    reject(code: number): void
    room: { emit(type: string, payload?: unknown): void; close(code: number): void; left: number }
  }
  const joins: Join[] = []
  class Client {
    joinOrCreate(_name: string, options: Record<string, unknown>) {
      return new Promise((resolve, reject) => {
        const handlers = new Map<string, Handler>()
        let onLeave: ((code: number) => void) | null = null
        const state = { left: 0 }
        const room = {
          reconnection: { enabled: true },
          onMessage: (type: string, handler: Handler) => { handlers.set(type, handler); return () => {} },
          send: () => {}, onDrop: () => {}, onError: () => {},
          onLeave: (handler: (code: number) => void) => { onLeave = handler },
          leave: async () => { state.left++ },
        }
        joins.push({
          options,
          resolve: () => resolve(room),
          reject: code => reject(Object.assign(new Error('refused'), { code })),
          room: { emit: (type, payload) => handlers.get(type)?.(payload), close: code => onLeave?.(code), get left() { return state.left } },
        })
      })
    }
  }
  return { joins, Client }
})
vi.mock('@colyseus/sdk', () => ({ Client: sdk.Client }))
vi.mock('../../../../shared/api/supabase', () => ({ supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } } }))

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const remote = (): RemoteActorsPort => ({
  replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn(), setAuthoritativeActor: vi.fn(), setPresenceAccess: vi.fn(), presenceRejected: vi.fn(),
})
const snapshot = { access: 'player', actors: [], self: { id: 'u', tx: 31, ty: 20 }, presenceProtocol: PRESENCE_PROTOCOL }

async function pageLoad() {
  vi.stubEnv('VITE_REALTIME_URL', 'ws://realtime.test')
  vi.resetModules()
  const { ColyseusPresence } = await import('./colyseusPresence')
  const { WorldEntryController } = await import('../state/worldEntryController')
  return { ColyseusPresence, WorldEntryController }
}

/** A page: the entry controller with real adapters; `phases` records every entry state it went through. */
async function page() {
  const { ColyseusPresence, WorldEntryController } = await pageLoad()
  const phases: WorldEntryState['phase'][] = []
  const timers: { run: () => void; ms: number }[] = []
  const controller = new WorldEntryController({
    scene: { holdScene: () => {}, revealScene: () => {}, prepare: () => Promise.resolve() },
    openSocket: (status, { resume, takeover }) => {
      const socket = new ColyseusPresence(remote(), null, null, status)
      return { connect: () => void socket.connect(undefined, { resume, takeover }), disconnect: () => socket.disconnect() }
    },
    onChange: state => phases.push(state.phase),
    timers: { set: (run, ms) => { timers.push({ run, ms }); return timers.length }, clear: () => {} },
  })
  return { controller, phases, timers, ColyseusPresence }
}

afterEach(() => { sdk.joins.length = 0; vi.useRealTimers() })

describe('join attempts (CLOUD JOIN-ORDER-2)', () => {
  it('close policy: 4410 is a discarded attempt and 4422 an unreadable one, as a close and as a join refusal; neither reconnects', () => {
    const closed = (code: number) => closeDecision({ code, closing: null, serverProtocol: PRESENCE_PROTOCOL, livedMs: 60_000, now: 1, lastAmbiguousAt: null })
    expect(CLOSE_CODE.STALE_ATTEMPT).toBe(4410)
    expect(CLOSE_CODE.INVALID_ATTEMPT).toBe(4422)
    expect(closed(4410).action).toBe('discarded')
    expect(closed(4422).action).toBe('invalid')
    expect(joinRefusalDecision(4410).action).toBe('discarded')
    expect(joinRefusalDecision(4422).action).toBe('invalid')
    // The codes the client already knew are untouched.
    expect(joinRefusalDecision(CLOSE_CODE.REPLACED).action).toBe('replaced')
    expect(joinRefusalDecision(CLOSE_CODE.DRAINING).action).toBe('reconnect')
  })

  it('overlapping sockets of one page carry the same page id and increasing attempts; «Jugar acá» is the next attempt', async () => {
    const { controller } = await page()
    controller.start(); await settle()
    controller.renew(); await settle()                 // the first join still pending: overlap
    expect(sdk.joins.map(j => [j.options.attempt, j.options.resume === true])).toEqual([[1, false], [2, true]])
    expect(sdk.joins[1].options.tabId).toBe(sdk.joins[0].options.tabId)
    sdk.joins[1].reject(CLOSE_CODE.REPLACED); await settle()   // another tab owns the account: «Jugar acá»
    controller.takeover(); await settle()
    expect(sdk.joins[2].options).toMatchObject({ attempt: 3, takeover: true, tabId: sdk.joins[0].options.tabId })
    expect('resume' in sdk.joins[2].options).toBe(false)
  })

  it('every automatic reconnection is a NEW attempt (never the same number twice)', async () => {
    vi.useFakeTimers()
    const { ColyseusPresence } = await pageLoad()
    const presence = new ColyseusPresence(remote())
    void presence.connect(); await settle()
    for (let i = 0; i < 3; i++) {
      sdk.joins[sdk.joins.length - 1].reject(CLOSE_CODE.DRAINING); await settle()
      await vi.runAllTimersAsync(); await settle()
    }
    const attempts = sdk.joins.map(j => j.options.attempt)
    expect(attempts).toEqual([1, 2, 3, 4])
    presence.disconnect()
  })

  it('a new page load starts over: a new page id and attempt 1', async () => {
    const first = await pageLoad()
    void new first.ColyseusPresence(remote()).connect(); await settle()
    const second = await pageLoad()
    void new second.ColyseusPresence(remote()).connect(); await settle()
    expect(sdk.joins.map(j => j.options.attempt)).toEqual([1, 1])
    expect(sdk.joins[0].options.tabId).not.toBe(sdk.joins[1].options.tabId)
  })

  it('the abandoned attempt refused with 4410 is silent: the current connection keeps its state, nothing reconnects', async () => {
    const { controller, phases } = await page()
    controller.start(); await settle()
    controller.renew(); await settle()
    const [abandoned, current] = sdk.joins
    current.resolve(); await settle()
    current.room.emit('presence:snapshot', snapshot); await settle()
    expect(controller.current.phase).toBe('ready')
    const seen = phases.length
    abandoned.reject(CLOSE_CODE.STALE_ATTEMPT); await settle()
    expect(controller.current.phase).toBe('ready')
    expect(phases).toHaveLength(seen)                  // no overlay change at all
    expect(sdk.joins).toHaveLength(2)                  // no reconnection
    expect(current.room.left).toBe(0)                  // the current room is not left
  })

  it('the abandoned attempt admitted late is left at once, and its later 4410 close changes nothing', async () => {
    const { controller, phases } = await page()
    controller.start(); await settle()
    controller.renew(); await settle()
    const [abandoned, current] = sdk.joins
    current.resolve(); await settle()
    current.room.emit('presence:snapshot', snapshot); await settle()
    const seen = phases.length
    abandoned.resolve(); await settle()                // the server admitted the abandoned join after the current one
    expect(abandoned.room.left).toBe(1)                // the page leaves it immediately
    abandoned.room.close(CLOSE_CODE.STALE_ATTEMPT); await settle()
    expect(controller.current.phase).toBe('ready')
    expect(phases).toHaveLength(seen)
    expect(sdk.joins).toHaveLength(2)
  })

  for (const code of [CLOSE_CODE.STALE_ATTEMPT, CLOSE_CODE.INVALID_ATTEMPT]) {
    it(`${code} on the page's OWN socket stops it without any automatic retry (the entry times out into its error screen)`, async () => {
      vi.useFakeTimers()
      const { controller, timers } = await page()
      controller.start(); await settle()
      sdk.joins[0].reject(code); await settle()
      await vi.runAllTimersAsync(); await settle()
      expect(sdk.joins).toHaveLength(1)                // no loop
      expect(controller.current.phase).toBe('connecting') // still the entry's wait (a loss before authority)
      timers[timers.length - 1].run()                              // the entry's own wait runs out
      expect(controller.current.phase).toBe('connection-error')
      controller.retry(); await settle()                // the player's button: exactly one new attempt
      expect(sdk.joins.map(j => j.options.attempt)).toEqual([1, 2])
    })

    it(`${code} closing the page's OWN placed socket stops it without any automatic retry`, async () => {
      vi.useFakeTimers()
      const { controller } = await page()
      controller.start(); await settle()
      sdk.joins[0].resolve(); await settle()
      sdk.joins[0].room.emit('presence:snapshot', snapshot); await settle()
      sdk.joins[0].room.close(code); await settle()
      await vi.runAllTimersAsync(); await settle()
      expect(sdk.joins).toHaveLength(1)
      expect(controller.current.phase).toBe('reconnecting')
    })
  }
})
