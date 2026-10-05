import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { MESSAGE } from '../protocol/messages.js'
import { HOST_DRAINING_CODE, SESSION_REPLACED_CODE, STALE_ATTEMPT_CODE } from '../protocol/closeCodes.js'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createEdgePlayerData, createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { lastMessage } from '../world/testing.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'

// CLOUD JOIN-ORDER-2 — the join order ACROSS processes: two copies of the room module (two processes) with
// real HostLifecycles over one embedded Postgres with every migration (claim v3 included), and the real
// world-authority handler where the Edge path is exercised. The original CLOUD JOIN-ORDER-1 reproductions
// R3/R4 run without attempts (unchanged) and with attempts (fixed). Order is forced with held promises; the
// journal's clock is moved instead of waiting; a wait that runs out is a failure, never a pass.
// PGlite proves behaviour here; concurrency is proven on real Postgres (scripts/world-location/join-order-concurrency).

const PAGE = 'tab-page-0001'
const OTHER = 'tab-page-0002'
const HANDLER = new URL('../../../../supabase/functions/world-authority/handler.ts', import.meta.url)
const JOIN_ORDER_ROLLBACK = fileURLToPath(new URL('../../../../scripts/world-location/rollback_world_location_join_order.sql', import.meta.url))
const held = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
let instances = 0
let users = 0
const nextUser = () => `f3000000-0000-4000-8000-${String(++users).padStart(12, '0')}`
let db = null
let data = null
test.after(async () => { await db?.close() })
async function database() { if (!db) { db = await openLocalDatabase(); data = createSqlPlayerData(serviceQuery(db)) } return data }
const created = []
const locals = []
test.afterEach(async () => {
  for (const h of created.splice(0)) await h.stop()
  for (const local of locals.splice(0)) await local.close()
})
async function waitFor(condition, label, ms = 4_000) {
  const t0 = performance.now()
  while (!(await condition())) { if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 5)) }
}
/** A bounded wait whose outcome is ASSERTED right after: running out is never a verdict on its own. */
const settled = (condition, ms = 2_000) => waitFor(condition, 'settled', ms).catch(() => {})
const socket = id => ({ sessionId: id, userData: undefined, messages: [], leaves: [], send(type, payload) { this.messages.push({ type, payload }) }, leave(code, reason) { this.leaves.push([code, reason]) } })
const placed = c => lastMessage(c, MESSAGE.SNAPSHOT)?.self ?? null
let clock = Date.now()
const owner = async u => (await db.query('SELECT owner_generation::int AS g, owner_attempt::int AS attempt, owner_page AS page, ty FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0] ?? null

/** Counts claims by version (v1/v2/v3) over a store, without touching it. */
function counting(base) {
  const calls = { v1: 0, v2: 0, v3: [] }
  return new Proxy(base, {
    get(target, property) {
      if (property === 'calls') return calls
      if (property === 'locationClaim') return async (...args) => { calls.v1++; return target.locationClaim(...args) }
      if (property === 'locationClaimV2') return async (...args) => { calls.v2++; return target.locationClaimV2(...args) }
      if (property === 'locationClaimV3' && typeof target.locationClaimV3 === 'function') return async (userId, key, options) => { calls.v3.push({ ...options, seq: key.seq }); return target.locationClaimV3(userId, key, options) }
      return Reflect.get(target, property)
    },
  })
}

/**
 * One room process: its own module copy and a host acquired NOW (older than any host created after it).
 * `order`: WORLD_JOIN_ORDER; `authority`: whether claim v3 is requested from the store (on only).
 */
async function processWith(t, { mode = 'on', order = 'on', recovery = false, authority = true, store: given = null, hostStore = null } = {}) {
  await database()
  const store = given ?? counting(data)
  const module = await import(new URL(`./PresenceRoom.js?instance=join-order-claims-${++instances}`, import.meta.url).href)
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  await module.configurePresenceRecovery({ requested: recovery, store, log: () => {} }).probe()
  const joinOrder = module.configureJoinOrder({ mode: order, authority: authority ? { store, log: () => {} } : null })
  const capability = module.joinOrderAuthorityForTesting()
  await capability.probe()
  const host = new HostLifecycle({ store: hostStore ?? store, renewMs: 600_000, leaseMs: 120_000, log: () => {} })
  created.push(host)
  await host.acquire(); await host.activate()
  module.configurePresenceHost(host, { reactToHostChanges: false, store })
  const service = module.configureLocationPersistence({ mode, store, host, now: () => clock, hydrationTimeoutMs: 1_000 })
  service.journal?.stop()
  const room = new module.PresenceRoom(); room.onCreate()
  const sockets = []
  t.after(async () => {
    for (const c of sockets) if (!c.gone) room.onLeave(c)
    room.setSimulationInterval(null); room.clock.clear()
    module.configureLocationPersistence({ mode: 'off' })
    module.configurePresenceHost(null)
  })
  const join = async (userId, c, options) => {
    sockets.push(c)
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    try {
      await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: PAGE, ...options }, { kind: 'player', userId, username: 'P', token: null })
      room.ready(c)
      return null
    } catch (error) { c.gone = true; return error.code ?? error }
  }
  const leave = c => { c.gone = true; room.onLeave(c) }
  /** The current session saves a step and the journal flushes it (checkpoint passed by moving the clock). */
  const step = async (u, ty) => {
    const entry = service.journal.entries.get(u)
    service.journal.note(entry.session, { areaId: 'ciudad-corazon', tx: 31, ty, moveSequence: ty })
    clock += 13_000
    service.journal.tick()
    await waitFor(() => !service.journal.inflight, 'flush')
  }
  return { module, service, room, join, leave, step, host, store, joinOrder, capability, hosting: module.presenceHostingForTesting() }
}

