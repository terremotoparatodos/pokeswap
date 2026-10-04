import test from 'node:test'
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { ACTIVATE_ATTEMPTS, HostLifecycle } from './hostLifecycle.js'
import { PresenceHosting } from '../rooms/presenceHosting.js'
import { HOST_DRAINING_CODE } from '../protocol/closeCodes.js'

// WORLD LOCATION-4, review N1: only a newer host is the end; everything else is recoverable.
// A controlled clock (sleep advances it, nothing waits in real time) and an in-memory authority
// with the semantics of the SQL functions (world_presence_*): leases on the authority's clock,
// idempotent acquire/activate, newer_active, host_expired, unknown_host, renew reviving an
// expired active host only without a newer one.

function world() {
  const clock = { t: 0 }
  const hosts = new Map() // hostId → { generation, state, lease }
  let next = 0
  const calls = []
  const authority = { down: false, loseNext: null, failing: new Set() }
  const live = h => h.lease > clock.t
  const newerActive = generation => [...hosts.values()].some(h => h.generation > generation && h.state === 'active' && live(h))
  const byKey = (generation, hostId) => { const h = hosts.get(hostId); return h && h.generation === generation ? h : null }
  async function call(op, fn) {
    calls.push(op)
    if (authority.down || authority.failing.has(op)) throw new Error('authority unreachable')
    const answer = fn()
    if (authority.loseNext === op) { authority.loseNext = null; throw new Error('answer lost') } // applied, answer lost
    return answer
  }
  const store = {
    presenceAcquire: (hostId, leaseMs) => call('acquire', () => {
      let h = hosts.get(hostId)
      if (!h) { h = { generation: ++next, state: 'starting', lease: clock.t + leaseMs }; hosts.set(hostId, h) }
      return { generation: h.generation, state: h.state }
    }),
    presenceActivate: (generation, hostId, leaseMs) => call('activate', () => {
      const h = byKey(generation, hostId)
      if (!h) return { status: 'unknown_host' }
      if (h.state === 'active') return { status: 'active' }
      if (h.state !== 'starting') return { status: 'host_inactive', state: h.state }
      if (!live(h)) return { status: 'host_expired' }
      if (newerActive(generation)) return { status: 'newer_active' }
      h.state = 'active'
      h.lease = clock.t + leaseMs
      return { status: 'active' }
    }),
    presenceRenew: (generation, hostId, leaseMs) => call('renew', () => {
      const h = byKey(generation, hostId)
      if (!h) return { status: 'unknown_host' }
      if (h.state === 'stopped') return { status: 'host_inactive', state: 'stopped' }
      if (h.state === 'starting' && !live(h)) return { status: 'host_expired', state: 'starting' }
      const newer = newerActive(generation)
      if (h.state === 'active' && !live(h) && newer) return { status: 'ok', state: 'active', newerActive: true, leaseLive: false }
      if (h.state !== 'draining') h.lease = clock.t + leaseMs
      return { status: 'ok', state: h.state, newerActive: newer, leaseLive: true }
    }),
    presenceDrain: (generation, hostId) => call('drain', () => { const h = byKey(generation, hostId); if (h) h.state = 'draining'; return { status: 'ok', state: 'draining' } }),
    presenceStop: (generation, hostId) => call('stop', () => { const h = byKey(generation, hostId); if (h) h.state = 'stopped'; return { status: 'ok', state: 'stopped' } }),
  }
  /** Another process, newer, activated directly in the authority. */
  const newerHost = () => { const id = randomUUID(); hosts.set(id, { generation: ++next, state: 'active', lease: clock.t + 15_000 }) }
  const sleep = ms => { clock.t += ms; return new Promise(resolve => setImmediate(resolve)) }
  const host = (options = {}) => new HostLifecycle({ store, renewMs: 3_600_000, log: () => {}, sleep, now: () => clock.t, ...options })
  const until = async (condition, steps = 400) => { for (let i = 0; i < steps && !condition(); i++) await new Promise(resolve => setImmediate(resolve)) }
  return { clock, hosts, calls, authority, store, newerHost, sleep, host, until }
}

/** Lifts the outage once the controlled clock reaches `at`. */
function liftAt(w, at) { setImmediate(function lift() { if (w.clock.t >= at) w.authority.down = false; else setImmediate(lift) }) }

