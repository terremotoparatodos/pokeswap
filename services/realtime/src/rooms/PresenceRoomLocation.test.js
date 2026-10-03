import test from 'node:test'
import assert from 'node:assert/strict'
import * as instanceA from './PresenceRoom.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { MESSAGE } from '../protocol/messages.js'
import { RECONNECT_GRACE_MS } from '../presence/reconnectCache.js'
import { HYDRATION_TIMEOUT_MS, SESSION_REPLACED } from '../presence/locationService.js'
import { CHECKPOINT_JITTER_MS, CHECKPOINT_MS } from '../presence/locationJournal.js'
import { cavesIn } from '../world/caves.js'
import { caveInterior } from '../world/caveLayouts.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { layoutVersion } from '../world/layoutVersion.js'
import { PRADERA_RETURN_PAD, portalTo } from '../world/navigation.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { lastMessage, messagesOf, openDirection, praderaNodesNearSpawn, routeBetween, settle } from '../world/testing.js'
import { standableTile, workPlacement } from '../world/workPlacement.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from '../world/worldProtocol.js'

// WORLD LOCATION-2, commit 6 (keyed by WORLD LOCATION-4): persisted locations inside the
// presence room, against the real migrations on an embedded Postgres shared by the file.
// Each room runs with a real presence host (acquired and activated on that database), so
// every session claims with its key; a room created later has a newer host.
// Matrix (WORLD_LOCATION_1_AUDIT §7) cases 1–3, 5, 10, 12–14, 16–21, 26, plus
// the connection rules of this phase (reserve without waiting, no provisional
// position, 1.5 s timeout, late claim, stale → 4001 session-replaced).

const CAVE = cavesIn('pradera')[0]
const INSIDE = caveInterior(CAVE.interiorAreaId)
let userCount = 0
const nextUser = () => `bbbbbbbb-0000-4000-8000-${String(++userCount).padStart(12, '0')}`

let db = null
let data = null
async function database() {
  if (!db) {
    db = await openLocalDatabase()
    data = createSqlPlayerData(serviceQuery(db))
  }
  return { db, data }
}
test.after(async () => { await db?.close() })

// One fake clock for the whole file: two room instances in one test must share it.
const realNow = Date.now
let now = realNow()
const advance = ms => { now += ms }
const BACKOFF_MS = 2_000
test.before(() => { Date.now = () => now })
test.after(() => { Date.now = realNow })

/** The real SQL adapter with dials: delay or hang a claim, fail claims or saves, count calls and keys. */
function instrumented(base) {
  const store = {
    claims: [], keys: [], batches: [], claimDelayMs: 0, claimHang: false, claimFail: false, saveFail: false, gates: [], abandonMs: 0, late: [],
    async locationClaim(userId, key) {
      store.claims.push(userId)
      store.keys.push({ ...key })
      if (store.abandonMs) {
        // The HTTP answer is given up (an aborted fetch), but the operation itself
        // still reaches the database later: the test runs it with `late.shift()()`.
        store.late.push(() => base.locationClaim(userId, key))
        await new Promise(resolve => setTimeout(resolve, store.abandonMs))
        throw new Error('aborted')
      }
      if (store.claimHang) await new Promise(resolve => store.gates.push(resolve))
      if (store.claimDelayMs) await new Promise(resolve => setTimeout(resolve, store.claimDelayMs))
      if (store.claimFail) throw new Error('authority down')
      return base.locationClaim(userId, key)
    },
    async locationSave(rows, host) {
      store.batches.push(rows.map(r => ({ ...r })))
      if (store.saveFail) throw new Error('authority down')
      return base.locationSave(rows, host)
    },
  }
  return store
}

/** A presence host on the shared database, acquired and activated now (so newer than every earlier one). */
async function newHost() {
  // PGlite's now() reads Date.now, which this file fakes and moves forward a lot (steps, grace
  // periods, checkpoints): the longest lease the database allows keeps a test's host alive.
  const host = new HostLifecycle({ store: data, renewMs: 600_000, leaseMs: 120_000, log: () => {} })
  await host.acquire()
  await host.activate()
  return host
}

async function stored(userId) {
  const { rows } = await serviceQuery(db)('SELECT area_id, tx, ty, layout_version, epoch::int, seq::int FROM public.world_player_locations WHERE user_id = $1', [userId])
  return rows[0] ?? null
}

/** A newer session of the player on another, newer instance (its host acquired now): it takes the row. */
async function claimNewer(userId) {
  const host = await newHost()
  return data.locationClaim(userId, host.sessionKey())
}

/**
 * A saved row as a past session (before WORLD LOCATION-4 keys, or of a host long gone) left
 * it: written as the table owner (test setup only), owned by no keyed session, so any live
 * session takes it over.
 */
async function seed(userId, place, version = layoutVersion(place.areaId)) {
  await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
  await db.query(`INSERT INTO public.world_player_locations (user_id, area_id, tx, ty, layout_version, epoch, seq)
    VALUES ($1, $2, $3, $4, $5, 1, 1)
    ON CONFLICT (user_id) DO UPDATE SET area_id = EXCLUDED.area_id, tx = EXCLUDED.tx, ty = EXCLUDED.ty, layout_version = EXCLUDED.layout_version,
      epoch = world_player_locations.epoch + 1, seq = 1, owner_generation = 0, owner_seq = 0, owner_session = NULL`,
  [userId, place.areaId, place.tx, place.ty, version])
}

/** The owner key of the row (generation, seq). */
async function owner(userId) {
  const { rows } = await serviceQuery(db)('SELECT owner_generation::int AS g, owner_seq::int AS s FROM public.world_player_locations WHERE user_id = $1', [userId])
  return rows[0] ?? null
}

