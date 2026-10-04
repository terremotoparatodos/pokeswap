import test from 'node:test'
import assert from 'node:assert/strict'
import { ACTIVATE_ATTEMPTS } from './hostLifecycle.js'
import { world } from './testing/hostAuthority.js'
import { PresenceHosting } from '../rooms/presenceHosting.js'
import { HOST_DRAINING_CODE } from '../protocol/closeCodes.js'

// WORLD LOCATION-4, review N1: only a newer host is the end; everything else is recoverable.
// The controlled clock and the in-memory authority: testing/hostAuthority.js.

/**
 * Runs `action` once the controlled clock reaches `at`. Bounded: if the clock stops advancing
 * (a host that stopped for good no longer sleeps) it gives up, so the test fails by its
 * assertions instead of keeping the event loop alive until the framework's timeout.
 */
function onClock(w, at, action, ticks = 50_000) {
  setImmediate(function check() { if (w.clock.t >= at) action(); else if (--ticks > 0) setImmediate(check) })
}
/** Lifts the outage once the controlled clock reaches `at`. */
function liftAt(w, at) { onClock(w, at, () => { w.authority.down = false }) }

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
  let leaseWhenUnavailable = null
  h = w.host({ sleep, onUnavailable: () => { leaseWhenUnavailable ??= w.hosts.get(h.hostId).lease } })
  await h.acquire()
  const { generation, hostId } = h
  w.authority.failing.add('activate')
  onClock(w, 20_000, () => w.authority.failing.delete('activate'))
  assert.equal(await h.activate(), 'unavailable')
  assert.ok(leaseWhenUnavailable > 15_000, `renewed while starting, between the attempts (lease ${leaseWhenUnavailable})`)
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
