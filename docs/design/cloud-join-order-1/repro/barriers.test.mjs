// CLOUD JOIN-ORDER-1 — where the late abandoned join replaces the page's live connection, with
// DETERMINISTIC barriers (held promises; no sleeps decide any order). Runs the REAL PresenceRoom of
// the checkout under test (default: this tree). Every expectation here describes what HAPPENS on the
// checkout (5ca9ccd): it is evidence, not a product test.
//   node --test docs/design/cloud-join-order-1/repro/barriers.test.mjs
//   JOIN_ORDER_TREE=<path to services/realtime/src/> to run it against another tree (the prototype).
import test from 'node:test'
import assert from 'node:assert/strict'
import { pathToFileURL } from 'node:url'

const R = process.env.JOIN_ORDER_TREE ? pathToFileURL(process.env.JOIN_ORDER_TREE).href.replace(/\/?$/, '/') : new URL('../../../../services/realtime/src/', import.meta.url).href
const at = path => new URL(path, R).href
const { MESSAGE } = await import(at('protocol/messages.js'))
const { SESSION_REPLACED_CODE } = await import(at('protocol/closeCodes.js'))
const { HostLifecycle } = await import(at('presence/hostLifecycle.js'))
const { openLocalDatabase, serviceQuery } = await import(at('world/persistence/dev/localDatabase.js'))
const { createSqlPlayerData } = await import(at('world/persistence/playerData.js'))
const { createDemoSkillPolicy } = await import(at('world/demoSkillPolicy.js'))
const { createStaticOwnership } = await import(at('world/pokemonOwnership.js'))
const { lastMessage } = await import(at('world/testing.js'))
const { WORLD_PROTOCOL } = await import(at('world/worldProtocol.js'))
const PROTOTYPE = process.env.JOIN_ORDER_EXPECT === 'fixed'

const TAB = 'tab-page-0001'
const held = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
let instances = 0
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

/** One room process (its own module copy) with location `mode`, a host and a store. */
// The journal's clock (checkpoints are 10 s apart): a test moves it instead of waiting. The database keeps real time.
let clock = Date.now()
async function room(t, { mode = 'on', host, store }) {
  const module = await import(at(`rooms/PresenceRoom.js?instance=join-order-${++instances}`))
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  module.configurePresenceHost(host, { reactToHostChanges: false })
  const service = module.configureLocationPersistence({ mode, store, host, now: () => clock, hydrationTimeoutMs: 1_000 })
  service.journal?.stop()
  const r = new module.PresenceRoom(); r.onCreate()
  const sockets = []
  t.after(async () => { for (const c of sockets) r.onLeave(c); r.setSimulationInterval(null); r.clock.clear(); module.configureLocationPersistence({ mode: 'off' }); module.configurePresenceHost(null) })
  const join = (userId, c, options) => { sockets.push(c); return r.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: TAB, ...options }, { kind: 'player', userId, username: 'P', token: null }).then(() => r.ready(c)) }
  return { module, service, room: r, join }
}

test('R1 — admission: the OLD join is parked on an await inside admit (activation wait); the NEW one passes; released, the old one replaces it', async t => {
  const store = await database()
  const userId = 'f0000000-0000-4000-8000-000000000001'
  await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
  // A host still 'starting': admit() awaits whenActive() — the barrier holds the OLD join exactly there.
  const gate = held()
  const host = { state: 'starting', admitting: false, paused: false, whenActive: () => gate.promise, sessionKey: () => null, stats: () => ({}), identity: null, canClaim: false, canSave: false }
  const p = await room(t, { host, store })
  const old = socket('old')
  const oldJoin = p.join(userId, old, {})                          // the page's FIRST join (fresh), now abandoned by the page
  await Promise.resolve()
  host.state = 'active'; host.admitting = true                     // the activation lands
  const current = socket('current')
  await p.join(userId, current, { resume: true })                  // the page's CURRENT connection (renew → resume)
  await waitFor(() => placed(current), 'the current socket placed')
  gate.release(true)                                               // the old join resumes after its await
  await oldJoin
  if (PROTOTYPE) {
    assert.deepEqual(current.leaves, [], 'FIXED: the current connection is untouched')
    assert.ok(old.leaves.length > 0 || old.refused, 'FIXED: the stale attempt is refused')
  } else {
    assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'OBSERVED: replaced at admission, right after the await (4409 to the current socket)')
    assert.deepEqual(old.leaves, [], 'OBSERVED: the abandoned join owns the player in this process')
  }
})