function client(id) {
  const messages = []
  const leaves = []
  return { sessionId: id, userData: undefined, messages, leaves, send: (type, payload) => messages.push({ type, payload }), leave: (code, reason) => leaves.push([code, reason]) }
}

async function waitFor(condition, label, timeoutMs = 4_000) {
  // Real time: Date.now is the file's fake clock and only moves when a test moves it.
  const started = performance.now()
  while (!condition()) {
    if (performance.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setTimeout(resolve, 5))
  }
}

async function locationRoom(t, { mode = 'on', module = instanceA, owners = {}, hydrationTimeoutMs = 200, store: given = null } = {}) {
  await database()
  const store = given ?? instrumented(data)
  const host = await newHost()
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership(owners) })
  // These tests play the window before an older host learns of a newer one (bounded by its
  // renew in production): the room's drain on a newer host is PresenceRoomClose.test.js'.
  module.configurePresenceHost(host, { reactToHostChanges: false })
  const service = module.configureLocationPersistence({ mode, store, host, now: () => Date.now(), hydrationTimeoutMs })
  service.journal?.stop() // ticks are driven by the test
  const room = new module.PresenceRoom()
  room.onCreate()
  const clients = []
  t.after(() => {
    for (const c of clients) room.onLeave(c)
    room.setSimulationInterval(null)
    room.clock.clear()
    module.configureLocationPersistence({ mode: 'off' })
    module.configurePresenceHost(null)
    void host.stop()
  })
  const join = async (userId, options = {}) => {
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    const c = client(`${userId}-${clients.length}`)
    clients.push(c)
    await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 2, ...options }, { kind: 'player', userId, username: 'P', token: null })
    room.ready(c)
    return c
  }
  const placed = (c, userId) => module.liveActorForTesting(userId) !== null && lastMessage(c, MESSAGE.SNAPSHOT)?.self !== undefined
  const joinPlaced = async (userId, options) => { const c = await join(userId, options); await waitFor(() => placed(c, userId), 'placement'); return c }
  const self = c => {
    const entry = [...c.messages].reverse().find(e => e.type === MESSAGE.SELF || (e.type === MESSAGE.SNAPSHOT && e.payload.self))
    return entry.type === MESSAGE.SELF ? entry.payload : entry.payload.self
  }
  const where = c => { const s = self(c); return { areaId: s.areaId, tx: s.tx, ty: s.ty } }
  const step = (c, direction, sequence = self(c).moveSequence + 1) => { now += 200; room.move(c, { direction, running: false, sequence }) }
  const walk = (c, to) => {
    const at = self(c)
    for (const direction of routeBetween(at.areaId, at, to)) step(c, direction)
    assert.deepEqual({ tx: self(c).tx, ty: self(c).ty }, { tx: to.tx, ty: to.ty })
  }
  const travel = (c, to) => {
    const portal = portalTo(self(c).areaId, to)
    walk(c, portal)
    room.changeArea(c, { areaId: to })
    assert.equal(self(c).areaId, to)
  }
  const flush = async () => { service.journal.tick(); await waitFor(() => !service.journal.inflight, 'flush'); await settle() }
  const advance = ms => { now += ms }
  return { room, store, service, host, join, joinPlaced, self, where, step, walk, travel, flush, advance, module }
}

const deltasAbout = (c, id) => messagesOf(c, MESSAGE.BATCH).flat().concat(messagesOf(c, MESSAGE.DELTA)).filter(d => d.actor?.id === id)

// ── Restore (cases 1, 12, 13, 14, 26) ──────────────────────────────────────

test('on: a player with a saved cave tile and no reconnect memory is restored there (case 1)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const c = await r.joinPlaced(u)
  assert.deepEqual(r.where(c), { areaId: INSIDE.id, tx: 12, ty: 8 })
  assert.equal(r.self(c).dir, 'down', 'D-L7: no direction is stored')
  assert.equal(r.service.stats().restores.row, 1)
})

test('on: no row → Ciudad; an unknown area → Ciudad; a changed layout or a bad tile → the area arrival (cases 12–14)', async t => {
  const r = await locationRoom(t)
  const fresh = nextUser()
  assert.deepEqual(r.where(await r.joinPlaced(fresh)), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  const retired = nextUser()
  await seed(retired, { areaId: 'tundra', tx: 4, ty: 4 }, 'v')
  assert.deepEqual(r.where(await r.joinPlaced(retired)), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  const moved = nextUser()
  await seed(moved, { areaId: 'pradera', tx: CAVE.approach.tx, ty: CAVE.approach.ty }, '1.000000000000')
  assert.deepEqual(r.where(await r.joinPlaced(moved)), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  const portal = nextUser()
  await seed(portal, { areaId: 'pradera', tx: PRADERA_RETURN_PAD.tx, ty: PRADERA_RETURN_PAD.ty })
  assert.deepEqual(r.where(await r.joinPlaced(portal)), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  const rock = nextUser()
  await seed(rock, { areaId: INSIDE.id, tx: 0, ty: 0 })
  assert.deepEqual(r.where(await r.joinPlaced(rock)), { areaId: INSIDE.id, tx: INSIDE.arrival.tx, ty: INSIDE.arrival.ty })
  const { repairs } = r.service.stats()
  assert.deepEqual(repairs, { area: 1, layout: 1, tile: 2, protocol: 0 })
})

test('on: a client older than CAVES-3 with a cave row lands at the cave approach in Pradera (D-L6, case 26)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const c = await r.joinPlaced(u, { worldProtocol: undefined })
  assert.deepEqual(r.where(c), { areaId: 'pradera', tx: CAVE.approach.tx, ty: CAVE.approach.ty })
})

test('on: reconnect memory (< 15 s) still wins over the row, and the new session claims a new epoch (case 2)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const first = await r.joinPlaced(u)
  r.travel(first, 'pradera')
  r.walk(first, CAVE.approach)
  r.room.onLeave(first)
  await r.flush()
  // The crossing and the disconnect coalesced into one slot: one row, seq 1.
  assert.deepEqual(await stored(u), { area_id: 'pradera', tx: CAVE.approach.tx, ty: CAVE.approach.ty, layout_version: layoutVersion('pradera'), epoch: 1, seq: 1 })
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 }) // another (older) row, epoch 2
  const again = await r.join(u)
  assert.deepEqual(r.where(again), { areaId: 'pradera', tx: CAVE.approach.tx, ty: CAVE.approach.ty }, 'synchronous: no wait')
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 1, 'claim')
  assert.equal((await stored(u)).epoch, 3)
  r.step(again, 'down')
  r.advance(CHECKPOINT_MS + CHECKPOINT_JITTER_MS)
  await r.flush()
  assert.deepEqual({ tx: (await stored(u)).tx, ty: (await stored(u)).ty }, { tx: CAVE.approach.tx, ty: CAVE.approach.ty + 1 })
})

