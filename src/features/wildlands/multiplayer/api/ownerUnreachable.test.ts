import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'
import type { PresenceConnectionStatus, RemoteActorsPort } from '../domain/presence'
import { CLOSE_CODE, OWNER_UNREACHABLE_ATTEMPTS, PRESENCE_PROTOCOL, closeDecision, type ClosedSocket } from '../domain/closePolicy'
import { initialWorldEntry, nextWorldEntry, waitLimitMs, type WorldEntryEvent, type WorldEntryState } from '../domain/worldEntry'
import { WorldEntryController } from '../state/worldEntryController'
import WorldEntryOverlay from '../../components/WorldEntryOverlay.vue'

// CLOUD READINESS-3 (P1): when the server that held the session does not answer, the client retries a
// bounded number of times (4503 'owner-unreachable'), then stops in a held state. Only «Jugar acá» —
// a fresh join with takeover — continues, and nothing triggers it automatically.

const sdk = vi.hoisted(() => {
  type Handler = (payload?: unknown) => void
  const joins: { options: Record<string, unknown>; room: { emit(type: string, payload?: unknown): void; leave(code: number): void } }[] = []
  class Client {
    async joinOrCreate(_name: string, options: Record<string, unknown>) {
      const handlers = new Map<string, Handler>()
      let onLeave: ((code: number) => void) | null = null
      const room = {
        reconnection: { enabled: true },
        onMessage: (type: string, handler: Handler) => { handlers.set(type, handler); return () => {} },
        send: () => {}, onDrop: () => {}, onError: () => {},
        onLeave: (handler: (code: number) => void) => { onLeave = handler },
        leave: async () => {},
      }
      joins.push({ options, room: { emit: (type, payload) => handlers.get(type)?.(payload), leave: code => onLeave?.(code) } })
      return room
    }
  }
  return { joins, Client }
})
vi.mock('@colyseus/sdk', () => ({ Client: sdk.Client }))
vi.mock('../../../../shared/api/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}))

const closed = (over: Partial<ClosedSocket>): ClosedSocket =>
  ({ code: 1006, closing: null, serverProtocol: PRESENCE_PROTOCOL, livedMs: 1_000, now: 1_000_000, lastAmbiguousAt: null, ...over })
const run = (state: WorldEntryState, ...events: WorldEntryEvent['type'][]) => events.reduce((s, type) => nextWorldEntry(s, { type } as WorldEntryEvent), state)
/** The latest join (index access: the app's lib is ES2020, which has no Array.prototype.at). */
const lastJoin = () => sdk.joins[sdk.joins.length - 1]
const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
const remotePort = (): RemoteActorsPort => ({
  replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn(), setAuthoritativeActor: vi.fn(), setPresenceAccess: vi.fn(), presenceRejected: vi.fn(),
})

describe('owner-unreachable (CLOUD READINESS-3, P1)', () => {
  it('close policy: the reason wins over the 4503 code; a plain 4503 is still an ordinary drain', () => {
    expect(closeDecision(closed({ code: CLOSE_CODE.DRAINING, closing: 'owner-unreachable' })).action).toBe('owner-unreachable')
    expect(closeDecision(closed({ code: CLOSE_CODE.DRAINING })).action).toBe('reconnect')
    expect(OWNER_UNREACHABLE_ATTEMPTS).toBe(4)
  })

  it('entry machine: held is final until «Jugar acá»; a replacement is never downgraded to held', () => {
    const held = run(initialWorldEntry(true), 'snapshot', 'prepared', 'held')
    expect(held).toMatchObject({ phase: 'held', live: false })
    expect(waitLimitMs(held)).toBeNull()
    for (const type of ['lost', 'timeout', 'retry', 'renew', 'snapshot', 'prepared'] as const) expect(run(held, type).phase).toBe('held')
    expect(run(held, 'takeover').phase).toBe('connecting')
    expect(run(initialWorldEntry(true), 'replaced', 'held').phase).toBe('replaced')
  })

  it('controller: held closes the socket; «Jugar acá» opens a FRESH socket with takeover, and only from replaced or held', () => {
    const sockets: { status: PresenceConnectionStatus; options: { resume: boolean; takeover?: boolean }; disconnected: number }[] = []
    const controller = new WorldEntryController({
      scene: { holdScene: () => {}, revealScene: () => {}, prepare: () => Promise.resolve() },
      openSocket: (status, options) => { const s = { status, options, disconnected: 0 }; sockets.push(s); return { connect: () => {}, disconnect: () => { s.disconnected++ } } },
      onChange: () => {},
      timers: { set: () => 0, clear: () => {} },
    })
    controller.start()
    controller.takeover()
    expect(sockets).toHaveLength(1)                                    // not from connecting
    sockets[0].status.held?.()
    expect(controller.current.phase).toBe('held')
    expect(sockets[0].disconnected).toBe(1)
    controller.takeover()
    expect(sockets.map(s => s.options)).toEqual([{ resume: false }, { resume: false, takeover: true }])
  })

  it('adapter: bounded retries, then held and no further join; a takeover join carries takeover and never resume', async () => {
    vi.useFakeTimers()
    vi.stubEnv('VITE_REALTIME_URL', 'ws://realtime.test')
    vi.resetModules()
    const { ColyseusPresence } = await import('./colyseusPresence')
    const status = { snapshot: vi.fn(), lost: vi.fn(), replaced: vi.fn(), held: vi.fn() }
    const presence = new ColyseusPresence(remotePort(), null, null, status)
    await presence.connect(undefined)
    for (let attempt = 1; attempt <= OWNER_UNREACHABLE_ATTEMPTS; attempt++) {
      const join = lastJoin()
      join.room.emit('presence:closing', { reason: 'owner-unreachable' })
      join.room.leave(CLOSE_CODE.DRAINING)
      await vi.runAllTimersAsync()
      await settle()
    }
    expect(status.held).toHaveBeenCalledOnce()
    expect(sdk.joins).toHaveLength(OWNER_UNREACHABLE_ATTEMPTS)
    expect(sdk.joins.slice(1).every(j => j.options.resume === true && !('takeover' in j.options))).toBe(true)
    const playHere = new ColyseusPresence(remotePort(), null, null, status)
    await playHere.connect(undefined, { takeover: true })
    expect(lastJoin().options).toMatchObject({ takeover: true })
    expect('resume' in lastJoin().options).toBe(false)
    await playHere.connect(undefined)
    const both = new ColyseusPresence(remotePort(), null, null, status)
    await both.connect(undefined, { resume: true, takeover: true })
    expect(lastJoin().options).toMatchObject({ resume: true })
    expect('takeover' in lastJoin().options).toBe(false)
    vi.useRealTimers()
  })

  it('overlay: held explains that the previous server does not answer (no other tab implied) and offers «Jugar acá»', async () => {
    const wrapper = mount(WorldEntryOverlay, { props: { state: run(initialWorldEntry(true), 'held') } })
    expect(wrapper.attributes('role')).toBe('alert')
    expect(wrapper.find('.wl-entry-text').text()).toBe('El servidor donde estaba tu partida no responde.')
    expect(wrapper.text()).not.toContain('pestaña')
    await wrapper.find('[data-testid="world-entry-takeover"]').trigger('click')
    expect(wrapper.emitted('takeover')).toHaveLength(1)
  })
})