test('R2 — onAuth / matchmaking: the old join simply reaches onJoin later (no await inside the room needed); same outcome', async t => {
  const store = await database()
  const userId = 'f0000000-0000-4000-8000-000000000002'
  await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
  const host = { state: 'active', admitting: true, paused: false, whenActive: async () => true, sessionKey: () => null, stats: () => ({}), identity: null, canClaim: false, canSave: false }
  for (const mode of ['off', 'shadow', 'on']) {
    const p = await room(t, { mode, host, store })
    const current = socket(`current-${mode}`)
    await p.join(userId, current, { resume: true })
    const old = socket(`old-${mode}`)
    let refused = null
    await p.join(userId, old, {}).catch(error => { refused = error.code })
    if (PROTOTYPE) assert.deepEqual([current.leaves, refused !== null || old.leaves.length > 0], [[], true], `FIXED in ${mode}`)
    else assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], `OBSERVED in ${mode}: a fresh join always replaces the live socket (4409 to a protocol-3 client in every mode)`)
  }
})

test('R3 — across processes: the old attempt lands on a NEWER host; its claim key outranks the current one and takes the row; the current session is fenced', async t => {
  const store = await database()
  const userId = 'f0000000-0000-4000-8000-000000000003'
  await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
  const hostA = new HostLifecycle({ store, renewMs: 600_000, leaseMs: 120_000, log: () => {} }); await hostA.acquire(); await hostA.activate()
  const hostB = new HostLifecycle({ store, renewMs: 600_000, leaseMs: 120_000, log: () => {} }); await hostB.acquire(); await hostB.activate()
  t.after(async () => { await hostA.stop(); await hostB.stop() })
  const A = await room(t, { host: hostA, store })                  // older host: serves the page's CURRENT connection
  const B = await room(t, { host: hostB, store })                  // newer host: the late ABANDONED join lands here
  const current = socket('current')
  await A.join(userId, current, { resume: true })
  await waitFor(() => placed(current), 'current placed on A')
  const old = socket('old')
  await B.join(userId, old, {})
  await waitFor(() => placed(old), 'old placed on B')
  const owner = (await db.query('SELECT owner_generation::int AS g FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0]
  // A's next save for the current session is refused (stale) → fenced → closed as replaced in `on`.
  A.service.journal.note(A.service.journal.entries.get(userId).session, { areaId: 'ciudad-corazon', tx: 31, ty: 21, moveSequence: 1 })
  clock += 13_000                                                 // past the checkpoint: the next tick saves
  A.service.journal.tick()
  await waitFor(() => !A.service.journal.inflight, 'A flush')
  await waitFor(() => current.leaves.length > 0 || PROTOTYPE, 'A fenced', 2_000).catch(() => {})
  if (PROTOTYPE) {
    assert.equal(owner.g, hostA.generation, 'FIXED: the row stays with the current attempt')
    assert.deepEqual(current.leaves, [])
  } else {
    assert.equal(owner.g, hostB.generation, 'OBSERVED: the abandoned attempt took the row by key order (claim)')
    assert.deepEqual(current.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'OBSERVED: the current session is fenced on its next save (4409)')
  }
})

test('R4 — a late CLAIM answer of the old join (hydrating) is already guarded: it does not publish the old actor once the current one replaced it', async t => {
  const base = await database()
  const userId = 'f0000000-0000-4000-8000-000000000004'
  await db.query('INSERT INTO auth.users VALUES ($1)', [userId])
  const hostA = new HostLifecycle({ store: base, renewMs: 600_000, leaseMs: 120_000, log: () => {} }); await hostA.acquire(); await hostA.activate()
  t.after(() => hostA.stop())
  const gate = held()
  let first = true
  const store = { ...base, locationClaim: async (u, k) => { if (first) { first = false; await gate.promise } return base.locationClaim(u, k) }, locationSave: base.locationSave }
  const A = await room(t, { host: hostA, store })
  const old = socket('old')
  await A.join(userId, old, {})                                    // hydrating: its claim is held
  const current = socket('current')
  await A.join(userId, current, { resume: true })                  // same tab, resume: replaces the hydrating old one
  gate.release()
  await waitFor(() => placed(current), 'current placed')
  assert.equal(placed(old), null, 'the old actor is never published (existing guard in #finish)')
  assert.deepEqual(current.leaves, [])
  assert.deepEqual(old.leaves.map(l => l[0]), [SESSION_REPLACED_CODE], 'the old socket is the one closed')
})