test('on: past the grace period the row restores the area and tile (case 1, end to end)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const first = await r.joinPlaced(u)
  r.travel(first, 'pradera')
  r.walk(first, CAVE.approach)
  r.step(first, 'up')
  r.room.changeArea(first, { areaId: INSIDE.id })
  r.walk(first, { tx: 12, ty: 8 })
  r.room.onLeave(first)
  await r.flush()
  r.advance(RECONNECT_GRACE_MS + 1)
  assert.deepEqual(r.where(await r.joinPlaced(u)), { areaId: INSIDE.id, tx: 12, ty: 8 })
})

// ── Connection rules ───────────────────────────────────────────────────────

test('on: while the claim is pending nothing is published and every intent is refused; the snapshot waits', async t => {
  const r = await locationRoom(t, { hydrationTimeoutMs: 5_000 })
  const watcher = await r.joinPlaced(nextUser())
  r.store.claimHang = true
  const u = nextUser()
  await seed(u, { areaId: 'ciudad-corazon', tx: 31, ty: 21 })
  const c = await r.join(u)
  await waitFor(() => r.store.gates.length === 1, 'claim in flight')
  assert.equal(r.module.liveActorForTesting(u), null)
  assert.equal(lastMessage(c, MESSAGE.SNAPSHOT), undefined, 'ready is deferred')
  r.room.move(c, { direction: 'up', running: false, sequence: 1 })
  r.room.changeArea(c, { areaId: 'pradera' })
  r.room.work(c, { nodeId: 'x', pokemonInstanceId: 1, requestId: 1 })
  r.room.chat(c, { text: 'hola' })
  assert.equal(messagesOf(c, MESSAGE.ERROR).length, 4)
  r.room.flushDeltaBatches()
  assert.deepEqual(deltasAbout(watcher, u), [], 'no provisional position reaches anyone')
  r.store.claimHang = false
  r.store.gates.shift()()
  await waitFor(() => lastMessage(c, MESSAGE.SNAPSHOT)?.self, 'placement')
  assert.deepEqual(r.where(c), { areaId: 'ciudad-corazon', tx: 31, ty: 21 })
  r.room.flushDeltaBatches()
  assert.deepEqual(deltasAbout(watcher, u).map(d => [d.type, d.actor.tx, d.actor.ty]), [['upsert', 31, 21]], 'only the real position is ever published')
})

