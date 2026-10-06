import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import process from 'node:process'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { MESSAGE } from '../protocol/messages.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { layoutVersion } from '../world/layoutVersion.js'

// Investigation only. Unmodified room, lifecycle, adapter and migrations.
// Real SQL now(); expiry is injected ONLY into our in-memory database.
// Lifecycle timers are replaced by explicit renew/probe calls, not death detection.
// Journal timers are stopped in every case: H1/checkpoint recovery is outside this suite.
const out = new URL('../../../../docs/design/cloud-h2/evidence/', import.meta.url)
const evidence = { base: '886ff4d', node: process.version, scenarios: [] }
let instance = 0
test.after(async () => {
  await mkdir(out, { recursive: true })
  await writeFile(new URL('deterministic.json', out), JSON.stringify(evidence, null, 2) + '\n')
})

async function until(predicate, label) {
  const deadline = performance.now() + 3000
  while (!(await predicate())) {
    if (performance.now() >= deadline) throw new Error(`timeout: ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function world(t, name, { mode = 'on', recovery = true } = {}) {
  const db = await openLocalDatabase()
  const base = createSqlPlayerData(serviceQuery(db))
  const trace = { name, mode, recovery, events: [], snapshots: [] }
  evidence.scenarios.push(trace)
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
    const p = { label, clients: [], failRenew: false, beforeExclusive: null }
    p.store = new Proxy(base, {
      get(target, key) {
        const value = Reflect.get(target, key)
        if (typeof value !== 'function' || !String(key).startsWith('presence')) return value
        return async (...args) => {
          if (key === 'presenceRenew' && p.failRenew) {
            trace.events.push({ process: label, op: key, fault: 'transport unavailable', monotonic })
            throw new Error('local injected outage')
          }
          if (key === 'presenceActivateExclusive' && p.beforeExclusive) {
            const action = p.beforeExclusive; p.beforeExclusive = null; await action()
          }
          const answer = await value(...args)
          trace.events.push({ process: label, op: key, generation: typeof args[0] === 'number' ? args[0] : null, answer, monotonic })
          return answer
        }
      },
    })
    p.module = await import(new URL(`./PresenceRoom.js?h2=${++instance}`, import.meta.url).href)
    p.module.configureWorld({ skills: createDemoSkillPolicy(), ownership: createStaticOwnership({}) })
    const capability = p.module.configurePresenceRecovery({ requested: recovery, store: p.store, log: () => {} })
    await capability.probe()
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
    p.join = async (userId = randomUUID(), options = {}) => {
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
  const hosts = async () => (await db.query('SELECT generation::int AS generation, state, lease_expires_at > now() AS live FROM public.world_presence_hosts ORDER BY generation')).rows
  const snap = async (label, ...ps) => {
    const snapshot = { label, monotonic, hosts: await hosts(), processes: ps.map(p => ({ label: p.label, ...p.hosting.stats(), serving: p.hosting.serving, wouldDrain: p.service.counters.shadow.wouldDrain, clients: p.clients.map(c => ({ placed: placed(c), refused: c.refused, leaves: c.leaves, closing: c.messages.filter(m => m.type === MESSAGE.CLOSING).map(m => m.payload.reason) })) })) }
    trace.snapshots.push(snapshot)
    return snapshot
  }
  async function expire(p, elapsed = 16000) {
    monotonic += elapsed
    await db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [p.hosting.host.generation])
    trace.events.push({ process: p.label, op: 'test-only-expire', monotonic, elapsed })
    p.failRenew = true
    await p.hosting.host.renew()
    p.failRenew = false
    assert.equal(p.hosting.host.paused, true)
  }
  return { processWith, hosts, snap, expire, trace, db }
}

function placed(c) { return c.messages.some(m => m.type === MESSAGE.SNAPSHOT && m.payload?.self) }
async function pair(w, options) {
  const S = await w.processWith('S', options)
  const A = await w.processWith('A')
  if (options?.activate === false) await S.original.activate()
  else await S.original.renew()
  if (S.service.restores || options?.activate === false) await until(() => S.hosting.displaced, 'S displaced')
  return { S, A }
}

test('H2 on: standby wins before live routed A renews; A closes 4503 and routed retries fail', async t => {
  const w = await world(t, 'on-promotion-first')
  const { S, A } = await pair(w)
  const client = await A.join()
  assert.equal(placed(client), true)
  await w.expire(A)
  assert.equal(client.leaves.length, 0, 'expiry/outage alone did not close existing socket')
  await w.snap('expired but process alive, socket present', S, A)
  await S.hosting.probeStandbyNow()
  assert.equal(S.hosting.standbyCounters.promotions, 1)
  await A.original.renew()
  await until(() => A.hosting.displaced, 'A displaced')
  assert.deepEqual(client.leaves.map(x => x.code), [4503])
  assert.deepEqual(client.messages.filter(m => m.type === MESSAGE.CLOSING).map(m => m.payload.reason), ['draining'])
  const retry = await A.join(undefined, { resume: true })
  assert.equal(retry.refused, 4503, 'fixed route to A cannot recover')
  const direct = await S.join()
  assert.equal(placed(direct), true, 'promoted S admits if explicitly selected')
  await A.hosting.probeStandbyNow()
  assert.equal(A.hosting.standbyCounters.promotions, 0, 'S stays live; A stays standby')
  await w.snap('S promoted, A displaced; fixed route still A', S, A)
})

test('H2 off: same live A expiry is recoverable, S never promotes and A keeps socket', async t => {
  const w = await world(t, 'off-control', { recovery: false })
  const { S, A } = await pair(w)
  const client = await A.join()
  await w.expire(A)
  await S.hosting.probeStandbyNow()
  assert.equal(S.hosting.standby, null)
  await A.original.renew()
  assert.equal(A.original.paused, false)
  assert.equal(A.hosting.serving, true)
  assert.deepEqual(client.leaves, [])
  assert.equal(S.hosting.standbyCounters.promotions, 0)
  await w.snap('A revived same identity, existing socket intact', S, A)
})

test('H2 on: A renewal before probe prevents promotion', async t => {
  const w = await world(t, 'on-renew-first')
  const { S, A } = await pair(w)
  const client = await A.join()
  await w.expire(A)
  await A.original.renew()
  await S.hosting.probeStandbyNow()
  assert.equal(S.hosting.standbyCounters.promotions, 0)
  assert.deepEqual(client.leaves, [])
  assert.equal(A.hosting.serving, true)
  await w.snap('A renews first; probe sees live lease', S, A)
})

test('exclusive activation rechecks after false probe: A renews in between, candidate refuses', async t => {
  const w = await world(t, 'probe-activate-gap')
  const { S, A } = await pair(w)
  const client = await A.join()
  await w.expire(A)
  S.beforeExclusive = () => A.original.renew()
  await S.hosting.probeStandbyNow()
  assert.equal(S.hosting.standbyCounters.promotions, 0)
  assert.equal(S.hosting.standbyCounters.refused, 1)
  assert(w.trace.events.some(e => e.answer?.status === 'other_active'))
  assert.deepEqual(client.leaves, [])
  await w.snap('probe false, renewal, exclusive refuses other_active', S, A)
})

test('SQL guarantees: expired A cannot claim, save or obtain a new draining flush lease', async t => {
  const w = await world(t, 'expired-writer-fenced')
  const A = await w.processWith('A')
  const userId = randomUUID()
  await w.db.query('INSERT INTO auth.users VALUES ($1)', [userId])
  const key = A.original.sessionKey()
  const claim = await A.store.locationClaim(userId, key)
  assert.equal(claim.status, 'claimed')
  const row = { userId, epoch: claim.epoch, seq: 1, areaId: 'pradera', ...ARRIVALS.pradera, layoutVersion: layoutVersion('pradera') }
  assert.equal((await A.store.locationSave([row], A.original.identity)).results.get(userId), 'applied')
  const read = async () => (await w.db.query('SELECT epoch, seq, area_id, tx, ty, owner_generation FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0]
  const before = await read()
  await w.expire(A)
  const save = await A.store.locationSave([{ ...row, seq: 2, tx: row.tx + 1 }], A.original.identity)
  const refusedClaim = await A.store.locationClaim(userId, A.original.sessionKey())
  const drain = await A.store.presenceDrain(A.original.generation, A.original.hostId, 10000)
  assert.equal(save.status, 'host_expired')
  assert.equal(refusedClaim.status, 'host_expired')
  assert.equal(drain.status, 'host_expired')
  assert.deepEqual(await read(), before, 'persistent row stays at last confirmed position')
  w.trace.events.push({ op: 'expired-writer-checks', saveStatus: save.status, claimStatus: refusedClaim.status, drainStatus: drain.status, rowUnchanged: true })
  await w.snap('fenced writes preserve confirmed row; this does not route S', A)
})

for (const recovery of [true, false]) {
  test(`confirmed stop control: recovery=${recovery}`, async t => {
    const w = await world(t, `confirmed-stop-${recovery}`, { recovery })
    const { S, A } = await pair(w)
    await A.original.stop()
    await S.hosting.probeStandbyNow()
    assert.equal(S.hosting.standbyCounters.promotions, recovery ? 1 : 0)
    const live = (await w.hosts()).filter(h => h.state === 'active' && h.live)
    assert.equal(live.length, recovery ? 1 : 0)
    await w.snap('explicit terminal stop, not inferred from expiry', S, A)
  })
}

test('finite grace counterexample: delayed live A renews after 1s, 30s or 120s additional silence', async t => {
  for (const grace of [1000, 30000, 120000]) {
    const w = await world(t, `grace-counterexample-${grace}`)
    const { S, A } = await pair(w)
    const client = await A.join()
    await w.expire(A, 15000 + grace)
    await S.hosting.probeStandbyNow()
    await A.original.renew()
    await until(() => A.hosting.displaced, 'A displaced after finite silence')
    assert.deepEqual(client.leaves.map(x => x.code), [4503])
    await w.snap('live A responds after arbitrary finite silence', S, A)
  }
})

test('shadow normal displacement: wouldDrain only, no standby; expiry alone does not reproduce on topology', async t => {
  const w = await world(t, 'shadow-active-displacement', { mode: 'shadow' })
  const { S, A } = await pair(w)
  const client = await A.join()
  assert.equal(S.service.counters.shadow.wouldDrain, 1)
  assert.equal(S.hosting.standby, null)
  await w.expire(A)
  await S.hosting.probeStandbyNow()
  await A.original.renew()
  assert.equal(A.hosting.serving, true)
  assert.equal(A.original.paused, false)
  assert.deepEqual(client.leaves, [])
  await w.snap('shadow keeps older host active; no standby formed', S, A)
})

test('shadow activation-refused standby CAN promote; A counts wouldDrain, stays serving without live lease', async t => {
  const w = await world(t, 'shadow-refused-candidate', { mode: 'shadow' })
  const { S, A } = await pair(w, { activate: false })
  const client = await A.join()
  assert.notEqual(S.hosting.standby, null)
  await w.expire(A)
  await S.hosting.probeStandbyNow()
  assert.equal(S.hosting.standbyCounters.promotions, 1)
  await A.original.renew()
  assert.equal(A.service.counters.shadow.wouldDrain, 1)
  assert.equal(A.original.paused, true)
  assert.equal(A.hosting.serving, true)
  assert.deepEqual(client.leaves, [])
  const newClient = await A.join()
  assert.equal(placed(newClient), true)
  assert.equal((await w.hosts()).find(h => h.generation === A.original.generation).live, false)
  await w.snap('shadow A continues visible play, paused authority; S holds lease', S, A)
})