// ── R3: across processes ─────────────────────────────────────────────────────────────────────────────────

test('R3 without attempts (today\'s client): the abandoned join on the NEWER host still takes the row and fences the current one — unchanged', async t => {
  const A = await processWith(t); const B = await processWith(t)
  const u = nextUser()
  const current = socket('current')
  await A.join(u, current, { resume: true })
  await waitFor(() => placed(current), 'current placed on A')
  const old = socket('old')
  await B.join(u, old, {})
  await waitFor(() => placed(old), 'old placed on B')
  assert.equal((await owner(u)).g, B.host.generation, 'the key order decides, as before')
  await A.step(u, 21)
  await waitFor(() => current.leaves.length > 0, 'A fenced')
  assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE])
  assert.equal(A.store.calls.v3.length + B.store.calls.v3.length, 0, 'no attempts: claim v3 never used')
})

for (const recovery of [false, true]) {
  test(`3/4/5 — R3 with attempts (recovery=${recovery}): the old attempt on the newer host is stale_attempt, closed 4410 and never placed; the current one keeps the row, keeps saving and is never closed`, async t => {
    const A = await processWith(t, { recovery }); const B = await processWith(t, { recovery })
    assert.equal(A.capability.state, 'enabled')
    const u = nextUser()
    const current = socket('current')
    await A.join(u, current, { attempt: 2, resume: true })
    await waitFor(() => placed(current), 'current placed on A')
    const where = { ...placed(current) }
    const old = socket('old')
    assert.equal(await B.join(u, old, { attempt: 1 }), null, 'B has never seen this page: admitted, then the database decides')
    await settled(() => old.leaves.length > 0) // old closed on B
    assert.deepEqual(old.leaves, [[STALE_ATTEMPT_CODE, 'stale-attempt']], 'closed quietly (4410)')
    assert.equal(placed(old), null, '5: never placed — one authoritative actor for the page')
    assert.equal(B.module.liveActorForTesting(u), null)
    assert.deepEqual(await owner(u), { g: A.host.generation, attempt: 2, page: PAGE, ty: null }, '3: the current attempt keeps the row despite the smaller key')
    await A.step(u, 21)
    assert.equal((await owner(u)).ty, 21, '4: the current session keeps saving under its own epoch')
    assert.deepEqual(current.leaves, [], '1: never closed')
    assert.deepEqual({ tx: placed(current).tx, ty: placed(current).ty }, { tx: where.tx, ty: where.ty }, '1: not moved')
    assert.deepEqual(B.store.calls.v3.map(c => [c.page, c.attempt, c.recovery]), [[PAGE, 1, recovery]])
  })
}