test('on: a claim slower than 1.5 s plays on in Ciudad, unclaimed: no saves until a claim succeeds (case 14)', async t => {
  assert.equal(HYDRATION_TIMEOUT_MS, 1_500)
  const r = await locationRoom(t, { hydrationTimeoutMs: HYDRATION_TIMEOUT_MS })
  r.store.claimHang = true
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const started = performance.now()
  const c = await r.join(u)
  await waitFor(() => lastMessage(c, MESSAGE.SNAPSHOT)?.self, 'timeout placement', 3_000)
  const waited = performance.now() - started
  assert.ok(waited >= 1_400 && waited < 1_900, `enabled at the 1.5 s timeout (${Math.round(waited)} ms)`)
  assert.deepEqual(r.where(c), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  assert.equal(r.service.status(r.service.journal.entries.get(u).session), 'unclaimed')
  r.travel(c, 'pradera') // moves and a crossing are accepted…
  await r.flush()
  assert.equal(r.store.batches.length, 0, '…but nothing is saved without a claim')
  assert.equal(r.service.stats().restores.timeout, 1)
})

test('on: a failed claim retries with backoff; once claimed the session saves where it really is (late claim ignored after moving)', async t => {
  const r = await locationRoom(t)
  r.store.claimFail = true
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const c = await r.joinPlaced(u)
  assert.deepEqual(r.where(c), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  r.travel(c, 'pradera')
  // (The backoff timing itself is proven in locationJournal.test.js; walking already moved the clock past it.)
  r.store.claimFail = false
  r.service.journal.tick()
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 1, 'retry claim')
  assert.equal(r.where(c).areaId, 'pradera', 'a player who already moved is never moved by a late claim')
  assert.equal(r.service.stats().late.adopted, 1)
  r.advance(CHECKPOINT_MS + CHECKPOINT_JITTER_MS)
  await r.flush()
  assert.equal((await stored(u)).area_id, 'pradera')
})

// Review B3 (repro R3): the boundary is publication. A claim that answers
// before the actor is admitted restores it; once the fallback was published
// to the client or an observer, a claim only brings the epoch: the current
// authoritative position is adopted and saved at once, nothing moves.
const QUIET_ACTIONS = {
  nothing: () => {},
  chat: (r, c) => r.room.chat(c, { text: 'hola' }),
  cancelWork: (r, c) => r.room.cancelWork(c, { actionId: 'x', requestId: 1 }),
  rejectedStep: (r, c) => r.room.move(c, { direction: 'up', running: false, sequence: 2 ** 40 }),
  rejectedArea: (r, c) => r.room.changeArea(c, { areaId: 'pradera' }),
}

for (const [name, act] of Object.entries(QUIET_ACTIONS)) {
  test(`on: a claim answering after the fallback was published never moves the player (${name}) (R3)`, async t => {
    const r = await locationRoom(t, { hydrationTimeoutMs: 30 })
    const watcher = await r.joinPlaced(nextUser())
    r.store.claimHang = true
    const u = nextUser()
    await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 }) // the old row: inside the cave
    const c = await r.join(u)
    await waitFor(() => lastMessage(c, MESSAGE.SNAPSHOT)?.self, 'fallback published')
    const at = r.where(c)
    assert.deepEqual(at, { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
    act(r, c)
    r.room.flushDeltaBatches()
    const seen = deltasAbout(watcher, u).length
    const snapshots = messagesOf(c, MESSAGE.SNAPSHOT).length
    r.store.claimHang = false
    r.store.gates.shift()()
    await waitFor(() => r.service.journal.stats().sessions.live.claimed === 2, 'claim landed')
    await settle()
    assert.deepEqual(r.where(c), at, 'no area or tile change')
    assert.equal(r.service.stats().late.adopted, 1)
    assert.equal(r.module.liveActorForTesting(u).areaId, 'ciudad-corazon')
    assert.equal(messagesOf(c, MESSAGE.SNAPSHOT).length, snapshots, 'no new snapshot to the player')
    r.room.flushDeltaBatches()
    assert.equal(deltasAbout(watcher, u).length, seen, 'observers receive no leave or upsert')
    await r.flush() // urgent: the next tick, no checkpoint wait
    const row = await stored(u)
    assert.deepEqual({ area: row.area_id, tx: row.tx, ty: row.ty }, { area: 'ciudad-corazon', tx: 31, ty: 20 }, 'the current position replaces the old row')
    // Later restores never bring the old cave tile back.
    r.room.onLeave(c)
    r.advance(RECONNECT_GRACE_MS + 1)
    assert.deepEqual(r.where(await r.joinPlaced(u)), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  })
}

test('on: a claim answering BEFORE admission still restores the row (the boundary is publication)', async t => {
  const r = await locationRoom(t, { hydrationTimeoutMs: 2_000 })
  r.store.claimDelayMs = 50
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const c = await r.joinPlaced(u)
  assert.deepEqual(r.where(c), { areaId: INSIDE.id, tx: 12, ty: 8 })
  assert.equal(r.service.stats().late.adopted, 0)
})

test('on: leaving while the claim is pending places nobody and saves nothing', async t => {
  const r = await locationRoom(t, { hydrationTimeoutMs: 5_000 })
  r.store.claimHang = true
  const u = nextUser()
  const c = await r.join(u)
  await waitFor(() => r.store.gates.length === 1, 'claim in flight')
  r.room.onLeave(c)
  r.store.claimHang = false
  r.store.gates.shift()()
  await settle(); await settle()
  assert.equal(r.module.liveActorForTesting(u), null)
  await r.flush()
  assert.equal(r.store.batches.length, 0)
})

// ── Fencing (cases 5, 16) ──────────────────────────────────────────────────

test('stale → the writer is fenced and its socket closed with 4001 session-replaced, and its tile is not remembered', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  await r.flush()
  await claimNewer(u) // another instance's session claims a newer epoch
  r.step(c, 'down')
  r.travel(c, 'ciudad-corazon') // urgent save → stale
  await r.flush()
  assert.deepEqual(c.leaves, [[4001, SESSION_REPLACED]])
  assert.equal(r.service.stats().fencedDisconnects, 1)
  r.room.onLeave(c)
  await r.flush()
  // Back here within the grace period: the fenced socket's tile is not remembered (no cache
  // placement), and this host is OLDER than the one whose session owns the row (WORLD LOCATION-4):
  // a session accepted here is outranked, never placed, and goes as replaced. (In `on` this host
  // would already be draining: it saw a newer active host.)
  assert.equal((await stored(u)).area_id, 'pradera')
  const again = await r.join(u)
  await waitFor(() => again.leaves.length === 1, 'the outranked join closes')
  assert.deepEqual(again.leaves, [[4001, SESSION_REPLACED]])
  assert.equal(r.module.liveActorForTesting(u), null, 'never placed: neither from the cache nor from the row')
  assert.equal((await stored(u)).area_id, 'pradera', 'the newer session keeps its row')
})

test('double reconnect on one instance: one actor, the replaced sockets get 4001 session-replaced, the newest key owns the row (case 16)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const first = await r.joinPlaced(u)
  r.store.claimDelayMs = 20
  const second = await r.join(u)
  const third = await r.join(u)
  assert.deepEqual(first.leaves, [[4001, SESSION_REPLACED]])
  assert.deepEqual(second.leaves, [[4001, SESSION_REPLACED]])
  r.room.onLeave(first); r.room.onLeave(second)
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 1, 'claims settle')
  await new Promise(resolve => setTimeout(resolve, 60)) // every delayed claim has landed
  r.store.claimDelayMs = 0
  const keys = r.store.keys.filter((_, i) => r.store.claims[i] === u)
  assert.deepEqual(keys.map(k => k.seq), [...keys.map(k => k.seq)].sort((a, b) => a - b), 'keys follow the acceptance order')
  assert.deepEqual(await owner(u), { g: r.host.generation, s: keys.at(-1).seq }, 'the newest key owns the row, whatever the landing order')
  r.travel(third, 'pradera')
  await r.flush()
  assert.deepEqual(third.leaves, [], 'the survivor is never fenced')
  assert.equal((await stored(u)).area_id, 'pradera')
})

