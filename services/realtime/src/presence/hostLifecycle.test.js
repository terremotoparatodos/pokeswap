import test from 'node:test'
import assert from 'node:assert/strict'
import { HostLifecycle, activeHost } from './hostLifecycle.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'

// WORLD LOCATION-4 (design §3.3): this process's host lifecycle, against the real ordering
// migration on an embedded Postgres, plus a scripted store for transport failures.

const now = () => Promise.resolve()
const quiet = { log: () => {}, sleep: now }

let db = null
async function sql() {
  db ??= await openLocalDatabase()
  return createSqlPlayerData(serviceQuery(db))
}
test.after(async () => { await db?.close() })

/** The real SQL store, with dials: throw before or AFTER the database call (a lost answer). */
function dialed(base) {
  const store = { calls: [], failBefore: 0, loseAfter: 0 }
  for (const op of ['presenceAcquire', 'presenceActivate', 'presenceRenew', 'presenceDrain', 'presenceStop']) {
    store[op] = async (...args) => {
      store.calls.push(op)
      if (store.failBefore > 0) { store.failBefore--; throw new Error('unreachable') }
      const answer = await base[op](...args)
      if (store.loseAfter > 0) { store.loseAfter--; throw new Error('answer lost') }
      return answer
    }
  }
  return store
}

const hostRow = async generation => (await db.query('SELECT state FROM public.world_presence_hosts WHERE generation = $1', [generation])).rows[0]?.state

test('acquire before listen: starting admits nobody, has no keys and is invisible to the active host', async () => {
  const store = await sql()
  const incumbent = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await incumbent.acquire()
  await incumbent.activate()
  const candidate = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  assert.equal(await candidate.acquire(), 'starting')
  assert.equal(await hostRow(candidate.generation), 'starting')
  assert.ok(candidate.generation > incumbent.generation)
  assert.equal(candidate.admitting, false)
  assert.equal(candidate.canClaim, false)
  assert.equal(candidate.canSave, false)
  assert.equal(candidate.sessionKey(), null, 'no key (no claim) before activation')
  let drained = 0
  incumbent.onNewerActive = () => drained++
  await incumbent.renew()
  assert.equal(drained, 0, 'a starting candidate never drains the active host')
  // The candidate fails before it is ready (never activates): the incumbent is unaffected.
  await candidate.stop()
  await incumbent.renew()
  assert.equal(drained, 0)
  assert.equal(incumbent.state, 'active')
  await incumbent.stop()
})

test('activate once ready: keys are (generation, seq) in acceptance order, fixed, with a fresh session id each', async () => {
  const store = await sql()
  const host = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await host.acquire()
  const waiting = host.whenActive(1_000)
  assert.equal(await host.activate(), 'active')
  assert.equal(await waiting, true)
  assert.equal(await hostRow(host.generation), 'active')
  const keys = [host.sessionKey(), host.sessionKey(), host.sessionKey()]
  assert.deepEqual(keys.map(k => [k.generation, k.seq]), [[host.generation, 1], [host.generation, 2], [host.generation, 3]])
  assert.equal(new Set(keys.map(k => k.sessionId)).size, 3)
  assert.ok(keys.every(k => k.hostId === host.hostId))
  await host.stop()
})

test('lost answers: a retried acquire and a retried activate keep the same generation and state', async () => {
  const base = await sql()
  const store = dialed(base)
  const host = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  store.loseAfter = 1 // the database assigned a generation, the answer never came back
  assert.equal(await host.acquire(), 'starting')
  const rows = (await db.query('SELECT generation FROM public.world_presence_hosts WHERE host_id = $1', [host.hostId])).rows
  assert.equal(rows.length, 1, 'one row: the retry did not create a second host')
  assert.equal(Number(rows[0].generation), host.generation)
  store.loseAfter = 1 // activated, answer lost
  assert.equal(await host.activate(), 'active')
  assert.equal(await hostRow(host.generation), 'active')
  assert.deepEqual(store.calls.filter(c => c === 'presenceActivate').length, 2)
  await host.stop()
})

test('two concurrent candidates: the newer one activates, the older is refused and stops (never active)', async () => {
  const store = await sql()
  const older = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  const newer = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await older.acquire()
  await newer.acquire()
  assert.equal(await newer.activate(), 'active')
  assert.equal(await older.activate(), 'stopped')
  assert.equal(older.counters.activation, 'newer_active')
  assert.equal(await hostRow(older.generation), 'stopped')
  assert.equal(older.sessionKey(), null)
  assert.equal(await older.whenActive(10), false)
  await newer.stop()
})

