// CLOUD JOIN-ORDER-1 — the mandatory cases, against the PROTOTYPE tree (an isolated copy; never product):
//   JOIN_ORDER_TREE=<proto>/services/realtime/src/ node --test docs/design/cloud-join-order-1/prototype/joinOrder.test.mjs
// Order is forced with held promises; no sleep decides any order. PGlite here proves BEHAVIOUR only;
// concurrency of the SQL rule is proven on real Postgres by prototype/pg/run.mjs.
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'

if (!process.env.JOIN_ORDER_TREE) throw new Error('set JOIN_ORDER_TREE to the prototype services/realtime/src/ directory')
const R = pathToFileURL(process.env.JOIN_ORDER_TREE).href.replace(/\/?$/, '/')
const at = path => new URL(path, R).href
const { MESSAGE } = await import(at('protocol/messages.js'))
const { SESSION_REPLACED_CODE } = await import(at('protocol/closeCodes.js'))
const { HostLifecycle } = await import(at('presence/hostLifecycle.js'))
const { JoinOrder, ATTEMPT_MAX } = await import(at('presence/joinOrder.js'))
const { openLocalDatabase, serviceQuery } = await import(at('world/persistence/dev/localDatabase.js'))
const { createSqlPlayerData } = await import(at('world/persistence/playerData.js'))
const { createDemoSkillPolicy } = await import(at('world/demoSkillPolicy.js'))
const { createStaticOwnership } = await import(at('world/pokemonOwnership.js'))
const { lastMessage } = await import(at('world/testing.js'))
const { WORLD_PROTOCOL } = await import(at('world/worldProtocol.js'))
const CLAIM_V3 = new URL('./claim_v3.sql', import.meta.url)

const PAGE = 'tab-page-0001'
const OTHER = 'tab-other-001'
const held = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
let instances = 0
let users = 0
const nextUser = () => `f1000000-0000-4000-8000-${String(++users).padStart(12, '0')}`
let db = null
let data = null
test.after(async () => { await db?.close() })
async function database() {
  if (!db) { db = await openLocalDatabase(); await db.exec(await readFile(CLAIM_V3, 'utf8')); data = createSqlPlayerData(serviceQuery(db)) }
  return data
}
async function waitFor(condition, label, ms = 4_000) {
  const t0 = performance.now()
  while (!(await condition())) { if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 5)) }
}
const socket = id => ({ sessionId: id, userData: undefined, messages: [], leaves: [], send(type, payload) { this.messages.push({ type, payload }) }, leave(code, reason) { this.leaves.push([code, reason]) } })
const self = c => lastMessage(c, MESSAGE.SNAPSHOT)?.self ?? null
const fakeHost = () => ({ state: 'active', admitting: true, paused: false, whenActive: async () => true, sessionKey: () => null, stats: () => ({}), identity: null, canClaim: false, canSave: false })
let clock = Date.now()

/** One room process with the prototype join order ('on' unless said) and, when `store` has the recovery SQL, claim v3. */
async function room(t, { mode = 'on', order = 'on', host = fakeHost(), store = null, recovery = false } = {}) {
  const base = store ?? await database()
  const module = await import(at(`rooms/PresenceRoom.js?instance=join-order-proto-${++instances}`))
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  const capability = module.configurePresenceRecovery({ requested: recovery, store: base, log: () => {} })
  await capability.probe()
  const joinOrder = module.configureJoinOrder({ mode: order })
  module.configurePresenceHost(host, { reactToHostChanges: false, store: base })
  const service = module.configureLocationPersistence({ mode, store: base, host, now: () => clock, hydrationTimeoutMs: 1_000 })
  service.journal?.stop()
  const r = new module.PresenceRoom(); r.onCreate()
  const sockets = []
  t.after(async () => { for (const c of sockets) r.onLeave(c); r.setSimulationInterval(null); r.clock.clear(); module.configureLocationPersistence({ mode: 'off' }); module.configurePresenceHost(null) })
  const join = async (userId, c, options) => {
    sockets.push(c)
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    try { await r.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: PAGE, ...options }, { kind: 'player', userId, username: 'P', token: null }); r.ready(c); return null } catch (error) { c.refused = error.code; return error.code }
  }
  return { module, service, room: r, join, joinOrder, host }
}
async function activeHost(store) { const h = new HostLifecycle({ store, renewMs: 600_000, leaseMs: 120_000, log: () => {} }); await h.acquire(); await h.activate(); return h }