test('two instances (two module copies, one database): the newer session wins, the older is closed with 4001 (case 5)', async t => {
  const instanceB = await import(new URL('./PresenceRoom.js?instance=b', import.meta.url).href)
  const a = await locationRoom(t)
  const b = await locationRoom(t, { module: instanceB, store: instrumented(data) })
  const u = nextUser()
  const onA = await a.joinPlaced(u)
  a.travel(onA, 'pradera')
  await a.flush()
  const onB = await b.joinPlaced(u) // a deploy: the player's new socket lands on B
  assert.deepEqual(b.where(onB), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  a.step(onA, 'down') // A drains: a late write…
  a.room.onLeave(onA) // …and its disconnect save
  await a.flush()
  assert.equal((await stored(u)).epoch, 2)
  assert.deepEqual({ tx: (await stored(u)).tx, ty: (await stored(u)).ty }, { tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty }, 'A changed nothing')
  b.travel(onB, 'ciudad-corazon')
  await b.flush()
  assert.equal((await stored(u)).area_id, 'ciudad-corazon')
  assert.deepEqual(onB.leaves, [])
})

// ── Shadow is not invasive (review B1, repro R1) ───────────────────────────

test('shadow + stale: no disconnect, no presence change, the tile still goes to the reconnect cache, wouldFence counts it (R1)', async t => {
  const r = await locationRoom(t, { mode: 'shadow' })
  const watcher = await r.joinPlaced(nextUser())
  const u = nextUser()
  const c = await r.joinPlaced(u)
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 2, 'claims')
  r.travel(c, 'pradera')
  await r.flush()
  await claimNewer(u) // another instance's session claims a newer epoch
  r.travel(c, 'ciudad-corazon') // urgent save → stale
  r.room.flushDeltaBatches()
  const seen = deltasAbout(watcher, u).length
  const at = r.where(c)
  await r.flush()
  assert.deepEqual(c.leaves, [], 'shadow never disconnects')
  assert.equal(r.service.stats().shadow.wouldFence, 1)
  assert.equal(r.service.stats().fencedDisconnects, 0)
  r.room.flushDeltaBatches()
  assert.equal(deltasAbout(watcher, u).length, seen, 'observers hear nothing about it')
  assert.deepEqual(r.where(c), at, 'the player is not moved')
  r.step(c, openDirection('ciudad-corazon', at))
  assert.equal(messagesOf(c, MESSAGE.ERROR).length, 0, 'it keeps playing')
  const last = r.where(c)
  r.room.onLeave(c)
  const again = await r.join(u)
  assert.deepEqual(r.where(again), last, 'remembered for a reconnect, as before WORLD LOCATION')
})

test('shadow: a local replacement closes the old socket exactly as off does (4001, no reason)', async t => {
  const r = await locationRoom(t, { mode: 'shadow' })
  const u = nextUser()
  const first = await r.joinPlaced(u)
  await r.join(u)
  assert.deepEqual(first.leaves, [[4001, undefined]])
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 1, 'claim')
})

for (const mode of ['on', 'shadow']) {
  test(`${mode}: a legitimate newer session on another instance ${mode === 'on' ? 'displaces the older one (4001 session-replaced)' : 'only counts wouldFence'}`, async t => {
    const instanceB = await import(new URL(`./PresenceRoom.js?instance=legit-${mode}`, import.meta.url).href)
    const a = await locationRoom(t, { mode })
    const b = await locationRoom(t, { mode, module: instanceB, store: instrumented(data) })
    const u = nextUser()
    const onA = await a.joinPlaced(u)
    await waitFor(() => a.service.journal.stats().sessions.live.claimed === 1, 'claim on A')
    a.travel(onA, 'pradera')
    await a.flush()
    const onB = await b.joinPlaced(u)
    await waitFor(() => b.service.journal.stats().sessions.live.claimed === 1, 'claim on B')
    a.travel(onA, 'ciudad-corazon') // A's writer is now behind: stale
    await a.flush()
    if (mode === 'on') {
      assert.deepEqual(onA.leaves, [[4001, SESSION_REPLACED]])
      assert.equal(a.service.stats().fencedDisconnects, 1)
    } else {
      assert.deepEqual(onA.leaves, [])
      assert.equal(a.service.stats().shadow.wouldFence, 1)
      assert.equal(a.service.stats().fencedDisconnects, 0)
    }
    b.travel(onB, mode === 'on' ? 'ciudad-corazon' : 'pradera')
    await b.flush()
    assert.deepEqual(onB.leaves, [], 'the newer session is never fenced')
    assert.equal((await stored(u)).area_id, mode === 'on' ? 'ciudad-corazon' : 'pradera')
  })
}

// ── Abandoned, late or retried claims of an OLDER session (WORLD LOCATION-4: T3/T4) ──
// The key of a session is fixed when it is accepted: whatever happens to its claims (given
// up, landing late, retried), a session accepted later — on this host (greater seq) or on a
// newer host (greater generation) — keeps the row. No re-read, no new key, no re-imposition.