test('the reverse order (the OLD attempt claimed first on the newer host): the counter authorizes no takeover — the newer attempt gets the v1/v2 answer (documented limit L1)', async t => {
  for (const recovery of [false, true]) {
    const A = await processWith(t, { recovery }); const B = await processWith(t, { recovery })
    const u = nextUser()
    const old = socket(`old-${recovery}`)
    await B.join(u, old, { attempt: 1 })
    await waitFor(() => placed(old), 'old placed on B')
    const current = socket(`current-${recovery}`)
    await A.join(u, current, { attempt: 2, resume: true })
    await settled(() => current.leaves.length > 0) // the current attempt answered
    assert.equal(placed(current), null)
    assert.deepEqual((await owner(u)).g, B.host.generation, 'the live owner keeps the row (no takeover by attempt)')
    // As today: recovery off → replaced (4409); recovery on → a newer active host owns it: retry (4503 draining).
    assert.deepEqual(current.leaves.map(l => l[0]), [recovery ? HOST_DRAINING_CODE : SESSION_REPLACED_CODE])
    assert.deepEqual(old.leaves, [], 'the abandoned socket is the client\'s to leave (it leaves it at once when its join resolves)')
  }
})

// ── R4 / 2: late answers ─────────────────────────────────────────────────────────────────────────────────

test('2 — R4 across processes: the old attempt\'s claim answers LATE (held), after the current one claimed: never published, closed 4410', async t => {
  await database()
  const gate = held()
  let first = true
  const slow = counting(new Proxy(data, {
    get(target, property) {
      if (property === 'locationClaimV3') return async (...args) => { if (first) { first = false; await gate.promise } return target.locationClaimV3(...args) }
      return Reflect.get(target, property)
    },
  }))
  const A = await processWith(t); const B = await processWith(t, { store: slow })
  const u = nextUser()
  const old = socket('old')
  await B.join(u, old, { attempt: 1 })                              // hydrating: its claim is held
  const current = socket('current')
  await A.join(u, current, { attempt: 2, resume: true })
  await waitFor(() => placed(current), 'current placed on A')
  gate.release()
  await settled(() => old.leaves.length > 0) // old answered
  assert.equal(placed(old), null, 'never published')
  assert.deepEqual(old.leaves, [[STALE_ATTEMPT_CODE, 'stale-attempt']])
  assert.deepEqual(current.leaves, [])
  assert.equal((await owner(u)).attempt, 2)
})

test('a PLACED socket of an old attempt (restored from the reconnect cache) is closed 4410 in on; location shadow only counts it', async t => {
  for (const mode of ['on', 'shadow']) {
    const C = await processWith(t, { mode })                           // older host: keeps the account's actor in its reconnect cache
    const B = await processWith(t)                                     // newer host: the page's current attempt
    const u = nextUser()
    const earlier = socket(`earlier-${mode}`)
    await C.join(u, earlier, { tabId: OTHER, attempt: 1 })             // a previous page load, then it went away
    await waitFor(() => placed(earlier), 'earlier placed on C')
    C.leave(earlier)
    const current = socket(`current-${mode}`)
    await B.join(u, current, { attempt: 2 })
    await waitFor(() => placed(current), 'current placed on B')
    const old = socket(`old-${mode}`)
    await C.join(u, old, { attempt: 1, resume: true })                 // the page's abandoned attempt, placed at once from the cache
    assert.ok(placed(old), 'placed before its claim answers')
    await waitFor(() => C.service.stats().staleAttempt.disconnects + C.service.stats().staleAttempt.wouldDisconnect > 0, 'stale answered')
    if (mode === 'on') assert.deepEqual(old.leaves, [[STALE_ATTEMPT_CODE, 'stale-attempt']])
    else assert.deepEqual([old.leaves, C.service.stats().staleAttempt.wouldDisconnect], [[], 1])
    assert.deepEqual(current.leaves, [])
    assert.equal((await owner(u)).g, B.host.generation)
  }
})

// ── 8: duplicates and internal retries ──────────────────────────────────────────────────────────────────

test('8 — the same (page, attempt) replayed on another process: duplicate_attempt, closed 4410, never placed; the first keeps the row', async t => {
  const A = await processWith(t); const B = await processWith(t)
  const u = nextUser()
  const first = socket('first')
  await A.join(u, first, { attempt: 4 })
  await waitFor(() => placed(first), 'first placed')
  const replay = socket('replay')
  await B.join(u, replay, { attempt: 4 })
  await settled(() => replay.leaves.length > 0) // replay answered
  assert.deepEqual(replay.leaves, [[STALE_ATTEMPT_CODE, 'stale-attempt']])
  assert.equal(placed(replay), null)
  assert.deepEqual(first.leaves, [])
  assert.equal((await owner(u)).g, A.host.generation)
})