test('N1-1: six activate failures leave the host unavailable, never stopped; shorter than the lease it recovers the same identity; at ≈17 s exactly one new one, confirmed', async () => {
  // a) Back at 13 s: the starting lease (15 s) is still live — same generation and hostId.
  const w = world()
  const h = w.host()
  await h.acquire()
  const { generation, hostId } = h
  w.authority.down = true
  liftAt(w, 13_000)
  assert.equal(await h.activate(), 'unavailable', 'unreachable: recoverable')
  assert.equal(w.calls.filter(c => c === 'activate').length, ACTIVATE_ATTEMPTS)
  assert.equal(h.admitting, false, '/readyz 503 and joins 4503 in on meanwhile')
  assert.equal(h.displaced, false)
  await w.until(() => h.state === 'active')
  assert.equal(h.state, 'active', 'back to active on its own (no exit, no restart)')
  assert.deepEqual([h.generation, h.hostId], [generation, hostId], 'same identity: a lost answer is never a new generation')
  assert.equal(h.counters.identities, 1)
  assert.equal(w.calls.filter(c => c === 'acquire').length, 1)
  await h.stop()

  // b) Back at 17 s: the starting lease expired during the outage. The database answers
  //    host_expired, and only then is a new identity taken — exactly one.
  const v = world()
  const g = v.host()
  await g.acquire()
  const expired = g.generation
  v.authority.down = true
  liftAt(v, 17_000)
  assert.equal(await g.activate(), 'unavailable')
  await v.until(() => g.state === 'active')
  assert.equal(g.state, 'active')
  assert.ok(v.clock.t >= 17_000)
  assert.equal(g.counters.identityResets, 1, 'one reset, because the database said host_expired')
  assert.equal(g.counters.identities, 2)
  assert.ok(g.generation > expired)
  await g.stop()
})

test('N1-1c: only activate fails for ≈20 s while renewals answer: the renewals between attempts keep the starting lease, so the same identity recovers', async () => {
  const w = world()
  let h = null
  // The renewal timer, driven by the controlled clock: one renewal per backoff sleep.
  const sleep = ms => { w.clock.t += ms; void h?.renew(); return new Promise(resolve => setImmediate(resolve)) }
  h = w.host({ sleep })
  await h.acquire()
  const { generation, hostId } = h
  w.authority.failing.add('activate')
  setImmediate(function lift() { if (w.clock.t >= 20_000) w.authority.failing.delete('activate'); else setImmediate(lift) })
  assert.equal(await h.activate(), 'unavailable')
  await w.until(() => h.state === 'active')
  assert.equal(h.state, 'active')
  assert.ok(w.clock.t >= 20_000, 'longer than the 15 s starting lease')
  assert.deepEqual([h.generation, h.hostId], [generation, hostId], 'renewed between attempts: no new generation')
  assert.equal(h.counters.identities, 1)
  assert.ok(w.calls.filter(c => c === 'renew').length > 0)
  await h.stop()
})

test('N1-2: an activate applied but whose answer is lost is retried with the same identity and is simply active', async () => {
  const w = world()
  const h = w.host()
  await h.acquire()
  const generation = h.generation
  w.authority.loseNext = 'activate'
  assert.equal(await h.activate(), 'active')
  assert.equal(h.generation, generation)
  assert.equal(w.calls.filter(c => c === 'activate').length, 2)
  // And a lost acquire answer, during recovery, re-reads the same generation.
  const r = w.host()
  w.authority.down = true
  assert.equal(await r.acquire({ waitMs: 0 }), 'unavailable')
  w.authority.down = false
  w.authority.loseNext = 'acquire'
  await w.until(() => r.state === 'active')
  assert.equal(r.state, 'active')
  assert.equal(r.counters.identities, 1, 'the lost acquire answer did not cost a generation')
  await h.stop(); await r.stop()
})

test('N1-3: unknown_host is recoverable: a new hostId and generation are taken only because the database confirmed it', async () => {
  const w = world()
  const h = w.host()
  await h.acquire(); await h.activate()
  const { generation, hostId } = h
  w.hosts.delete(hostId) // the database no longer knows it
  await h.renew()
  await w.until(() => h.state === 'active' && h.generation !== generation)
  assert.equal(h.state, 'active')
  assert.notEqual(h.hostId, hostId)
  assert.ok(h.generation > generation)
  assert.equal(h.counters.identities, 2, 'exactly one new generation')
  assert.equal(h.displaced, false)
  await h.stop()
})

test('N1-4: a starting host whose lease expired before its activation takes a new identity and recovers', async () => {
  const w = world()
  const h = w.host()
  await h.acquire()
  const expired = h.generation
  w.clock.t += 20_000 // past the 15 s starting lease
  assert.equal(await h.activate(), 'unavailable')
  assert.equal(h.counters.activation, 'host_expired')
  await w.until(() => h.state === 'active')
  assert.equal(h.state, 'active')
  assert.ok(h.generation > expired)
  assert.equal([...w.hosts.values()].find(x => x.generation === expired).state, 'starting', 'the expired identity was never activated')
  await h.stop()
})