for (const [mode, instances] of [['on', 1], ['shadow', 1], ['on', 2], ['shadow', 2]]) {
  test(`${mode}, ${instances} instance(s): an abandoned claim of an older session that lands after the live newer session's never displaces it`, async t => {
    const a = await locationRoom(t, { mode, hydrationTimeoutMs: 100 })
    const instanceB = instances === 2 ? await import(new URL(`./PresenceRoom.js?instance=abandon-${mode}`, import.meta.url).href) : null
    const b = instanceB ? await locationRoom(t, { mode, module: instanceB, store: instrumented(data) }) : a
    const u = nextUser()
    await seed(u, { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
    a.store.abandonMs = 20 // C1: its answer is given up after 20 ms; its database operation runs later
    const first = await a.join(u)
    await waitFor(() => lastMessage(first, MESSAGE.SNAPSHOT)?.self, 'first session placed')
    assert.equal(a.store.late.length, 1, 'C1 was abandoned, not answered')
    a.room.onLeave(first) // the first socket disappears
    a.store.abandonMs = 0
    const second = await b.joinPlaced(u) // C2: the live session, accepted later
    await waitFor(() => b.service.journal.stats().sessions.live.claimed === 1, 'C2 claimed')
    const epoch = (await stored(u)).epoch
    const zombie = await a.store.late.shift()() // C1 reaches the database only now, after C2
    assert.deepEqual(zombie, { status: 'superseded', newerActive: instances === 2 }, 'C1 is superseded: it writes nothing')
    assert.equal((await stored(u)).epoch, epoch, 'C1 displaced nobody')
    const to = b.where(second).areaId === 'pradera' ? 'ciudad-corazon' : 'pradera'
    b.travel(second, to)
    await b.flush()
    assert.deepEqual(second.leaves, [], 'C2 is never disconnected')
    assert.equal(b.service.stats().fencedDisconnects, 0)
    assert.equal(b.service.stats().shadow.wouldFence, 0)
    assert.equal(b.service.journal.stats().saves.stale, 0, 'C2 never sees stale')
    assert.deepEqual({ area: (await stored(u)).area_id, epoch: (await stored(u)).epoch }, { area: to, epoch })
  })
}

for (const mode of ['on', 'shadow']) {
  test(`${mode}: T3 in the room — the older host's claim is still in flight when the newer host's session claims`, async t => {
    const a = await locationRoom(t, { mode, hydrationTimeoutMs: 5_000 })
    const instanceB = await import(new URL(`./PresenceRoom.js?instance=t3-${mode}`, import.meta.url).href)
    const b = await locationRoom(t, { mode, module: instanceB, store: instrumented(data) })
    const u = nextUser()
    await seed(u, { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
    a.store.claimHang = true
    const onA = await a.join(u)
    await waitFor(() => a.store.gates.length === 1, 'A\'s claim in flight')
    const onB = await b.joinPlaced(u)
    await waitFor(() => b.service.journal.stats().sessions.live.claimed === 1, 'B claimed')
    a.store.claimHang = false
    a.store.gates.shift()() // A's claim lands only now
    await waitFor(() => a.service.journal.stats().claims.outranked === 1, 'A superseded')
    assert.equal((await owner(u)).g, b.host.generation, 'the newer host keeps the row')
    if (mode === 'on') assert.deepEqual(onA.leaves, [[4001, SESSION_REPLACED]], 'on: the older session goes as replaced')
    else { assert.deepEqual(onA.leaves, []); assert.equal(a.service.stats().shadow.wouldReplace, 1) }
    const to = b.where(onB).areaId === 'pradera' ? 'ciudad-corazon' : 'pradera'
    b.travel(onB, to)
    await b.flush()
    assert.deepEqual(onB.leaves, [])
    assert.equal((await stored(u)).area_id, to)
  })

  test(`${mode}: T4 in the room — the older session's claim is abandoned and its later retry (same key) never displaces the newer one`, async t => {
    const a = await locationRoom(t, { mode, hydrationTimeoutMs: 100 })
    const instanceB = await import(new URL(`./PresenceRoom.js?instance=t4-${mode}`, import.meta.url).href)
    const b = await locationRoom(t, { mode, module: instanceB, store: instrumented(data) })
    const u = nextUser()
    await seed(u, { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
    a.store.abandonMs = 20
    const onA = await a.join(u) // stays live
    await waitFor(() => lastMessage(onA, MESSAGE.SNAPSHOT)?.self, 'A placed')
    await waitFor(() => a.service.journal.stats().claims.failed >= 1, 'A abandoned')
    a.store.abandonMs = 0
    const onB = await b.joinPlaced(u)
    await waitFor(() => b.service.journal.stats().sessions.live.claimed === 1, 'B claimed')
    const epoch = (await stored(u)).epoch
    advance(BACKOFF_MS)
    a.service.journal.tick() // A's retry, same key
    await waitFor(() => a.service.journal.stats().claims.outranked === 1, 'A superseded on retry')
    const keysOfA = a.store.keys.filter((_, i) => a.store.claims[i] === u)
    assert.ok(keysOfA.length >= 2 && keysOfA.every(k => JSON.stringify(k) === JSON.stringify(keysOfA[0])), 'every retry of A carries the same key')
    assert.equal((await stored(u)).epoch, epoch, 'the retry wrote nothing')
    await a.store.late.shift()() // and the abandoned operation landing late writes nothing either
    assert.equal((await stored(u)).epoch, epoch)
    if (mode === 'on') assert.deepEqual(onA.leaves, [[4001, SESSION_REPLACED]])
    else assert.equal(a.service.stats().shadow.wouldReplace, 1)
    b.travel(onB, b.where(onB).areaId === 'pradera' ? 'ciudad-corazon' : 'pradera')
    await b.flush()
    assert.deepEqual(onB.leaves, [], 'B is never fenced')
    assert.equal(b.service.journal.stats().saves.stale, 0)
  })
}

// ── Restart, transitions and saves (cases 3, 17, 22) ───────────────────────

test('restart (a fresh process): the row restores the area; at most the last checkpoint of walking is lost (case 3)', async t => {
  const a = await locationRoom(t)
  const u = nextUser()
  const c = await a.joinPlaced(u)
  a.travel(c, 'pradera')
  await a.flush() // the crossing is saved at once
  a.step(c, 'down'); a.step(c, 'down')
  // The process dies before the checkpoint: no onLeave, no flush.
  a.service.disable()
  const fresh = await import(new URL('./PresenceRoom.js?instance=restart', import.meta.url).href)
  const b = await locationRoom(t, { module: fresh, store: instrumented(data) })
  const again = await b.joinPlaced(u)
  assert.deepEqual(b.where(again), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty }, 'the area is kept; two steps after the last save are lost')
})

test('a crossing followed at once by a disconnect leaves the new area in the row (case 17)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  r.room.onLeave(c)
  await r.flush()
  assert.equal((await stored(u)).area_id, 'pradera')
})

test('steps are never written one by one; moveSequence forged to 2^53 changes nothing saved (cases 10, 22)', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  await r.flush()
  const before = r.store.batches.length
  r.step(c, 'down', 2 ** 53 - 1) // refused as a forged sequence, consumed
  assert.equal(lastMessage(c, MESSAGE.ERROR).reason, 'movement sequence denied')
  r.step(c, 'down', 2 ** 53) // also refused: the service never moves on a forged number
  r.room.move(c, { direction: 'down', running: false, sequence: 2 ** 53 + 1, areaId: INSIDE.id, tx: 12, ty: 8 })
  await r.flush()
  assert.equal(r.store.batches.length, before, 'no step write before the checkpoint')
  r.advance(CHECKPOINT_MS + CHECKPOINT_JITTER_MS)
  await r.flush()
  const row = await stored(u)
  assert.equal(row.area_id, 'pradera', 'payload fields are ignored')
  assert.ok(row.seq <= 3, `the seq is the server's own counter (${row.seq})`)
})

// ── Isolation, work, identities (cases 18–21) ──────────────────────────────

test('a player restored inside the cave is seen only from inside the cave (case 20)', async t => {
  const r = await locationRoom(t)
  const town = await r.joinPlaced(nextUser())
  const meadow = await r.joinPlaced(nextUser())
  r.travel(meadow, 'pradera')
  const cave = await r.joinPlaced(nextUser())
  r.travel(cave, 'pradera'); r.walk(cave, CAVE.approach); r.step(cave, 'up'); r.room.changeArea(cave, { areaId: INSIDE.id })
  r.room.flushDeltaBatches()
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const c = await r.joinPlaced(u)
  r.room.flushDeltaBatches()
  assert.equal(r.where(c).areaId, INSIDE.id)
  assert.deepEqual(deltasAbout(town, u), [])
  assert.deepEqual(deltasAbout(meadow, u), [])
  assert.equal(deltasAbout(cave, u)[0].type, 'upsert')
})

test('active work: a restart restores the trainer at its waiting tile with no work running and no node reserved (case 18)', async t => {
  const u = nextUser()
  const r = await locationRoom(t, { owners: { [u]: [25] } })
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  const isOpen = standableTile('pradera')
  const target = praderaNodesNearSpawn()
    .flatMap(({ node, stands }) => stands.map(stand => ({ node, stand, placement: workPlacement(node, stand, isOpen) })))
    .find(({ stand, placement }) => placement && routeBetween('pradera', ARRIVALS.pradera, stand, 20))
  r.walk(c, target.stand)
  r.room.work(c, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  await settle()
  assert.equal(lastMessage(c, WORLD_MESSAGE.WORK_RESULT).ok, true)
  const wait = r.where(c)
  r.advance(CHECKPOINT_MS + CHECKPOINT_JITTER_MS)
  await r.flush()
  assert.deepEqual({ area: (await stored(u)).area_id, tx: (await stored(u)).tx, ty: (await stored(u)).ty }, { area: 'pradera', tx: wait.tx, ty: wait.ty })
  r.service.disable() // the process dies with the work running
  const fresh = await import(new URL('./PresenceRoom.js?instance=work-restart', import.meta.url).href)
  const b = await locationRoom(t, { module: fresh, owners: { [u]: [25] }, store: instrumented(data) })
  const world = fresh.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({ [u]: [25] }) })
  const again = await b.joinPlaced(u)
  assert.deepEqual(b.where(again), wait)
  assert.equal(world.authority.actions.size, 0, 'restoring never starts or resumes work')
  assert.equal(lastMessage(again, WORLD_MESSAGE.WORK_DONE), undefined)
})

test('guests and synthetic ids never claim or save (case 21)', async t => {
  const r = await locationRoom(t)
  const guest = client('guest-location')
  await r.room.onJoin(guest, {}, { kind: 'guest', token: null })
  const bot = client('bot-location')
  await r.room.onJoin(bot, { worldProtocol: WORLD_PROTOCOL }, { kind: 'player', userId: 'benchmark-loc', username: 'B', token: null })
  r.room.ready(bot)
  assert.ok(lastMessage(bot, MESSAGE.SNAPSHOT).self, 'a synthetic player is placed synchronously, as today')
  r.travel(bot, 'pradera')
  r.room.onLeave(bot); r.room.onLeave(guest)
  await r.flush()
  assert.deepEqual(r.store.claims, [])
  assert.deepEqual(r.store.batches, [])
})

// ── Modes (case 24) ────────────────────────────────────────────────────────

test('off: no claim, no save, and a saved row changes nothing (today\'s behaviour)', async t => {
  const r = await locationRoom(t, { mode: 'off' })
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 12, ty: 8 })
  const c = await r.join(u)
  assert.deepEqual(r.where(c), { areaId: 'ciudad-corazon', tx: 31, ty: 20 }, 'placed synchronously in Ciudad')
  r.travel(c, 'pradera')
  r.room.onLeave(c)
  assert.deepEqual(r.store.claims, [])
  assert.equal(r.service.journal, null)
  assert.deepEqual(r.service.stats().effective, 'off')
})

