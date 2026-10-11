import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const scripted = vi.hoisted(() => ({ join: vi.fn() }))
vi.mock('@colyseus/sdk', () => ({ Client: class { joinOrCreate = scripted.join } }))
vi.mock('../../../../shared/api/supabase', () => ({ supabase: { auth: { getSession: async () => ({ data: { session: { access_token: 'SCRIPTED-only' } } }) } } }))
beforeEach(() => { vi.useFakeTimers(); vi.resetModules(); scripted.join.mockReset(); vi.stubEnv('PROD', true); vi.stubEnv('DEV', false); vi.stubEnv('VITE_ECO_RELEASE', 'limited'); vi.stubEnv('VITE_ECO_EXPERIMENT', 'on'); vi.stubEnv('VITE_REALTIME_URL', 'wss://scripted.invalid') })
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs() })
async function setup() {
  const { ColyseusPresence, REALTIME_CONFIGURED } = await import('./colyseusPresence')
  const { limitedEntry } = await import('../../../world/state/limitedEntry')
  const remote = { setPresenceAccess: vi.fn(), setAuthoritativeActor: vi.fn(), replaceRemoteActors: vi.fn(), upsertRemoteActor: vi.fn(), removeRemoteActor: vi.fn() }
  return { socket: new ColyseusPresence(remote), limitedEntry, remote, REALTIME_CONFIGURED }
}
function room() {
  const handlers = new Map<string, (p: unknown) => void>()
  let closed: (code: number) => void = () => {}
  return { reconnection: { enabled: true }, handlers, onMessage: (t: string, fn: (p: unknown) => void) => handlers.set(t, fn), send: vi.fn(), leave: vi.fn(async () => {}), onDrop: vi.fn(), onError: vi.fn(), onLeave: (fn: typeof closed) => { closed = fn }, close: (code: number) => closed(code) }
}
describe('SCRIPTED SDK limited transport (no hosted Auth)', () => {
  it.each([403, 410, 4403, 4408])('stops a refused join %s without automatic retries', async code => {
    scripted.join.mockRejectedValue({ code })
    const m = await setup(); await m.socket.connect()
    expect(m.limitedEntry.phase.value).toBe(code === 4408 || code === 410 ? 'expired' : 'denied')
    await vi.advanceTimersByTimeAsync(30_000)
    expect(scripted.join).toHaveBeenCalledOnce()
  })
  it('guest snapshots never make a real session; expiry closes an admitted socket', async () => {
    const r = room(); scripted.join.mockResolvedValue(r)
    const m = await setup(); await m.socket.connect()
    r.handlers.get('presence:snapshot')?.({ access: 'guest', actors: [] })
    expect(m.limitedEntry.phase.value).toBe('denied')
    expect(m.remote.setPresenceAccess).not.toHaveBeenCalledWith('guest')
    expect(r.leave).toHaveBeenCalledOnce()
    const second = room(); scripted.join.mockResolvedValue(second)
    const n = await setup(); n.limitedEntry.reset(); await n.socket.connect()
    second.handlers.get('presence:snapshot')?.({ access: 'player', self: { id: 'SCRIPTED-A' }, actors: [] })
    expect(n.limitedEntry.phase.value).toBe('ready')
    second.close(4408)
    expect(n.limitedEntry.phase.value).toBe('expired')
    expect(second.leave).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(30_000)
    expect(scripted.join).toHaveBeenCalledTimes(2)
  })
  it('an absent endpoint fails closed and cannot select the offline entry mode', async () => {
    vi.stubEnv('VITE_REALTIME_URL', '')
    const m = await setup(); await m.socket.connect()
    expect(m.REALTIME_CONFIGURED).toBe(true)
    expect(m.limitedEntry.phase.value).toBe('denied')
    expect(scripted.join).not.toHaveBeenCalled()
  })
})