test('8 — an internal retry of the SAME claim (its answer lost) keeps its key and is idempotent: one take, one epoch', async t => {
  await database()
  let lose = true
  const lossy = counting(new Proxy(data, {
    get(target, property) {
      if (property === 'locationClaimV3') return async (...args) => { const answer = await target.locationClaimV3(...args); if (lose) { lose = false; throw new Error('answer lost') } return answer }
      return Reflect.get(target, property)
    },
  }))
  const A = await processWith(t, { store: lossy })
  const u = nextUser()
  const c = socket('c')
  await A.join(u, c, { attempt: 1 })
  await waitFor(() => placed(c), 'placed at its fallback after the lost answer')
  const epoch = (await db.query('SELECT epoch::int FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0].epoch
  clock += 60_000
  A.service.journal.tick()
  await waitFor(() => A.service.journal.entries.get(u)?.status === 'claimed', 'claimed on the retry')
  const calls = A.store.calls.v3
  assert.equal(calls.length, 2)
  assert.equal(calls[0].seq, calls[1].seq, 'the same key')
  assert.deepEqual([calls[0].attempt, calls[1].attempt], [1, 1], 'the same attempt')
  assert.equal(A.service.journal.entries.get(u).epoch, epoch, 'adopted: the epoch of the first (lost) take')
  assert.deepEqual(c.leaves, [])
})

// ── 6, 7 across processes ───────────────────────────────────────────────────────────────────────────────

test('6/7 — another page\'s attempts are never compared; «Jugar acá» from another page follows the v1/v2 rules (explicit)', async t => {
  const A = await processWith(t, { recovery: true }); const B = await processWith(t, { recovery: true })
  const u = nextUser()
  const live = socket('live')
  await B.join(u, live, { tabId: OTHER, attempt: 9 })
  await waitFor(() => placed(live), 'live on B')
  const here = socket('here')
  await A.join(u, here, { attempt: 1, takeover: true })
  await settled(() => here.leaves.length > 0) // here answered
  // B is live and newer: «Jugar acá» on the older host gets what v2 gives a live owner (retry), never a takeover by attempt.
  assert.deepEqual(here.leaves.map(l => l[0]), [HOST_DRAINING_CODE])
  assert.deepEqual(A.store.calls.v3.map(c => [c.page, c.attempt, c.takeover, c.recovery]), [[PAGE, 1, true, true]])
  assert.equal((await owner(u)).page, OTHER)
})

// ── Flags and compatibility ─────────────────────────────────────────────────────────────────────────────

test('flags: off and shadow never call claim v3 and never close for it (R3 with attempts behaves as today); on does', async t => {
  for (const order of ['off', 'shadow']) {
    const A = await processWith(t, { order }); const B = await processWith(t, { order })
    assert.equal(A.capability.state, 'off', 'not requested: never probed')
    const u = nextUser()
    const current = socket(`current-${order}`)
    await A.join(u, current, { attempt: 2, resume: true })
    await waitFor(() => placed(current), 'current placed')
    const old = socket(`old-${order}`)
    await B.join(u, old, { attempt: 1 })
    await waitFor(() => placed(old), 'old placed (as today)')
    assert.equal(A.store.calls.v3.length + B.store.calls.v3.length, 0)
    assert.equal((await owner(u)).page, null, 'v1 claims never write page info')
  }
})

test('compatibility: an authority without v3 (Edge v6 contract: unknown_op, no joinOrder capability): in-process order only, claims as before', async t => {
  let handler
  try { handler = await import(HANDLER.href) } catch { return t.skip('this Node cannot load TypeScript; the handler has its own Deno tests') }
  await database()
  const SECRET = 's'.repeat(48)
  const rpc = rpcOver(serviceQuery(db))
  const v6 = async (_url, init) => {
    const body = JSON.parse(init.body)
    if (body.op === 'location_claim_v3') return new Response(JSON.stringify({ error: 'unknown_op' }), { status: 400 })
    const response = await handler.handleWorldAuthority(new Request('https://local/world-authority', init), { secret: SECRET, rpc })
    if (body.op !== 'capabilities') return response
    const { joinOrder: _dropped, ...answer } = await response.json()
    return new Response(JSON.stringify(answer), { status: 200 })
  }
  const edge = counting(createEdgePlayerData({ url: 'https://local/world-authority', secret: SECRET, publishableKey: 'anon', fetcher: v6 }))
  const A = await processWith(t, { store: edge, hostStore: data })
  assert.deepEqual([A.capability.state, A.capability.reason], ['disabled', 'edge-v6'])
  const u = nextUser()
  const current = socket('current')
  await A.join(u, current, { attempt: 2, resume: true })
  await waitFor(() => placed(current), 'current placed')
  assert.equal(await A.join(u, socket('old'), { attempt: 1 }), STALE_ATTEMPT_CODE, 'the in-process order still holds')
  assert.deepEqual([edge.calls.v3.length, edge.calls.v1], [0, 1], 'v1 claims, never v3')
  assert.deepEqual(current.leaves, [])
})

test('compatibility: the join-order SQL rolled back under a live process: one v3 call is unsupported, the SAME key goes once through v1, the capability stays off', async t => {
  const local = await openLocalDatabase()
  locals.push(local)
  const store = counting(createSqlPlayerData(serviceQuery(local)))
  const userQuery = { query: (sql, params) => local.query(sql, params) }
  const A = await processWith(t, { store })
  assert.equal(A.capability.state, 'enabled')
  const u = nextUser()
  await local.query('INSERT INTO auth.users VALUES ($1)', [u])
  await local.exec(await readFile(JOIN_ORDER_ROLLBACK, 'utf8'))
  const c = socket('c')
  await A.room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: PAGE, attempt: 1 }, { kind: 'player', userId: u, username: 'P', token: null })
  A.room.ready(c)
  await waitFor(() => placed(c), 'placed')
  assert.deepEqual([A.capability.state, A.capability.reason, A.capability.counters.fallbacks], ['disabled', 'sql-missing', 1])
  assert.equal(store.calls.v3.length, 1)
  assert.equal(store.calls.v1, 1, 'the same key, once, through v1')
  assert.equal((await userQuery.query('SELECT owner_generation::int AS g FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0].g, A.host.generation)
  t.after(() => A.leave(c))
})

test('production path: Edge adapter → world-authority v7 handler → RPC → SQL, two processes: R3 with attempts is fixed end to end', async t => {
  let handler
  try { handler = await import(HANDLER.href) } catch { return t.skip('this Node cannot load TypeScript; the handler has its own Deno tests') }
  await database()
  const SECRET = 's'.repeat(48)
  const rpc = rpcOver(serviceQuery(db))
  const ops = []
  const fetcher = async (_url, init) => { ops.push(JSON.parse(init.body).op); return handler.handleWorldAuthority(new Request('https://local/world-authority', init), { secret: SECRET, rpc }) }
  const edge = () => counting(createEdgePlayerData({ url: 'https://local/world-authority', secret: SECRET, publishableKey: 'anon', fetcher }))
  const A = await processWith(t, { store: edge(), recovery: true }); const B = await processWith(t, { store: edge(), recovery: true })
  assert.equal(A.capability.state, 'enabled')
  const u = nextUser()
  const current = socket('current')
  await A.join(u, current, { attempt: 2, resume: true })
  await waitFor(() => placed(current), 'current placed on A')
  const old = socket('old')
  await B.join(u, old, { attempt: 1 })
  await settled(() => old.leaves.length > 0) // old closed on B
  assert.deepEqual(old.leaves, [[STALE_ATTEMPT_CODE, 'stale-attempt']])
  assert.equal(placed(old), null)
  assert.deepEqual(await owner(u), { g: A.host.generation, attempt: 2, page: PAGE, ty: null })
  assert.deepEqual(current.leaves, [])
  assert.ok(ops.includes('capabilities') && ops.includes('location_claim_v3'), 'the real ops travelled')
  assert.ok(!ops.includes('location_claim_v2') && !ops.includes('location_claim'), 'no v1/v2 claim for a page that sent an attempt')
})

/** supabase-js rpc(fn, namedArgs) over SQL, with the error code PostgREST forwards (42883 here). */
function rpcOver(query) {
  return async (fn, args) => {
    try {
      const names = Object.keys(args)
      const { rows } = await query(`SELECT public.${fn}(${names.map((name, i) => `${name} => $${i + 1}`).join(', ')}) AS data`, names.map(name => args[name]))
      return { data: rows[0]?.data ?? null, error: null }
    } catch (error) {
      return { data: null, error: { message: error.message, code: error.code } }
    }
  }
}