test('shadow: claims and saves, restores nothing, and counts what `on` would have done', async t => {
  const r = await locationRoom(t, { mode: 'shadow' })
  const u = nextUser()
  await seed(u, { areaId: INSIDE.id, tx: 0, ty: 0 }) // a rock tile: `on` would repair it
  const c = await r.join(u)
  assert.deepEqual(r.where(c), { areaId: 'ciudad-corazon', tx: 31, ty: 20 }, 'placed synchronously, as today')
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 1, 'claim')
  assert.deepEqual(r.service.stats().shadow, { wouldRestore: 1, wouldRepair: { area: 0, layout: 0, tile: 1, protocol: 0 }, wouldFence: 0, wouldReplace: 0, wouldDrain: 0 })
  r.travel(c, 'pradera')
  await r.flush()
  assert.equal((await stored(u)).area_id, 'pradera', 'shadow writes what really happens')
})

test('rollback on → off at runtime: the next joins make no call and restore nothing; nothing pending is written', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  r.service.disable()
  const off = r.module.configureLocationPersistence({ mode: 'off', store: r.store })
  r.room.onLeave(c)
  const calls = { claims: r.store.claims.length, batches: r.store.batches.length }
  r.advance(RECONNECT_GRACE_MS + 1)
  const again = await r.join(u)
  assert.deepEqual(r.where(again), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  assert.deepEqual({ claims: r.store.claims.length, batches: r.store.batches.length }, calls)
  assert.equal(off.stats().effective, 'off')
  assert.equal((await stored(u)).area_id, null, 'the crossing pending at the rollback was never written')
})

