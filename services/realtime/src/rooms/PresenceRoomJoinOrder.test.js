import test from 'node:test'
import assert from 'node:assert/strict'
import { MESSAGE } from '../protocol/messages.js'
import { INVALID_ATTEMPT_CODE, SESSION_REPLACED_CODE, STALE_ATTEMPT_CODE } from '../protocol/closeCodes.js'
import { ATTEMPT_MAX, DEFAULT_MAX_PAGES, JoinOrder, attemptOf, joinOrderMaxPages, joinOrderMode } from '../presence/joinOrder.js'
import { CONNECTION_LIMIT } from '../presence/capacity.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { lastMessage } from '../world/testing.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'

// CLOUD JOIN-ORDER-2 — the join order of ONE process (presence/joinOrder.js, rooms/presenceHosting.js).
// The original CLOUD JOIN-ORDER-1 reproductions (R1, R2) run here twice: without attempts (today's client:
// the behaviour is unchanged, expectations not relaxed) and with attempts in 'on' (fixed). Every order is
// forced with held promises: no sleep decides anything; a wait that runs out is a failure, never a pass.
// Cross-process cases (claim v3) are in PresenceRoomJoinOrderClaims.test.js.

const PAGE = 'tab-page-0001'
const OTHER = 'tab-other-001'
const held = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
let instances = 0
let users = 0
const nextUser = () => `f2000000-0000-4000-8000-${String(++users).padStart(12, '0')}`
let db = null
let data = null
test.after(async () => { await db?.close() })
async function database() { if (!db) { db = await openLocalDatabase(); data = createSqlPlayerData(serviceQuery(db)) } return data }
async function waitFor(condition, label, ms = 4_000) {
  const t0 = performance.now()
  while (!(await condition())) { if (performance.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`); await new Promise(r => setTimeout(r, 5)) }
}
const socket = id => ({ sessionId: id, userData: undefined, messages: [], leaves: [], send(type, payload) { this.messages.push({ type, payload }) }, leave(code, reason) { this.leaves.push([code, reason]) } })
const placed = c => lastMessage(c, MESSAGE.SNAPSHOT)?.self ?? null
const activeHost = () => ({ state: 'active', admitting: true, paused: false, whenActive: async () => true, sessionKey: () => null, stats: () => ({}), identity: null, canClaim: false, canSave: false })

/** One room process (its own module copy) with location `mode`, a host and a join order (`order`). */
async function room(t, { mode = 'on', order = 'on', maxPages, host = activeHost() } = {}) {
  const store = await database()
  const module = await import(`./PresenceRoom.js?instance=join-order-${++instances}`)
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  const joinOrder = module.configureJoinOrder({ mode: order, ...(maxPages ? { maxPages } : {}) })
  module.configurePresenceHost(host, { reactToHostChanges: false })
  const service = module.configureLocationPersistence({ mode, store, host, hydrationTimeoutMs: 1_000 })
  service.journal?.stop()
  const r = new module.PresenceRoom(); r.onCreate()
  const sockets = []
  t.after(async () => { for (const c of sockets) if (!c.gone) r.onLeave(c); r.setSimulationInterval(null); r.clock.clear(); module.configureLocationPersistence({ mode: 'off' }); module.configurePresenceHost(null) })
  /** Resolves with null (joined) or the refusal code. */
  const join = async (userId, c, options) => {
    sockets.push(c)
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    try {
      await r.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: PAGE, ...options }, { kind: 'player', userId, username: 'P', token: null })
      r.ready(c)
      return null
    } catch (error) { c.gone = true; return error.code ?? error }
  }
  const leave = c => { c.gone = true; r.onLeave(c) }
  return { module, room: r, join, leave, joinOrder, hosting: module.presenceHostingForTesting() }
}

// ── The original reproductions, unchanged expectations for clients without attempts ─────────────────────────

test('R1 without attempts (today\'s client): the parked old join still replaces the current one — behaviour unchanged in every mode', async t => {
  for (const order of ['off', 'shadow', 'on']) {
    const u = nextUser()
    const gate = held(); const reached = held()
    const host = { ...activeHost(), state: 'starting', admitting: false, whenActive: () => { reached.release(); return gate.promise } }
    const p = await room(t, { host, order })
    const old = socket('old')
    const oldJoin = p.join(u, old, {})
    await reached.promise
    host.state = 'active'; host.admitting = true
    const current = socket('current')
    assert.equal(await p.join(u, current, { resume: true }), null)
    await waitFor(() => placed(current), 'current placed')
    gate.release(true)
    assert.equal(await oldJoin, null)
    assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], `${order}: no attempts, nothing orders them (unchanged)`)
    assert.equal(p.joinOrder.stats().legacy, order === 'off' ? 0 : 2)
  }
})

test('R2 without attempts (today\'s client): a late fresh join still replaces the live socket in every location mode', async t => {
  for (const mode of ['off', 'shadow', 'on']) {
    const p = await room(t, { mode })
    const u = nextUser()
    const current = socket(`current-${mode}`)
    await p.join(u, current, { resume: true })
    assert.equal(await p.join(u, socket(`old-${mode}`), {}), null)
    assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], mode)
  }
})

// ── 1. the abandoned attempt neither expels nor moves the current one (R1/R2 with attempts, 'on') ──────────

test('1 — R1 with attempts: the old attempt parked in admission is refused 4410 when released; the current connection is untouched (no close, same place)', async t => {
  const u = nextUser()
  const gate = held(); const reached = held()
  const host = { ...activeHost(), state: 'starting', admitting: false, whenActive: () => { reached.release(); return gate.promise } }
  const p = await room(t, { host })
  const old = socket('old')
  const oldJoin = p.join(u, old, { attempt: 1 })
  await reached.promise                                  // it IS parked inside admit (activation wait)
  host.state = 'active'; host.admitting = true
  const current = socket('current')
  assert.equal(await p.join(u, current, { attempt: 2, resume: true }), null)
  await waitFor(() => placed(current), 'current placed')
  const where = { ...placed(current) }
  gate.release(true)
  assert.equal(await oldJoin, STALE_ATTEMPT_CODE)
  assert.deepEqual(current.leaves, [], 'the current connection is never closed')
  assert.deepEqual(old.leaves, [], 'nothing is sent to the refused join beyond the refusal itself')
  assert.deepEqual({ tx: placed(current).tx, ty: placed(current).ty, areaId: placed(current).areaId }, { tx: where.tx, ty: where.ty, areaId: where.areaId }, 'not moved')
  assert.equal(p.hosting.orderOf(old), null)
})

test('1 — R2 with attempts: the old attempt simply arriving later is refused 4410 in every location mode; the current one is untouched', async t => {
  for (const mode of ['off', 'shadow', 'on']) {
    const p = await room(t, { mode })
    const u = nextUser()
    const current = socket(`current-${mode}`)
    assert.equal(await p.join(u, current, { attempt: 2, resume: true }), null)
    assert.equal(await p.join(u, socket(`old-${mode}`), { attempt: 1 }), STALE_ATTEMPT_CODE, mode)
    assert.deepEqual(current.leaves, [], mode)
  }
})

test('1 — the newer attempt still replaces an older live socket of the SAME page (the page moved on): as today', async t => {
  const p = await room(t)
  const u = nextUser()
  const older = socket('older')
  await p.join(u, older, { attempt: 1 })
  const newer = socket('newer')
  assert.equal(await p.join(u, newer, { attempt: 2, resume: true }), null)
  assert.deepEqual(older.leaves.map(l => l[0]), [SESSION_REPLACED_CODE])
  await waitFor(() => placed(newer), 'newer placed')
})

// ── 5. one authoritative actor per page; the re-check before the replacement ───────────────────────────────

test('5 — the re-check right before the replacement refuses an attempt that is no longer the page\'s latest (nothing closed)', async t => {
  const p = await room(t)
  const u = nextUser()
  const current = socket('current')
  await p.join(u, current, { attempt: 1 })
  await waitFor(() => placed(current), 'current placed')
  // Models a future await between admission and the replacement: a newer attempt of the page is admitted meanwhile.
  const late = socket('late')
  const original = p.hosting.admit.bind(p.hosting)
  p.hosting.admit = async (client, options, auth, liveClientOf) => {
    await original(client, options, auth, liveClientOf)
    if (client === late) p.joinOrder.observe(u, PAGE, 3)
  }
  assert.equal(await p.join(u, late, { attempt: 2, resume: true }), STALE_ATTEMPT_CODE)
  assert.deepEqual(current.leaves, [])
  assert.equal(p.joinOrder.stats().recheckRefused, 1)
  assert.equal(p.module.liveActorForTesting(u) !== null, true, 'the current actor is still the only one')
})

// ── 6. a resume never takes another live page ───────────────────────────────────────────────────────────────

test('6 — a resume of ANOTHER page is refused 4409 while this page is live, whatever its attempt number (it authorizes nothing)', async t => {
  const p = await room(t)
  const u = nextUser()
  const live = socket('live')
  await p.join(u, live, { attempt: 1 })
  for (const attempt of [1, 2, 99, ATTEMPT_MAX]) assert.equal(await p.join(u, socket(`other-${attempt}`), { tabId: OTHER, attempt, resume: true }), SESSION_REPLACED_CODE, String(attempt))
  assert.deepEqual(live.leaves, [])
})

test('6 — attempts are compared only within the same account and page: another page or account starts its own order', async t => {
  const p = await room(t)
  const a = nextUser(); const b = nextUser()
  await p.join(a, socket('a5'), { attempt: 5 })
  assert.equal(await p.join(b, socket('b1'), { attempt: 1 }), null, 'another account: its own order')
  assert.equal(p.joinOrder.isLatest(a, PAGE, 5), true)
  assert.equal(p.joinOrder.isLatest(b, PAGE, 1), true)
})

// ── 7. «Jugar acá» still replaces explicitly ───────────────────────────────────────────────────────────────

test('7 — «Jugar acá» (a fresh join with takeover, the page\'s next attempt) replaces another page explicitly; a low attempt number does not stop it', async t => {
  const p = await room(t)
  const u = nextUser()
  const live = socket('live')
  await p.join(u, live, { tabId: OTHER, attempt: 30 })
  const here = socket('here')
  assert.equal(await p.join(u, here, { attempt: 1, takeover: true }), null, 'pages are ordered separately: the other page\'s numbers do not matter')
  assert.deepEqual(live.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'the other page is replaced (explicit, as today)')
})

// ── 8. duplicates, retries and memory ──────────────────────────────────────────────────────────────────────

test('8 — a duplicate or older attempt is refused without moving the mark; refusals consume nothing; the next real attempt is admitted', async t => {
  const p = await room(t)
  const u = nextUser()
  const a = socket('a')
  await p.join(u, a, { attempt: 4 })
  assert.equal(await p.join(u, socket('dup'), { attempt: 4, resume: true }), STALE_ATTEMPT_CODE)
  assert.equal(await p.join(u, socket('stale'), { attempt: 3, resume: true }), STALE_ATTEMPT_CODE)
  assert.equal(await p.join(u, socket('dup2'), { attempt: 4, resume: true }), STALE_ATTEMPT_CODE)
  assert.deepEqual(a.leaves, [], 'the live socket is untouched by refusals')
  assert.equal(await p.join(u, socket('next'), { attempt: 5, resume: true }), null, 'the next real attempt is admitted')
  const stats = p.joinOrder.stats()
  assert.deepEqual([stats.duplicate, stats.stale, stats.admitted], [2, 1, 2])
})

test('8 — a join refused BEFORE the order (4503 draining) consumes no mark: the same attempt is admitted later', async t => {
  const p = await room(t)
  const u = nextUser()
  p.hosting.draining = true
  assert.equal(await p.join(u, socket('draining'), { attempt: 1 }), 4503)
  p.hosting.resetDraining()
  assert.equal(await p.join(u, socket('later'), { attempt: 1 }), null)
})

test('D3 — memory is bounded; a page with a live socket is never forgotten; an idle one is, counted', () => {
  const live = new Set(['u\nlive-page-0001'])
  const order = new JoinOrder({ mode: 'on', maxPages: 3, isLive: (u, page) => live.has(`${u}\n${page}`) })
  order.observe('u', 'live-page-0001', 7)                       // oldest, but live
  for (let i = 0; i < 10; i++) order.observe('u', `idle-page-${String(i).padStart(4, '0')}`, 1)
  assert.equal(order.stats().pages, 3, 'bounded')
  assert.equal(order.observe('u', 'live-page-0001', 6), 'stale', 'the live page kept its mark')
  assert.ok(order.stats().keptLive >= 1)
  assert.equal(order.stats().evicted, 8)
  assert.equal(order.observe('u', 'idle-page-0000', 1), 'admit', 'a forgotten idle page starts over (documented: the database still orders it)')
  // Every page live: the map grows past the bound instead of forgetting one, and says so.
  const all = new JoinOrder({ mode: 'on', maxPages: 2, isLive: () => true })
  for (let i = 0; i < 4; i++) all.observe('u', `live-page-${i}000`, 1)
  assert.equal(all.stats().pages, 4)
  assert.equal(all.stats().evicted, 0)
  assert.ok(all.stats().overflow > 0)
})

test('D3 — in the room, the live page\'s record survives a flood of other pages', async t => {
  const p = await room(t, { maxPages: CONNECTION_LIMIT })
  const u = nextUser()
  const current = socket('current')
  await p.join(u, current, { attempt: 3 })
  for (let i = 0; i < CONNECTION_LIMIT + 20; i++) p.joinOrder.observe(nextUser(), PAGE, 1)
  assert.equal(await p.join(u, socket('old'), { attempt: 2, resume: true }), STALE_ATTEMPT_CODE)
  assert.deepEqual(current.leaves, [])
})

test('D3 — WORLD_JOIN_ORDER_MAX_PAGES: an integer in [connection limit, 1 000 000]; anything else is the default', () => {
  assert.equal(joinOrderMaxPages({}), DEFAULT_MAX_PAGES)
  assert.equal(joinOrderMaxPages({ WORLD_JOIN_ORDER_MAX_PAGES: '5000' }), 5000)
  for (const raw of ['0', '-1', String(CONNECTION_LIMIT - 1), '1.5', 'many', '1000001']) assert.equal(joinOrderMaxPages({ WORLD_JOIN_ORDER_MAX_PAGES: raw }), DEFAULT_MAX_PAGES, raw)
})

// ── 9. invalid, out of range or inconsistent attempts ──────────────────────────────────────────────────────

test('9 — invalid attempts fail with 4422 in on (nothing remembered, the live socket untouched); shadow counts and admits; off ignores them', async t => {
  for (const order of ['on', 'shadow', 'off']) {
    const p = await room(t, { order })
    const u = nextUser()
    const live = socket(`live-${order}`)
    await p.join(u, live, { tabId: OTHER, attempt: 1 })
    const bad = [0, -1, 1.5, '3', ATTEMPT_MAX + 1, null, Number.NaN, {}]
    for (const attempt of bad) {
      const code = await p.join(u, socket(`bad-${order}-${String(attempt)}`), { attempt, takeover: true })
      assert.equal(code, order === 'on' ? INVALID_ATTEMPT_CODE : null, `${order} ${String(attempt)}`)
    }
    // An attempt without a readable page is inconsistent too.
    const noPage = await p.join(u, socket(`nopage-${order}`), { tabId: '<b>', attempt: 2, takeover: true })
    assert.equal(noPage, order === 'on' ? INVALID_ATTEMPT_CODE : null)
    if (order === 'on') assert.deepEqual(live.leaves, [], 'refused before anything is replaced')
    assert.equal(p.joinOrder.stats().invalid, order === 'off' ? 0 : bad.length + 1)
    assert.equal(p.joinOrder.stats().pages, order === 'off' ? 0 : 1)
  }
})

test('9 — attemptOf: absent is legacy; present must be a safe integer in [1, 2^31 − 1]', () => {
  assert.deepEqual(attemptOf({}), { ok: true, attempt: null })
  assert.deepEqual(attemptOf(undefined), { ok: true, attempt: null })
  assert.deepEqual(attemptOf({ attempt: 1 }), { ok: true, attempt: 1 })
  assert.deepEqual(attemptOf({ attempt: ATTEMPT_MAX }), { ok: true, attempt: ATTEMPT_MAX })
  for (const attempt of [0, ATTEMPT_MAX + 1, 2.5, '1', null, true]) assert.equal(attemptOf({ attempt }).ok, false, String(attempt))
})

// ── modes and legacy ─────────────────────────────────────────────────────────────────────────────────────

test('modes — off: today\'s behaviour (the late attempt replaces); shadow: counts wouldRefuse and admits as today; on: refuses', async t => {
  assert.equal(joinOrderMode({}), 'off')
  assert.equal(joinOrderMode({ WORLD_JOIN_ORDER: 'ON' }), 'off')
  assert.equal(joinOrderMode({ WORLD_JOIN_ORDER: 'shadow' }), 'shadow')
  assert.equal(joinOrderMode({ WORLD_JOIN_ORDER: 'on' }), 'on')
  for (const order of ['off', 'shadow', 'on']) {
    const p = await room(t, { order })
    const u = nextUser()
    const current = socket(`current-${order}`)
    await p.join(u, current, { attempt: 2, resume: true })
    const refused = await p.join(u, socket(`old-${order}`), { attempt: 1 })
    if (order === 'on') assert.deepEqual([refused, current.leaves], [STALE_ATTEMPT_CODE, []])
    else assert.deepEqual([refused, current.leaves.map(l => l[0])], [null, [SESSION_REPLACED_CODE]], order)
    assert.equal(p.joinOrder.stats().wouldRefuse, order === 'shadow' ? 1 : 0)
    assert.deepEqual(p.hosting.orderOf(current), order === 'on' ? { page: PAGE, attempt: 2 } : null, 'only on enforces (and carries the page to the claim)')
  }
})

test('guests never take part: attempts of a guest are ignored', async t => {
  const p = await room(t)
  const guest = socket('guest')
  await p.room.onJoin(guest, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: PAGE, attempt: 'nonsense' }, { kind: 'guest' })
  guest.gone = true; p.room.onLeave(guest)
  assert.equal(p.joinOrder.stats().invalid, 0)
})

test('metrics expose aggregates only (no account, page or attempt)', async t => {
  const p = await room(t)
  const u = nextUser()
  await p.join(u, socket('a'), { attempt: 2 })
  await p.join(u, socket('b'), { attempt: 1 })
  const { metrics } = await import('../observability/metrics.js')
  const text = JSON.stringify(p.joinOrder.stats())
  assert.ok(!text.includes(u) && !text.includes(PAGE))
  assert.equal(typeof metrics.joinOrder, 'function')
})