// ── 1. the abandoned attempt neither expels nor moves the current one ───────────
test('1 — a late abandoned attempt is refused (4410) at admission; the current connection is untouched (no close, same place)', async t => {
  for (const shape of ['arrives-later', 'parked-in-admission']) {
    const u = nextUser()
    const gate = held()
    const host = fakeHost()
    const reached = held()
    if (shape === 'parked-in-admission') Object.assign(host, { state: 'starting', admitting: false, whenActive: () => { reached.release(); return gate.promise } })
    const p = await room(t, { host })
    const old = socket('old')
    const parked = shape === 'parked-in-admission' ? p.join(u, old, { attempt: 1 }) : null
    if (parked) { await reached.promise; host.state = 'active'; host.admitting = true }   // the old join IS parked inside admit
    const current = socket('current')
    assert.equal(await p.join(u, current, { attempt: 2, resume: true }), null)
    await waitFor(() => self(current), `${shape}: current placed`)
    const where = { ...self(current) }
    if (parked) gate.release(true)
    const refused = parked ? await parked : await p.join(u, old, { attempt: 1 })
    assert.equal(refused, 4410, shape)
    assert.deepEqual(current.leaves, [], `${shape}: the current connection is never closed`)
    assert.deepEqual({ tx: self(current).tx, ty: self(current).ty }, { tx: where.tx, ty: where.ty }, `${shape}: not moved`)
  }
})

// ── 2. a late answer never publishes an old actor ────────────────────────────────
test('2 — a late claim answer of an old attempt never publishes it (hydrating old attempt, then the newer attempt)', async t => {
  const store = await database()
  const host = await activeHost(store)
  t.after(() => host.stop())
  const gate = held()
  let first = true
  const slow = { ...store, locationClaim: async (u, k, o) => { if (first) { first = false; await gate.promise } return store.locationClaim(u, k, o) } }
  const p = await room(t, { host, store: slow })
  const u = nextUser()
  const old = socket('old')
  await p.join(u, old, { attempt: 1 })
  const current = socket('current')
  await p.join(u, current, { attempt: 2, resume: true })
  gate.release()
  await waitFor(() => self(current), 'current placed')
  assert.equal(self(old), null, 'never published')
  assert.deepEqual(current.leaves, [])
})

