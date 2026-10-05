import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MESSAGE } from '../protocol/messages.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { HOST_DRAINING_CODE, SESSION_REPLACED_CODE } from '../protocol/closeCodes.js'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { layoutVersion } from '../world/layoutVersion.js'
import { lastMessage } from '../world/testing.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'

// CLOUD READINESS-3 — presence recovery in the real room and host lifecycle, on one embedded
// Postgres with every migration (the recovery one included). Each test runs its own copy of the
// room module (its own hosting, capability and standby), so two copies are two processes sharing
// the database. Real clock; the only time travel is the table owner moving a lease into the past.

const ROLLBACK = fileURLToPath(new URL('../../../../scripts/world-location/rollback_world_presence_recovery.sql', import.meta.url))
const PRADERA = { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty }

let db = null
let data = null
test.after(async () => { await db?.close() })
let users = 0
const nextUser = () => `eeeeeeee-0000-4000-8000-${String(++users).padStart(12, '0')}`
let instances = 0

async function database() {
  if (!db) { db = await openLocalDatabase(); data = createSqlPlayerData(serviceQuery(db)) }
  return data
}
// Every host a test creates is stopped after it: a host left active would be "another active host" for the next test.
// Databases a single test opens are closed after every host that used them stopped.
const created = []
const locals = []
test.afterEach(async () => {
  for (const h of created.splice(0)) await h.stop()
  for (const local of locals.splice(0)) await local.close()
})
const quietHost = (store, options = {}) => { const h = new HostLifecycle({ store, renewMs: 600_000, leaseMs: 15_000, log: () => {}, ...options }); created.push(h); return h }
async function activeHost(store = data) { const h = quietHost(store); await h.acquire(); await h.activate(); return h }
const expire = host => db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [host.generation])
const hostState = async generation => (await db.query('SELECT state FROM public.world_presence_hosts WHERE generation = $1', [generation])).rows[0]?.state
const activeGenerations = async () => (await db.query("SELECT generation::int AS g FROM public.world_presence_hosts WHERE state = 'active' AND lease_expires_at > now() ORDER BY 1")).rows.map(r => r.g)
async function waitFor(condition, label, ms = 4_000) {
  const started = performance.now()
  while (!(await condition())) {
    if (performance.now() - started > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

/** A newer host X that owns `userId`'s row with `place` saved (its claim and save are ordinary v1 keyed calls). */
async function ownedBy(userId, place = PRADERA, version = layoutVersion(place.areaId)) {
  await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
  const X = await activeHost()
  const claim = await data.locationClaim(userId, X.sessionKey())
  assert.equal(claim.status, 'claimed')
  const saved = await data.locationSave([{ userId, epoch: claim.epoch, seq: 1, ...place, layoutVersion: version }], X.identity)
  assert.equal(saved.results.get(userId), 'applied')
  return X
}

/** A spy over the SQL adapter: counts v1 and v2 claims (with their keys) and capability probes. */
function spy(base) {
  const calls = { v1: [], v2: [], probes: 0, anyActive: 0, exclusive: 0, gate: null }
  // The spy's own fields live here, never on `base` (the adapter is shared by every test of the file).
  const store = new Proxy(base, {
    set(_target, property, value) { if (property !== 'gate') throw new Error(`spy: ${String(property)} is read-only`); calls.gate = value; return true },
    get(target, property) {
      if (property === 'calls') return calls
      if (property === 'gate') return calls.gate
      if (property === 'locationClaim') return async (userId, key) => { calls.v1.push({ ...key }); return target.locationClaim(userId, key) }
      if (property === 'locationClaimV2') return async (userId, key, options) => { calls.v2.push({ ...key, takeover: options?.takeover === true }); return target.locationClaimV2(userId, key, options) }
      if (property === 'capabilities') return async () => { calls.probes++; return target.capabilities() }
      if (property === 'presenceAnyActive') return async () => { calls.anyActive++; return target.presenceAnyActive() }
      if (property === 'presenceActivateExclusive') return async (...args) => { calls.exclusive++; return (calls.gate ? calls.gate() : Promise.resolve()).then(() => target.presenceActivateExclusive(...args)) }
      return Reflect.get(target, property)
    },
  })
  return store
}

/**
 * One room process: its own module copy, a host acquired NOW (so older than any host created after
 * it), recovery requested or not. `react: false` models the window before this host renews.
 */
async function processWith(t, { mode = 'on', recovery = true, store: given = null, react = false } = {}) {
  await database()
  const store = given ?? spy(data)
  const module = await import(new URL(`./PresenceRoom.js?instance=recovery-${++instances}`, import.meta.url).href)
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  const capability = module.configurePresenceRecovery({ requested: recovery, store, log: () => {} })
  await capability.probe()
  const host = quietHost(store)
  await host.acquire(); await host.activate()
  module.configurePresenceHost(host, { reactToHostChanges: react, store })
  const service = module.configureLocationPersistence({ mode, store, host, now: () => Date.now(), hydrationTimeoutMs: 1_000 })
  service.journal?.stop()
  const room = new module.PresenceRoom()
  room.onCreate()
  const hosting = module.presenceHostingForTesting()
  const clients = []
  t.after(async () => {
    hosting.beginShutdown()
    await hosting.standbyIdle()
    for (const c of clients) room.onLeave(c)
    room.setSimulationInterval(null)
    room.clock.clear()
    module.configureLocationPersistence({ mode: 'off' })
    await hosting.host?.stop()
    module.configurePresenceHost(null)
    await host.stop()
  })
  const join = async (userId, options = {}) => {
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    const c = { sessionId: `${userId}-${clients.length}`, userData: undefined, messages: [], leaves: [], send(type, payload) { this.messages.push({ type, payload }) }, leave(code, reason) { this.leaves.push([code, reason]) } }
    clients.push(c)
    await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: 'tab-page-0001', ...options }, { kind: 'player', userId, username: 'P', token: null })
    room.ready(c)
    return c
  }
  const placedAt = c => { const s = lastMessage(c, MESSAGE.SNAPSHOT)?.payload?.self ?? lastMessage(c, MESSAGE.SNAPSHOT)?.self; return s && { areaId: s.areaId, tx: s.tx, ty: s.ty } }
  const closing = c => c.messages.filter(m => m.type === MESSAGE.CLOSING).map(m => m.payload.reason)
  const settled = c => waitFor(() => c.leaves.length > 0 || placedAt(c), 'the join to settle')
  return { module, store, host, service, room, hosting, capability, join, placedAt, closing, settled }
}

// ── P1/P3: close mapping and explicit takeover ───────────────────────────────

test('D2-B fixed: the row of a STOPPED owner is restored on resume (no 4409); with recovery off the same case is the false 4409 (control)', async t => {
  for (const recovery of [true, false]) {
    const p = await processWith(t, { recovery })
    const u = nextUser()
    const X = await ownedBy(u)
    await X.drain(); await X.stop()
    const c = await p.join(u, { resume: true })
    await p.settled(c)
    if (recovery) {
      assert.deepEqual(p.placedAt(c), PRADERA, 'restored at the stopped owner\'s last tile')
      assert.deepEqual(c.leaves, [])
    } else {
      assert.deepEqual(c.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'WORLD LOCATION-4 today: superseded → 4409 although no other tab exists')
    }
  }
})

test('P1/P3: an UNREACHABLE owner (lease ran out) — resume and plain fresh joins get 4503 owner-unreachable and write nothing; only «Jugar acá» (fresh + takeover) takes the row', async t => {
  const p = await processWith(t)
  const u = nextUser()
  const X = await ownedBy(u)
  await expire(X)
  const before = (await db.query('SELECT epoch::int, owner_generation::int AS og FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0]
  for (const options of [{ resume: true }, {}, { resume: true, takeover: true }]) {
    const c = await p.join(u, options)
    await p.settled(c)
    assert.deepEqual(c.leaves, [[HOST_DRAINING_CODE, 'owner-unreachable']], JSON.stringify(options))
    assert.deepEqual(p.closing(c), ['owner-unreachable'])
    p.room.onLeave(c)
  }
  assert.deepEqual((await db.query('SELECT epoch::int, owner_generation::int AS og FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0], before, 'nothing written')
  assert.equal(p.store.calls.v2.filter(k => k.takeover).length, 0, 'a resume never sends a takeover')
  const playHere = await p.join(u, { takeover: true })
  await p.settled(playHere)
  assert.deepEqual(p.placedAt(playHere), PRADERA, '«Jugar acá» restores the last confirmed tile')
  assert.equal(p.store.calls.v2.at(-1).takeover, true)
})

test('a DRAINING owner: 4503 draining (retry), never 4409; its flush is kept', async t => {
  const p = await processWith(t)
  const u = nextUser()
  const X = await ownedBy(u)
  await X.drain()
  const c = await p.join(u, { resume: true })
  await p.settled(c)
  assert.deepEqual(c.leaves, [[HOST_DRAINING_CODE, 'host-draining']])
  assert.deepEqual(p.closing(c), ['draining'])
})

test('a LIVE owner on a newer host: 4503 draining with recovery (this host is stale); 4409 without it (control)', async t => {
  for (const recovery of [true, false]) {
    const p = await processWith(t, { recovery })
    const u = nextUser()
    await ownedBy(u)
    const c = await p.join(u, { resume: true })
    await p.settled(c)
    assert.deepEqual(c.leaves.map(l => l[0]), [recovery ? HOST_DRAINING_CODE : SESSION_REPLACED_CODE])
  }
})

test('P2: a restored row is validated as any restore: a stale layout is repaired to the area arrival', async t => {
  const p = await processWith(t)
  const u = nextUser()
  const X = await ownedBy(u, { areaId: 'pradera', tx: 3, ty: -60 }, '1.000000000000')
  await X.drain(); await X.stop()
  const c = await p.join(u, { resume: true })
  await p.settled(c)
  assert.deepEqual(p.placedAt(c), PRADERA)
  assert.equal(p.service.stats().repairs.layout, 1)
})

test('shadow: the same answers change nothing a player sees (placed, no close), only counters', async t => {
  const p = await processWith(t, { mode: 'shadow' })
  const u = nextUser()
  const X = await ownedBy(u)
  await expire(X)
  const c = await p.join(u, { resume: true })
  await waitFor(() => p.service.journal.stats().claims.ownerUnreachable === 1, 'the v2 answer')
  assert.deepEqual(c.leaves, [])
  assert.deepEqual(p.placedAt(c), { areaId: 'ciudad-corazon', tx: 31, ty: 20 }, 'shadow restores nothing')
})

// ── P5: kill switch and capability fallback ──────────────────────────────────

test('kill switch off: no probe, no v2 call, no standby — exactly the WORLD LOCATION-4 behaviour', async t => {
  const p = await processWith(t, { recovery: false })
  const u = nextUser()
  await ownedBy(u)
  const c = await p.join(u, { resume: true })
  await p.settled(c)
  assert.equal(p.capability.state, 'off')
  assert.deepEqual([p.store.calls.probes, p.store.calls.v2.length], [0, 0])
  assert.ok(p.store.calls.v1.length >= 1)
})

test('capability rollback under a live process: the SQL disappears → one v2 call fails as unsupported, the SAME key is claimed once through v1, recovery stays off', async t => {
  const local = await openLocalDatabase()
  locals.push(local)
  const store = spy(createSqlPlayerData(serviceQuery(local)))
  await local.exec("INSERT INTO auth.users VALUES ('eeeeeeee-0000-4000-8000-999999999999')")
  const module = await import(new URL(`./PresenceRoom.js?instance=recovery-${++instances}`, import.meta.url).href)
  const capability = module.configurePresenceRecovery({ requested: true, store, log: () => {} })
  assert.equal(await capability.probe(), 'enabled')
  await local.exec(await readFile(ROLLBACK, 'utf8'))   // rollback order violated on purpose: SQL first
  const host = quietHost(store); await host.acquire(); await host.activate()
  const { withRecovery } = await import('../presence/recoveryCapability.js')
  const journalStore = withRecovery(store, capability)
  const key = host.sessionKey()
  const answer = await journalStore.locationClaim('eeeeeeee-0000-4000-8000-999999999999', key)
  assert.equal(answer.status, 'claimed')
  assert.deepEqual(store.calls.v2.map(k => k.seq), [key.seq])
  assert.deepEqual(store.calls.v1.map(k => k.seq), [key.seq], 'one v1 retry with the same key')
  assert.equal(capability.state, 'disabled')
  await journalStore.locationClaim('eeeeeeee-0000-4000-8000-999999999999', host.sessionKey())
  assert.equal(store.calls.v2.length, 1, 'never v2 again in this process')
  assert.equal(await capability.probe(), 'disabled', 'no flapping: a new probe does not re-enable')
})

// ── P4: standby with a NEW identity ─────────────────────────────────────────

/** A process whose host was displaced by a newer X (the reaction of WORLD LOCATION-4), in standby. */
async function displaced(t, options = {}) {
  const p = await processWith(t, { react: true, ...options })
  const X = await activeHost()
  await p.host.renew()                                    // hears newerActive → drain → displaced
  await waitFor(() => p.hosting.displaced, 'displacement')
  return { p, X }
}

test('D2-A: the displaced process recovers with a NEW identity once no host is active; the displaced identity stays stopped', async t => {
  const { p, X } = await displaced(t)
  assert.ok(p.hosting.standby, 'in standby')
  assert.equal(p.hosting.serving, false)
  await X.drain(); await X.stop()                         // the agent stops the other slot
  await p.hosting.probeStandbyNow()
  const promoted = p.hosting.host
  assert.notEqual(promoted, p.host)
  assert.ok(promoted.generation > X.generation, 'a new generation, the newest')
  assert.equal(await hostState(p.host.generation), 'stopped', 'the displaced identity never comes back')
  assert.deepEqual(await activeGenerations(), [promoted.generation])
  assert.equal(p.hosting.serving, true)
  assert.equal(p.hosting.draining, false)
  const c = await p.join(nextUser())
  await p.settled(c)
  assert.deepEqual(c.leaves, [], 'admits again')
  t.after(() => promoted.stop())
})

test('standby never promotes while another host is active; a booting lower candidate makes it step aside (identity stopped)', async t => {
  const { p, X } = await displaced(t)
  await p.hosting.probeStandbyNow()
  assert.equal(p.hosting.standbyCounters.promotions, 0, 'X is active')
  await X.drain(); await X.stop()
  const C = quietHost(data); await C.acquire()           // a deploy candidate booting (lower than the standby's next identity)
  await p.hosting.probeStandbyNow()
  assert.deepEqual([p.hosting.standbyCounters.promotions, p.hosting.standbyCounters.refused], [0, 1])
  assert.ok(p.hosting.standby, 'still in standby')
  assert.equal(await C.activate(), 'active', 'the candidate is not displaced by the standby')
  await p.hosting.probeStandbyNow()
  assert.equal(p.hosting.standbyCounters.promotions, 0)
  t.after(() => C.stop())
})

test('SIGINT before the probe: no standby work at all', async t => {
  const { p, X } = await displaced(t)
  await X.drain(); await X.stop()
  p.hosting.beginShutdown()
  await p.hosting.probeStandbyNow()
  assert.equal(p.hosting.standby, null)
  assert.deepEqual(await activeGenerations(), [])
})

test('SIGINT during the promotion: the late activation is never installed and its new identity is stopped', async t => {
  const store = spy(await database())
  let release
  const reached = new Promise(resolve => { store.gate = () => { resolve(); return new Promise(r => { release = r }) } })
  const { p, X } = await displaced(t, { store })
  await X.drain(); await X.stop()
  const probing = p.hosting.probeStandbyNow()
  await reached                                          // the exclusive activation is in flight
  const candidate = (await db.query('SELECT max(generation)::int AS g FROM public.world_presence_hosts')).rows[0].g
  p.hosting.beginShutdown()                              // SIGINT
  // The process may exit before its activation answers: the stop reaches the database first, outside the lane.
  await waitFor(async () => (await hostState(candidate)) === 'stopped', 'the stop', 2_000).catch(() => {})
  assert.equal(await hostState(candidate), 'stopped', 'the abandoned identity is stopped before its activation lands')
  release()
  await probing
  await p.hosting.stopForShutdown()
  assert.equal(p.hosting.host, p.host, 'nothing installed')
  assert.deepEqual(await activeGenerations(), [], 'the new identity does not serve')
  assert.equal(p.hosting.standbyCounters.abandoned >= 1, true)
})

test('two displaced processes: exactly one recovers, the other refuses (no alternation)', async t => {
  const a = await processWith(t, { react: true })
  const b = await processWith(t, { react: true })
  const X = await activeHost()
  await a.host.renew(); await b.host.renew()
  await waitFor(() => a.hosting.displaced && b.hosting.displaced, 'both displaced')
  await X.drain(); await X.stop()
  await Promise.all([a.hosting.probeStandbyNow(), b.hosting.probeStandbyNow()])
  const promotions = a.hosting.standbyCounters.promotions + b.hosting.standbyCounters.promotions
  assert.equal(promotions, 1)
  assert.equal((await activeGenerations()).length, 1)
})

test('kill switch off: a displaced process never enters standby', async t => {
  const { p } = await displaced(t, { recovery: false })
  assert.equal(p.hosting.standby, null)
  assert.equal(p.store.calls.anyActive, 0)
})

test('recovery SQL removed while in standby: the probe answers unsupported, the standby ends and recovery is off', async t => {
  const local = await openLocalDatabase()
  locals.push(local)
  const store = spy(createSqlPlayerData(serviceQuery(local)))
  const p = await processWith(t, { react: true, store })
  const X = quietHost(store); await X.acquire(); await X.activate()
  await p.host.renew()
  await waitFor(() => p.hosting.displaced, 'displacement')
  await local.exec(await readFile(ROLLBACK, 'utf8'))
  await p.hosting.probeStandbyNow()
  assert.equal(p.hosting.standby, null)
  assert.equal(p.capability.state, 'disabled')
})