test('N1-5/6: the authority down for more than a lease pauses an active host (503, no joins, no claims), then it recovers by itself — same generation, no other host', async () => {
  const w = world()
  const recovered = []
  const h = w.host({ onRecovered: () => recovered.push(w.clock.t) })
  await h.acquire(); await h.activate()
  const generation = h.generation
  w.authority.down = true
  for (let i = 0; i < 4 && !h.paused; i++) { w.clock.t += 5_000; await h.renew() } // renewals every 5 s fail
  assert.equal(h.paused, true, 'no renewal answered for a whole lease period: paused')
  assert.ok(w.clock.t >= 15_000)
  assert.equal(h.admitting, false)
  assert.equal(h.canClaim, false)
  assert.equal(h.state, 'active', 'paused, not stopped')
  for (let i = 0; i < 4; i++) { w.clock.t += 5_000; await h.renew() } // still down: past two leases
  assert.equal(h.paused, true)
  w.authority.down = false
  w.clock.t += 5_000
  await h.renew()
  assert.equal(h.paused, false, 'the next renewal revives the lease (no newer host)')
  assert.equal(h.admitting, true)
  assert.equal(h.generation, generation, 'same generation: no new identity for an outage')
  assert.equal(h.counters.identities, 1)
  assert.equal(recovered.length, 1)
  await h.stop()
})

test('N1-7: recovering while a newer host became active is the definitive displacement: stopped, never re-acquired', async () => {
  // a) an active host, authority down past its lease, a newer host activated meanwhile.
  const w = world()
  const h = w.host()
  h.onNewerActive = () => { void h.displace() } // what the room does in on (after its drain)
  await h.acquire(); await h.activate()
  w.authority.down = true
  for (let i = 0; i < 4; i++) { w.clock.t += 5_000; await h.renew() }
  w.newerHost()
  w.authority.down = false
  w.clock.t += 5_000
  await h.renew()
  await w.until(() => h.state === 'stopped')
  assert.equal(h.state, 'stopped')
  assert.equal(h.displaced, true)
  const acquires = w.calls.filter(c => c === 'acquire').length
  for (let i = 0; i < 5; i++) { w.clock.t += 30_000; await h.renew(); await new Promise(resolve => setImmediate(resolve)) }
  assert.equal(w.calls.filter(c => c === 'acquire').length, acquires, 'never acquires again')
  assert.equal(h.state, 'stopped')

  // b) an unavailable candidate (activation unreachable); a newer host activates meanwhile.
  const v = world()
  const c = v.host()
  await c.acquire()
  v.authority.down = true
  assert.equal(await c.activate(), 'unavailable')
  v.newerHost()
  v.authority.down = false
  await v.until(() => c.state === 'stopped')
  assert.equal(c.displaced, true, 'newer_active on the recovery activate: displaced for good')
  assert.equal(c.counters.identities, 1, 'no new generation')
})

test('N1-8: shadow during the whole outage: joins admitted at once, /readyz 200, no key (no claims), nobody closed', async () => {
  const w = world()
  const location = { restores: false, active: true, attachHost() {}, counters: { shadow: { wouldDrain: 0 } }, async shutdown() { return {} } }
  const sockets = []
  const hosting = new PresenceHosting({ location: () => location, sockets: () => sockets, metrics: { rejected: () => {} }, log: () => {} })
  const h = hosting.configure(w.host())
  w.authority.down = true
  assert.equal(await h.acquire({ waitMs: 0 }), 'unavailable')
  for (let i = 0; i < 3; i++) {
    const socket = { sent: [], leaves: [], send() {}, leave(code) { this.leaves.push(code) } }
    await hosting.admit(socket, { presenceProtocol: 3 }, { kind: 'player', userId: `u${i}` }, () => null)
    sockets.push(socket)
    assert.equal(hosting.serving, true)
    assert.equal(h.sessionKey(), null, 'no key: no claim, no save')
    w.clock.t += 10_000
  }
  assert.ok(sockets.every(s => s.leaves.length === 0))
  // The same outage in on: 503 and 4503 at once (no 2 s wait for an unavailable host).
  const onLocation = { ...location, restores: true }
  const on = new PresenceHosting({ location: () => onLocation, sockets: () => [], metrics: { rejected: () => {} }, log: () => {} })
  const o = on.configure(w.host())
  assert.equal(await o.acquire({ waitMs: 0 }), 'unavailable')
  assert.equal(on.serving, false)
  await assert.rejects(on.admit({ send() {}, leave() {} }, {}, { kind: 'player', userId: 'v' }, () => null), e => e.code === HOST_DRAINING_CODE)
  w.authority.down = false
  await w.until(() => h.state === 'active' && o.state === 'active')
  assert.equal(on.serving, true, 'back to ready on its own')
  await h.stop(); await o.stop()
})