test('a store without location operations (demo or unavailable world) is "unavailable": behaves as off', async t => {
  const r = await locationRoom(t, { store: { playerState: async () => ({}) } })
  assert.equal(r.service.stats().effective, 'unavailable')
  const u = nextUser()
  const c = await r.join(u)
  assert.deepEqual(r.where(c), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
})

test('on: active work and a reconnect within 15 s behave exactly as today: same tile, the work keeps running (case 19)', async t => {
  const u = nextUser()
  const r = await locationRoom(t, { owners: { [u]: [25] } })
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  const isOpen = standableTile('pradera')
  const target = praderaNodesNearSpawn()
    .flatMap(({ node, stands }) => stands.map(stand => ({ node, stand, placement: workPlacement(node, stand, isOpen) })))
    .find(({ stand, placement }) => placement && routeBetween('pradera', ARRIVALS.pradera, stand, 20))
  r.walk(c, target.stand)
  r.room.work(c, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  await settle()
  const wait = r.where(c)
  r.room.onLeave(c)
  const again = await r.join(u)
  assert.deepEqual(r.where(again), wait, 'reconnect memory, synchronously')
  assert.equal(lastMessage(again, WORLD_MESSAGE.WORK_DONE), undefined, 'not cancelled by the reconnect')
  // The new session still claims its epoch (in the background); let it land before the database closes.
  await waitFor(() => r.service.journal.stats().sessions.live.claimed === 1, 'claim')
})

// ── Graceful shutdown (case 4) ─────────────────────────────────────────────

test('graceful shutdown: after every socket closes, one final flush saves each last tile exactly (case 4)', async t => {
  const r = await locationRoom(t)
  const users = [nextUser(), nextUser(), nextUser()]
  const sockets = []
  for (const u of users) sockets.push(await r.joinPlaced(u))
  const direction = openDirection('pradera', ARRIVALS.pradera)
  const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[direction]
  const last = { tx: ARRIVALS.pradera.tx + DELTA[0], ty: ARRIVALS.pradera.ty + DELTA[1] }
  for (const c of sockets) r.travel(c, 'pradera')
  await r.flush() // the crossings
  for (const c of sockets) r.step(c, direction) // the last step of each is only marked
  for (const c of sockets) r.room.onLeave(c) // Colyseus disconnects everyone first…
  const result = await r.module.flushLocationsForShutdown(3_000) // …then calls onShutdown
  assert.deepEqual(result, { sent: 3, applied: 3, duplicate: 0, stale: 0, hostRefused: 0, left: 0, timedOut: false })
  for (const u of users) assert.deepEqual({ area: (await stored(u)).area_id, tx: (await stored(u)).tx, ty: (await stored(u)).ty }, { area: 'pradera', ...last })
  r.advance(RECONNECT_GRACE_MS + 1)
  const fresh = await import(new URL('./PresenceRoom.js?instance=after-shutdown', import.meta.url).href)
  const b = await locationRoom(t, { module: fresh, store: instrumented(data) })
  assert.deepEqual(b.where(await b.joinPlaced(users[0])), { areaId: 'pradera', ...last })
})

test('graceful shutdown is best effort: a hung authority never holds the exit past the deadline', async t => {
  const r = await locationRoom(t)
  const u = nextUser()
  const c = await r.joinPlaced(u)
  r.travel(c, 'pradera')
  r.room.onLeave(c)
  r.store.locationSave = () => new Promise(() => {})
  const started = performance.now()
  const result = await r.module.flushLocationsForShutdown(100)
  assert.equal(result.timedOut, true)
  assert.ok(performance.now() - started < 1_000)
})

test('the process entry point (realtimeServer.js) drains in onBeforeShutdown (before any socket closes) and stops the host in onShutdown', async () => {
  const { readFile } = await import('node:fs/promises')
  const source = await readFile(new URL('../realtimeServer.js', import.meta.url), 'utf8')
  assert.match(source, /gameServer\.onBeforeShutdown\(async \(\) => \{ drained = await drainPresence\(\{ deadlineMs: SHUTDOWN_LOCATION_FLUSH_MS \}\) \}\)/)
  assert.match(source, /gameServer\.onShutdown\(async \(\) => \{\s*const late = await flushLocationsForShutdown\(SHUTDOWN_LOCATION_FLUSH_MS\)/)
  assert.match(source, /const line = shutdownFlushLine\(drained, late\)/)
  assert.match(source, /await host\?\.stop\(\)/)
  assert.match(source, /SHUTDOWN_LOCATION_FLUSH_MS = 3_000/)
})