// ── 3/4/5. across processes: the claim orders the page's attempts (claim v3) ─────
test('3/4/5 — the old attempt lands on a NEWER host: its claim is stale_attempt (never placed in on, closed 4410); the current claim keeps the row and keeps saving; one authoritative actor', async t => {
  const store = await database()
  const hostA = await activeHost(store); const hostB = await activeHost(store)   // B is newer: the old attempt's key would win by key order
  t.after(async () => { await hostA.stop(); await hostB.stop() })
  const A = await room(t, { host: hostA, store, recovery: true })
  const B = await room(t, { host: hostB, store, recovery: true })
  const u = nextUser()
  const current = socket('current')
  await A.join(u, current, { attempt: 2, resume: true })
  await waitFor(() => self(current), 'current placed on A')
  const old = socket('old')
  await B.join(u, old, { attempt: 1 })
  await waitFor(() => old.leaves.length > 0, 'old closed on B', 2_000).catch(() => {})
  assert.deepEqual(old.leaves, [[4410, 'stale-attempt']], 'the old attempt is closed quietly (4410)')
  assert.equal(self(old), null, '5: the old attempt is never placed (one authoritative actor for the page)')
  const row = (await db.query('SELECT owner_generation::int AS g, owner_attempt::int AS a FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0]
  assert.deepEqual(row, { g: hostA.generation, a: 2 }, '3: the current attempt keeps the row despite the smaller key')
  A.service.journal.note(A.service.journal.entries.get(u).session, { areaId: 'ciudad-corazon', tx: 31, ty: 21, moveSequence: 1 })
  clock += 13_000
  A.service.journal.tick()
  await waitFor(() => !A.service.journal.inflight, 'A flush')
  assert.deepEqual(current.leaves, [], '4: the current session keeps saving (never fenced)')
  assert.equal((await db.query('SELECT ty FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0].ty, 21)
})

test('4 — the reverse order: the old attempt claimed first; the newer attempt (smaller key) takes the row; the old session cannot save', async t => {
  const store = await database()
  const hostA = await activeHost(store); const hostB = await activeHost(store)
  t.after(async () => { await hostA.stop(); await hostB.stop() })
  const B = await room(t, { host: hostB, store, recovery: true })   // the old attempt on the NEWER host
  const A = await room(t, { host: hostA, store, recovery: true })   // the newer attempt on the OLDER host
  const u = nextUser()
  const old = socket('old')
  await B.join(u, old, { attempt: 1 })
  await waitFor(() => self(old), 'old placed on B')
  const current = socket('current')
  await A.join(u, current, { attempt: 2, resume: true })
  await waitFor(() => self(current), 'current placed on A')
  B.service.journal.note(B.service.journal.entries.get(u).session, { areaId: 'ciudad-corazon', tx: 33, ty: 20, moveSequence: 1 })
  clock += 13_000
  B.service.journal.tick()
  await waitFor(() => !B.service.journal.inflight, 'B flush')
  const row = (await db.query('SELECT owner_generation::int AS g, tx FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0]
  assert.equal(row.g, hostA.generation, 'the newer attempt owns the row')
  assert.notEqual(row.tx, 33, 'the old session\'s save never lands under the current owner')
  assert.deepEqual(current.leaves, [])
})

// ── 6. a resume never takes another live tab ──────────────────────────────────────
test('6 — a resume of ANOTHER page is still refused while this page is live (4409 at join), whatever its attempt number', async t => {
  const p = await room(t)
  const u = nextUser()
  const live = socket('live')
  await p.join(u, live, { attempt: 1 })
  const other = socket('other')
  assert.equal(await p.join(u, other, { tabId: OTHER, attempt: 99, resume: true }), SESSION_REPLACED_CODE)
  assert.deepEqual(live.leaves, [])
})

// ── 7. «Jugar acá» still replaces explicitly ─────────────────────────────────────
test('7 — «Jugar acá» (a fresh join with takeover, the page\'s next attempt) replaces another page explicitly', async t => {
  const p = await room(t)
  const u = nextUser()
  const live = socket('live')
  await p.join(u, live, { tabId: OTHER, attempt: 3 })
  const here = socket('here')
  assert.equal(await p.join(u, here, { attempt: 5, takeover: true }), null)
  assert.deepEqual(live.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'the other page is replaced (explicit)')
})

// ── 8. duplicates and retries ─────────────────────────────────────────────────────
test('8 — a duplicate attempt is refused without moving the high-water mark; refusals consume nothing; memory is bounded', async t => {
  const p = await room(t)
  const u = nextUser()
  const a = socket('a'); const dup = socket('dup'); const stale = socket('stale'); const next = socket('next')
  await p.join(u, a, { attempt: 4 })
  assert.equal(await p.join(u, dup, { attempt: 4, resume: true }), 4410)
  assert.equal(await p.join(u, stale, { attempt: 3, resume: true }), 4410)
  assert.equal(await p.join(u, next, { attempt: 5, resume: true }), null, 'the next real attempt is admitted')
  assert.deepEqual(a.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'replaced by the newer attempt of the same page')
  const order = new JoinOrder({ mode: 'on', maxPages: 3 })
  for (let i = 0; i < 10; i++) order.observe('u', `tab-page-${String(i).padStart(4, '0')}`, 1)
  assert.equal(order.stats().pages, 3, 'bounded')
})

// ── 9. invalid, out of range or inconsistent attempts ─────────────────────────────
test('9 — invalid attempts fail with 4422 (on); the SQL refuses a page without attempt, an attempt without page, or out-of-range values', async t => {
  const p = await room(t)
  const u = nextUser()
  for (const attempt of [0, -1, 1.5, '3', ATTEMPT_MAX + 1, null]) assert.equal(await p.join(u, socket(`bad-${attempt}`), { attempt }), 4422, String(attempt))
  const store = await database()
  const host = await activeHost(store)
  t.after(() => host.stop())
  await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [u])
  const claim = (page, attempt) => serviceQuery(db)('SELECT public.world_location_claim_keyed_v3($1::uuid, $2::bigint, 1, gen_random_uuid(), $3::uuid, false, $4::text, $5::bigint) AS r', [u, host.generation, host.hostId, page, attempt])
  for (const [page, attempt] of [[PAGE, null], [null, 3], [PAGE, 0], [PAGE, 2 ** 31], ['<b>', 1]]) await assert.rejects(claim(page, attempt), /invalid_attempt/, JSON.stringify([page, attempt]))
})

// ── modes ─────────────────────────────────────────────────────────────────────────
test('modes — off keeps today\'s behaviour (the late attempt replaces: the defect); shadow counts and admits; on enforces', async t => {
  for (const order of ['off', 'shadow', 'on']) {
    const p = await room(t, { order })
    const u = nextUser()
    const current = socket(`current-${order}`)
    await p.join(u, current, { attempt: 2, resume: true })
    const refused = await p.join(u, socket(`old-${order}`), { attempt: 1 })
    if (order === 'on') assert.deepEqual([refused, current.leaves], [4410, []])
    else assert.deepEqual([refused, current.leaves.map(l => l[0])], [null, [SESSION_REPLACED_CODE]], order)
    if (order === 'shadow') assert.equal(p.joinOrder.stats().wouldRefuse, 1)
  }
})

test('legacy clients (no attempt) keep today\'s behaviour; a client\'s attempt does not need the SQL to fix one process', async t => {
  const p = await room(t)
  const u = nextUser()
  const current = socket('current')
  await p.join(u, current, { resume: true })
  await p.join(u, socket('old'), {})
  assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'without attempts nothing orders them')
})
