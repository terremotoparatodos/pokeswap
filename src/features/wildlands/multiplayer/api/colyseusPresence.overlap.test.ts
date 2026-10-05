import { describe, expect, it, vi } from 'vitest'
import type { RemoteActorsPort } from '../domain/presence'

// CLOUD READINESS-3 (precondition): the REAL reconnection contract of one page. Two sockets of
// the same page can overlap, and a join the page already abandoned can still reach the server
// AFTER the page's newer socket did. Both carry the same tab id, so a tab id alone cannot tell
// the page's current connection from an abandoned one (docs/design/CLOUD_READINESS_3_REPORT.md §1).

const sdk = vi.hoisted(() => {
  const joins: { options: Record<string, unknown>; resolve: (room: unknown) => void; reject: (error: unknown) => void; order: number }[] = []
  const events: string[] = []
  let order = 0
  const room = (label: string) => ({
    reconnection: { enabled: true },
    onMessage: () => () => {},
    send: () => {},
    onDrop: () => {},
    onError: () => {},
    onLeave: () => {},
    leave: async () => { events.push(`leave:${label}`) },
  })
  class Client {
    joinOrCreate(_name: string, options: Record<string, unknown>) {
      return new Promise((resolve, reject) => { joins.push({ options, resolve, reject, order: ++order }) })
    }
  }
  return { joins, events, room, Client }
})
vi.mock('@colyseus/sdk', () => ({ Client: sdk.Client }))
vi.mock('../../../../shared/api/supabase', () => ({
  supabase: { auth: { getSession: vi.fn(async () => ({ data: { session: null } })) } },
}))

const settle = async () => { for (let i = 0; i < 10; i++) await Promise.resolve() }
function remotePort(): RemoteActorsPort {
  return {
    replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn(),
    setAuthoritativeActor: vi.fn(), setPresenceAccess: vi.fn(), presenceRejected: vi.fn(),
  }
}

async function load() {
  vi.stubEnv('VITE_REALTIME_URL', 'ws://realtime.test')
  vi.resetModules()
  const { ColyseusPresence } = await import('./colyseusPresence')
  const { WorldEntryController } = await import('../state/worldEntryController')
  return { ColyseusPresence, WorldEntryController }
}

describe('ColyseusPresence: overlapping connections of one page (characterization)', () => {
  it('a renew while the first join is pending opens a second join with the SAME tab id; the abandoned join can resolve after it', async () => {
    const { ColyseusPresence, WorldEntryController } = await load()
    const controller = new WorldEntryController({
      scene: { holdScene: () => {}, revealScene: () => {}, prepare: () => Promise.resolve() },
      openSocket: (s, { resume }) => {
        const socket = new ColyseusPresence(remotePort(), null, null, s)
        return { connect: () => void socket.connect(undefined, { resume }), disconnect: () => socket.disconnect() }
      },
      onChange: () => {},
      timers: { set: () => 0, clear: () => {} },
    })
    controller.start()
    await settle()
    expect(sdk.joins).toHaveLength(1)
    controller.renew()                       // the session changed while the first join is in flight
    await settle()
    expect(sdk.joins).toHaveLength(2)
    const [first, second] = sdk.joins
    expect(second.options.tabId).toBe(first.options.tabId)
    expect(first.options.resume).toBeUndefined()
    expect(second.options.resume).toBe(true)

    // The server admits the NEW join first, then the ABANDONED one (a slow first handshake).
    second.resolve(sdk.room('second'))
    await settle()
    first.resolve(sdk.room('first'))
    await settle()
    // The page only leaves the abandoned room AFTER the server already admitted it: for that
    // window the server holds two sessions of this page, the abandoned one being the later join.
    expect(sdk.events).toEqual(['leave:first'])
  })
})
