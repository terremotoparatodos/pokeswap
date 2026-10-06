import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { HostLifecycle } from '../presence/hostLifecycle.js'
// A namespace import, so the same file runs as a negative control against a tree without the switch (assertions fail, not the import).
import * as recoveryCapability from '../presence/recoveryCapability.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { MESSAGE } from '../protocol/messages.js'

// H2 containment (docs/design/CLOUD_H2_STANDBY_CONTAINMENT_REPORT.md) — acceptance tests AT-1, AT-2, AT-3, AT-5
// and AT-9 in the real room, hosting, lifecycle, adapter and SQL (embedded Postgres, every migration). The world
// helper follows the independent H2 reproduction (investigation/cloud-h2-0.3 @2bab8f7, PresenceRoomH2.test.js):
// host timers are kept out of the way (long interval, explicit renew/probe calls) and a lease runs out only by
// the test moving it into the past IN ITS OWN in-memory database. No grace, no timeout decides anything here.

let instance = 0
async function until(predicate, label) {
  const deadline = performance.now() + 3000
  while (!(await predicate())) {
    if (performance.now() >= deadline) throw new Error(`timeout: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}
const placed = c => c.messages.some(m => m.type === MESSAGE.SNAPSHOT && m.payload?.self)

async function world(t, { mode = 'on', recovery = true, standby = false } = {}) {
  const db = await openLocalDatabase()
  const base = createSqlPlayerData(serviceQuery(db))
  const processes = []
  let monotonic = 0
  const now = () => monotonic
  t.after(async () => {
    for (const p of processes) p.hosting.beginShutdown()
    for (const p of processes) {
      await p.hosting.standbyIdle()
      for (const c of p.clients) p.room.onLeave(c)
      p.room.setSimulationInterval(null)
      p.room.clock.clear()
      p.module.configureLocationPersistence({ mode: 'off' })
      await p.hosting.stopForShutdown()
      await p.original.stop()
    }
    await db.close()
  })
  async function processWith(label, { activate = true } = {}) {
    const p = { label, clients: [], failRenew: false, calls: { anyActive: 0, exclusive: 0 } }
    p.store = new Proxy(base, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function' || !String(key).startsWith('presence')) return value
        return async (...args) => {
          if (key === 'presenceRenew' && p.failRenew) throw new Error('local injected outage')
          if (key === 'presenceAnyActive') p.calls.anyActive++
          if (key === 'presenceActivateExclusive') p.calls.exclusive++
          return value(...args)
        }
      },
    })
    p.module = await import(new URL(`./PresenceRoom.js?h2-containment=${++instance}`, import.meta.url).href)
    p.module.configureWorld({ skills: createDemoSkillPolicy(), ownership: createStaticOwnership({}) })
    await p.module.configurePresenceRecovery({ requested: recovery, store: p.store, log: () => {} }).probe()
    p.module.configurePresenceStandby?.({ requested: standby })  // AT-9 asserts it exists
    p.hosting = p.module.presenceHostingForTesting()
    p.hosting.log = () => {}
    p.hosting.standbyProbeMs = 600000
    p.hosting.createStandbyHost = store => new HostLifecycle({ store, exclusive: true, now, renewMs: 600000, log: () => {} })
    p.original = new HostLifecycle({ store: p.store, now, renewMs: 600000, log: () => {} })
    await p.original.acquire()
    p.module.configurePresenceHost(p.original, { store: p.store })
    p.service = p.module.configureLocationPersistence({ mode, store: p.store, now, hydrationTimeoutMs: 1000 })
    p.service.journal.stop()
    p.room = new p.module.PresenceRoom()
    p.room.onCreate()
    processes.push(p)
    if (activate) await p.original.activate()
    p.join = async (options = {}) => {
      const userId = randomUUID()
      await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
      const c = { sessionId: randomUUID(), messages: [], leaves: [], refused: null,
        send(type, payload) { this.messages.push({ type, payload }) },
        leave(code, reason) { this.leaves.push({ code, reason }) },
      }
      p.clients.push(c)
      try {
        await p.room.onJoin(c, { worldProtocol: 3, presenceProtocol: 3, tabId: 'h2-tab-0001', ...options }, { kind: 'player', userId, username: 'local', token: null })
        p.room.ready(c)
        await until(() => c.leaves.length || placed(c), 'join settles')
      } catch (error) { c.refused = error.code ?? String(error) }
      return c
    }
    return p
  }
  const activeLive = async () => (await db.query("SELECT generation::int AS g FROM public.world_presence_hosts WHERE state = 'active' AND lease_expires_at > now() ORDER BY 1")).rows.map(r => r.g)
  /** The routed, live A loses its renewals for longer than its lease (test-only expiry of its own row). */
  async function expire(p) {
    monotonic += 16000
    await db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [p.hosting.host.generation])
    p.failRenew = true
    await p.hosting.host.renew()
    p.failRenew = false
    assert.equal(p.hosting.host.paused, true)
  }
  return { processWith, activeLive, expire, db }
}

/** S (older) displaced by A (newer, it serves the players): S is the process a standby would come from. */
async function pair(w, { activate = true } = {}) {
  const S = await w.processWith('S', { activate })
  const A = await w.processWith('A')
  if (!activate) await S.original.activate()
  else await S.original.renew()
  if (S.service.restores || !activate) await until(() => S.hosting.displaced, 'S displaced')
  return { S, A }
}

test('AT-1: recovery on, standby OFF — the H2 sequence does not happen: no standby, no probe, no exclusive activation; A revives its SAME identity and keeps its socket', async t => {
  const w = await world(t, { recovery: true, standby: false })
  const { S, A } = await pair(w)
  assert.equal(S.hosting.standby, null, 'no standby')
  assert.equal(S.hosting.stats().standbyCounters.notRequested, 1)
  const client = await A.join()
  assert.equal(placed(client), true)
  const generation = A.hosting.host.generation
  await w.expire(A)                                      // A alive, its lease ran out (the H2 trigger)
  await S.hosting.probeStandbyNow()                      // nothing to probe
  await A.original.renew()
  assert.deepEqual([A.hosting.host.generation, A.original.paused, A.hosting.serving], [generation, false, true], 'the same identity, serving again')
  assert.deepEqual(client.leaves, [], 'the live socket was never closed')
  assert.deepEqual(S.calls, { anyActive: 0, exclusive: 0 })
  assert.deepEqual(await w.activeLive(), [generation], 'one host, the routed one')
  assert.equal(S.hosting.stats().recovery.state, 'enabled', 'recovery itself stays enabled')
})

test('AT-2: recovery on, standby ON (isolated tests only) — H2 still exists: S promotes, the live A closes 4503 and a routed retry is refused', async t => {
  const w = await world(t, { recovery: true, standby: true })
  const { S, A } = await pair(w)
  assert.notEqual(S.hosting.standby, null)
  const client = await A.join()
  await w.expire(A)
  await S.hosting.probeStandbyNow()
  assert.equal(S.hosting.standbyCounters.promotions, 1)
  await A.original.renew()
  await until(() => A.hosting.displaced, 'A displaced')
  assert.deepEqual(client.leaves.map(x => x.code), [4503])
  assert.equal((await A.join({ resume: true })).refused, 4503, 'a retry routed to A cannot recover')
  assert.equal(S.calls.exclusive, 1)
})

for (const standby of [true, false]) {
  test(`AT-3: shadow never starts or promotes a standby (standby ${standby ? 'requested' : 'not requested'}): no probe, no exclusive activation, no new active host`, async t => {
    const w = await world(t, { mode: 'shadow', recovery: true, standby })
    const { S, A } = await pair(w, { activate: false })           // S's activation is refused (newer_active): displaced in shadow
    assert.ok(S.hosting.displaced)
    assert.equal(S.hosting.standby, null)
    assert.equal(S.hosting.stats().standbyCounters[standby ? 'wouldStandby' : 'notRequested'], 1, 'counted, not done')
    await w.expire(A)
    await S.hosting.probeStandbyNow()
    assert.deepEqual(S.calls, { anyActive: 0, exclusive: 0 })
    assert.deepEqual(await w.activeLive(), [], 'no host row became active through S (A only lost its lease)')
    assert.equal(S.hosting.standbyCounters.promotions, 0)
  })
}

test('AT-5: D2-A with standby OFF — the displaced process never promotes once no host is active: it stays alive and stopped (503); recovery needs something external', async t => {
  const w = await world(t, { recovery: true, standby: false })
  const S = await w.processWith('S')
  const X = await w.processWith('X')
  await S.original.renew()
  await until(() => S.hosting.displaced, 'S displaced')
  await X.original.drain(); await X.original.stop()
  await S.hosting.probeStandbyNow()
  assert.deepEqual(await w.activeLive(), [], 'no active host: D2-A automatic recovery is lost (documented)')
  assert.deepEqual([S.hosting.serving, S.hosting.standby, S.hosting.standbyCounters.promotions], [false, null, 0])
  const c = await S.join()
  assert.equal(c.refused, 4503, 'joins are refused with 4503, as LOCATION-4')
  assert.deepEqual(S.calls, { anyActive: 0, exclusive: 0 })
})

test('AT-9: WORLD_PRESENCE_STANDBY is exactly "on" to ask; the room reads it once at load; /metrics shows only an aggregate flag', async t => {
  const room0 = await import(new URL(`./PresenceRoom.js?h2-containment-at9=${++instance}`, import.meta.url).href)
  assert.equal(typeof room0.configurePresenceStandby, 'function', 'the room exports configurePresenceStandby')
  const { STANDBY_ENV, standbyRequested } = recoveryCapability
  assert.equal(STANDBY_ENV, 'WORLD_PRESENCE_STANDBY')
  assert.equal(standbyRequested({}), false)
  for (const value of ['ON', 'true', '1', 'yes', 'off', '']) assert.equal(standbyRequested({ WORLD_PRESENCE_STANDBY: value }), false, value)
  assert.equal(standbyRequested({ WORLD_PRESENCE_STANDBY: 'on' }), true)
  // Read ONCE at load (review F3): in ONE child process, import the room, read the value, change the environment to
  // the opposite, read again. The capture must hold, while the changed environment really reads differently.
  const room = new URL(`file:///${fileURLToPath(new URL('./PresenceRoom.js', import.meta.url)).replace(/\\/g, '/')}`).href
  const capability = new URL(`file:///${fileURLToPath(new URL('../presence/recoveryCapability.js', import.meta.url)).replace(/\\/g, '/')}`).href
  const child = `const m = await import(${JSON.stringify(room)})
const c = await import(${JSON.stringify(capability)})
const h = m.presenceHostingForTesting()
const initial = h.standbyRequested
process.env.WORLD_PRESENCE_STANDBY = initial ? 'off' : 'on'
const envNow = c.standbyRequested(process.env)
const after = m.presenceHostingForTesting().standbyRequested
console.log(JSON.stringify({ initial, after, envNow }))
process.exit(0)`
  const inChild = value => {
    const env = { PATH: process.env.PATH, Path: process.env.Path, SystemRoot: process.env.SystemRoot, ...(value === undefined ? {} : { WORLD_PRESENCE_STANDBY: value }) }
    const r = spawnSync(process.execPath, ['--input-type=module', '-e', child], { encoding: 'utf8', env, timeout: 60_000 })
    return JSON.parse(r.stdout.trim().split(/\r?\n/).at(-1))
  }
  for (const value of [undefined, 'on', 'ON', 'On', ' on', 'on ', 'true', '1', 'yes', 'off', '']) {
    const expected = value === 'on'
    const label = value === undefined ? 'unset' : JSON.stringify(value)
    assert.deepEqual(inChild(value), { initial: expected, after: expected, envNow: !expected }, `${label}: captured at load (${expected ? 'on' : 'off'}), kept after the environment changed`)
  }
  const w = await world(t, { recovery: true, standby: false })
  const { S } = await pair(w)
  const stats = S.hosting.stats()
  assert.equal(stats.standbyEnabled, false)
  assert.deepEqual(Object.keys(stats.standbyCounters).sort(), ['abandoned', 'notRequested', 'probeFailures', 'probes', 'promotions', 'refused', 'started', 'wouldStandby'])
})