test('a slow candidate whose starting lease ran out can never activate', async () => {
  const store = await sql()
  const slow = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await slow.acquire()
  await db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [slow.generation])
  assert.equal(await slow.activate(), 'stopped')
  assert.equal(slow.counters.activation, 'host_expired')
})

test('a newer active host: the old one learns on its renew (bounded by renew + RTT), once, and decides to drain', async () => {
  const store = await sql()
  const old = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await old.acquire(); await old.activate()
  const seen = []
  old.onNewerActive = () => seen.push('newer')
  const fresh = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await fresh.acquire(); await fresh.activate()
  assert.equal(await hostRow(old.generation), 'active', 'activation does not touch the old host in the same transaction')
  await old.renew()
  await old.renew()
  assert.deepEqual(seen, ['newer'], 'reported once')
  assert.equal(await old.drain(), 'draining')
  assert.equal(old.canClaim, false)
  assert.equal(old.canSave, true, 'its final flush')
  assert.equal(old.admitting, false)
  assert.equal(await old.whenActive(10), false)
  assert.equal(await hostRow(old.generation), 'draining')
  // Draining never returns to active, stopped is terminal.
  assert.equal(await old.activate(), 'draining')
  assert.equal(await old.stop(), 'stopped')
  assert.equal(await old.activate(), 'stopped')
  assert.equal(await old.drain(), 'stopped')
  assert.equal(await hostRow(old.generation), 'stopped')
  await fresh.stop()
})

test('an expired lease pauses claims and saves; a renew revives it; repeated expiry drains', async () => {
  const store = await sql()
  const expired = []
  const host = new HostLifecycle({ store, renewMs: 60_000, expiredRenewals: 2, onExpired: () => expired.push(1), ...quiet })
  await host.acquire(); await host.activate()
  host.observe({ status: 'host_expired' })
  assert.equal(host.canClaim, false, 'paused at once')
  assert.equal(host.canSave, false)
  await host.renew() // the database lease is still live: revived
  assert.equal(host.canClaim, true)
  // A newer host is active while this lease runs out: renew does not revive it.
  const newer = new HostLifecycle({ store, renewMs: 60_000, ...quiet })
  await newer.acquire(); await newer.activate()
  await db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [host.generation])
  await host.renew()
  assert.equal(host.paused, true)
  await host.renew()
  assert.equal(expired.length, 1, 'gives up after the configured renewals: the room drains')
  await host.stop(); await newer.stop()
})

test('refused answers end or pause the host without retry loops', async () => {
  const unknown = activeHost()
  unknown.observe({ status: 'unknown_host' })
  assert.equal(unknown.state, 'stopped')
  const inactive = activeHost()
  inactive.observe({ status: 'host_inactive', state: 'draining' })
  assert.equal(inactive.state, 'draining')
  inactive.observe({ status: 'host_inactive', state: 'stopped' })
  assert.equal(inactive.state, 'stopped')
  const newer = []
  const host = activeHost()
  host.onNewerActive = () => newer.push(1)
  for (let i = 0; i < 5; i++) host.observe({ status: 'ok', newerActive: true })
  assert.equal(newer.length, 1)
})

test('no database within the wait: serves without persistence, keeps trying, and activates when it can', async () => {
  const base = await sql()
  const store = dialed(base)
  store.failBefore = 3
  let ticks = 0
  // The injected sleep yields to the loop; stop() in finally ends the background retries even if an assertion fails.
  const host = new HostLifecycle({ store, renewMs: 60_000, log: () => {}, sleep: () => { ticks++; return new Promise(resolve => setImmediate(resolve)) } })
  try {
    assert.equal(await host.acquire({ waitMs: 0 }), 'unavailable')
    assert.equal(host.admitting, true, 'the game goes on')
    assert.equal(host.sessionKey(), null, 'sessions do not persist')
    assert.equal(await host.whenActive(10), true)
    for (let i = 0; i < 200 && host.state !== 'active'; i++) await new Promise(resolve => setImmediate(resolve))
    assert.equal(host.state, 'active', 'acquired and activated in the background')
    assert.ok(ticks > 0)
  } finally {
    await host.stop()
  }
})

test('stats are aggregates: no host id', () => {
  const host = activeHost({ generation: 7, hostId: 'a0000000-0000-4000-8000-0000000000ff' })
  host.sessionKey()
  assert.doesNotMatch(JSON.stringify(host.stats()), /a0000000/)
  assert.equal(host.stats().accepted, 1)
})
