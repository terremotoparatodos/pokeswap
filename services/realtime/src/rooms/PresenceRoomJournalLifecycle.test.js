import test from 'node:test'
import assert from 'node:assert/strict'
import { MESSAGE } from '../protocol/messages.js'
import { HostLifecycle } from '../presence/hostLifecycle.js'
import { openLocalDatabase, serviceQuery } from '../world/persistence/dev/localDatabase.js'
import { createSqlPlayerData } from '../world/persistence/playerData.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { lastMessage, openDirection } from '../world/testing.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'

// H-1 (CLOUD READINESS-3 review, fixed on the JOIN-ORDER-2 candidate) — the location journal's lifecycle across a
// displacement and a standby promotion. Nothing here stops the journal or calls its tick by hand: the journal
// runs on the PRODUCTION timer that LocationService.start() installs (setInterval), and the test only drives
// the scheduler (node:test mock timers, setInterval only) and the journal's clock. Displacement and promotion
// are the real ones: a newer host's renew answer drains this process, the standby probe promotes it.

let db = null
let data = null
test.after(async () => { await db?.close() })
let users = 0
const nextUser = () => `abababab-0000-4000-8000-${String(++users).padStart(12, '0')}`
let instances = 0
async function database() { if (!db) { db = await openLocalDatabase(); data = createSqlPlayerData(serviceQuery(db)) } return data }
const created = []
test.afterEach(async () => { for (const h of created.splice(0)) await h.stop() })
const quietHost = store => { const h = new HostLifecycle({ store, renewMs: 600_000, leaseMs: 15_000, log: () => {} }); created.push(h); return h }
async function activeHost() { const h = quietHost(data); await h.acquire(); await h.activate(); return h }
async function waitFor(condition, label, ms = 4_000) {
  const started = performance.now()
  while (!(await condition())) {
    if (performance.now() - started > ms) throw new Error(`timed out waiting for ${label}`)
    await new Promise(resolve => setImmediate(resolve))
  }
}
const stored = async u => (await db.query('SELECT tx, ty, owner_generation::int AS g FROM public.world_player_locations WHERE user_id = $1', [u])).rows[0] ?? null
const placed = c => lastMessage(c, MESSAGE.SNAPSHOT)?.self ?? null

/** A store whose next claim for `userId` fails (a transient authority error); everything else is the SQL adapter. */
function failingOnce(base) {
  const failNext = new Set()
  const store = new Proxy(base, {
    get(target, property) {
      if (property === 'failNextClaim') return userId => failNext.add(userId)
      const real = Reflect.get(target, property)
      if (property === 'locationClaim' || property === 'locationClaimV2' || property === 'locationClaimV3') {
        return async (userId, ...rest) => { if (failNext.delete(userId)) throw new Error('authority 503'); return real.call(target, userId, ...rest) }
      }
      return real
    },
  })
  return store
}

/**
 * One room process with the production journal timer. `t.mock.timers` must be enabled (setInterval) BEFORE this,
 * so the interval LocationService.start() installs is the controllable one.
 */
async function processWith(t, journalClock) {
  await database()
  const store = failingOnce(data)
  const module = await import(new URL(`./PresenceRoom.js?instance=journal-lifecycle-${++instances}`, import.meta.url).href)
  module.configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
  await module.configurePresenceRecovery({ requested: true, store, log: () => {} }).probe()
  // H2 containment: these tests exercise the standby's promotion; they ask for it.
  module.configurePresenceStandby({ requested: true })
  const host = quietHost(store)
  await host.acquire(); await host.activate()
  module.configurePresenceHost(host, { reactToHostChanges: true, store })
  const service = module.configureLocationPersistence({ mode: 'on', store, host, now: () => journalClock.now, hydrationTimeoutMs: 1_000 })
  const room = new module.PresenceRoom(); room.onCreate()
  const hosting = module.presenceHostingForTesting()
  const clients = []
  t.after(async () => {
    hosting.beginShutdown()
    await hosting.standbyIdle()
    for (const c of clients) if (!c.gone) room.onLeave(c)
    room.setSimulationInterval(null); room.clock.clear()
    module.configureLocationPersistence({ mode: 'off' })
    await hosting.host?.stop()
    module.configurePresenceHost(null)
  })
  const join = async (userId, options = {}) => {
    await db.query('INSERT INTO auth.users VALUES ($1) ON CONFLICT DO NOTHING', [userId])
    const c = { sessionId: `${userId}-${clients.length}`, userData: undefined, messages: [], leaves: [], send(type, payload) { this.messages.push({ type, payload }) }, leave(code, reason) { this.leaves.push([code, reason]) } }
    clients.push(c)
    await room.onJoin(c, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 3, tabId: 'tab-page-0001', ...options }, { kind: 'player', userId, username: 'P', token: null })
    room.ready(c)
    await waitFor(() => placed(c) || c.leaves.length > 0, 'the join to settle')
    return c
  }
  /** One accepted step (the server answers with authority); returns where the actor stands. */
  const step = async c => {
    const self = placed(c)
    const at = module.liveActorForTesting(c.userData.actorId)
    const direction = openDirection(at.areaId, at, ['right', 'left', 'down', 'up'])
    room.move(c, { direction, running: false, sequence: at.moveSequence + 1 })
    assert.notDeepEqual({ tx: at.tx, ty: at.ty }, { tx: self.tx, ty: self.ty }, 'the step was accepted')
    return { tx: at.tx, ty: at.ty }
  }
  const leave = c => { c.gone = true; room.onLeave(c) }
  return { module, store, host, service, room, hosting, join, step, leave }
}

/** Runs the production timer for `seconds` of scheduler time, moving the journal's clock with it; lets each tick's I/O finish. */
async function run(t, journalClock, journal, seconds) {
  for (let i = 0; i < seconds; i++) {
    journalClock.now += 1_000
    t.mock.timers.tick(1_000)
    await waitFor(() => !journal.inflight && [...journal.entries.values()].every(e => e.claimsInFlight === 0), 'the tick\'s I/O')
  }
}

/** Displaced by a newer host (its renew answer), then promoted by the standby once that host stopped. */
async function displaceThenPromote(p) {
  const X = await activeHost()
  await p.hosting.host.renew()
  await waitFor(() => p.hosting.displaced, 'displacement')
  await X.drain(); await X.stop()
  await p.hosting.probeStandbyNow()
  assert.equal(p.hosting.standbyCounters.promotions >= 1, true, 'promoted')
  assert.equal(p.hosting.serving, true)
}

test('H-1: after a promotion the journal runs again on its production timer — checkpoint, urgent disconnect and claim retry', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const clock = { now: 1_000_000 }
  const p = await processWith(t, clock)
  const journal = p.service.journal

  // Control (before any displacement): the production timer saves a checkpoint.
  const u0 = nextUser()
  const c0 = await p.join(u0)
  const s0 = await p.step(c0)
  await run(t, clock, journal, 13)
  assert.deepEqual(await stored(u0).then(r => r && { tx: r.tx, ty: r.ty }), s0, 'before: the checkpoint landed (the timer is wired)')
  p.leave(c0)
  await run(t, clock, journal, 2)

  await displaceThenPromote(p)
  const promoted = p.hosting.host

  // 1. Checkpoint of a session that joined after the promotion.
  const u1 = nextUser()
  const c1 = await p.join(u1)
  assert.deepEqual(c1.leaves, [])
  assert.equal((await stored(u1)).g, promoted.generation, 'claimed by the promoted identity (the claim is not timer-driven)')
  const s1 = await p.step(c1)
  await run(t, clock, journal, 13)
  assert.deepEqual(await stored(u1).then(r => ({ tx: r.tx, ty: r.ty })), s1, 'after promotion: the CHECKPOINT is saved')

  // 2. Urgent save on disconnect.
  const s1b = await p.step(c1)
  p.leave(c1)
  await run(t, clock, journal, 2)
  assert.deepEqual(await stored(u1).then(r => ({ tx: r.tx, ty: r.ty })), s1b, 'after promotion: the DISCONNECT is saved')

  // 3. A claim that failed (transient) is retried by the timer, with its key.
  const u2 = nextUser()
  p.store.failNextClaim(u2)
  const c2 = await p.join(u2)
  assert.equal(journal.entries.get(u2).status, 'unclaimed', 'the first claim failed: placed at the fallback, unclaimed')
  await run(t, clock, journal, 30)
  assert.equal(journal.entries.get(u2).status, 'claimed', 'after promotion: the CLAIM is retried and lands')
  assert.equal((await stored(u2)).g, promoted.generation)
  p.leave(c2)
})

test('H-1: one timer only — a second displacement and promotion never doubles the ticks', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const clock = { now: 2_000_000 }
  const p = await processWith(t, clock)
  const journal = p.service.journal
  let ticks = 0
  const original = journal.tick.bind(journal)
  journal.tick = (...args) => { ticks++; return original(...args) }   // counts what the production interval calls
  await displaceThenPromote(p)
  await displaceThenPromote(p)
  ticks = 0
  await run(t, clock, journal, 5)
  assert.equal(ticks, 5, 'exactly one tick per second')
})

test('H-1: a definitive shutdown stays definitive — no tick after it, and a promotion that answers late never restarts the journal', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const clock = { now: 3_000_000 }
  const p = await processWith(t, clock)
  const journal = p.service.journal
  const X = await activeHost()
  await p.hosting.host.renew()
  await waitFor(() => p.hosting.displaced, 'displacement')
  await X.drain(); await X.stop()
  // The exclusive activation of the promotion answers only after the shutdown began.
  let release
  const gate = new Promise(resolve => { release = resolve })
  const original = p.store.presenceActivateExclusive
  p.hosting.store = new Proxy(p.store, { get: (target, property) => property === 'presenceActivateExclusive' ? async (...args) => { await gate; return original.apply(target, args) } : Reflect.get(target, property) })
  const promotion = p.hosting.probeStandbyNow()
  await waitFor(() => p.hosting.standby?.promoting, 'the promotion in flight')
  p.hosting.beginShutdown()
  await p.hosting.drain()
  release()
  await promotion
  await p.hosting.stopForShutdown()
  assert.equal(p.hosting.standbyCounters.promotions, 0, 'never installed')
  let ticks = 0
  const tick = journal.tick.bind(journal)
  journal.tick = (...args) => { ticks++; return tick(...args) }
  await run(t, clock, journal, 5)
  assert.equal(ticks, 0, 'the stopped journal never ticks again')
  assert.equal(journal.timer, null)
})

test('H-1: a replaced (disabled) location service is never restarted by a promotion', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const clock = { now: 4_000_000 }
  const p = await processWith(t, clock)
  const old = p.service.journal
  const X = await activeHost()
  await p.hosting.host.renew()
  await waitFor(() => p.hosting.displaced, 'displacement')
  const fresh = p.module.configureLocationPersistence({ mode: 'on', store: p.store, host: p.hosting.host, now: () => clock.now, hydrationTimeoutMs: 1_000 })
  await X.drain(); await X.stop()
  await p.hosting.probeStandbyNow()
  assert.equal(old.disabled, true)
  assert.equal(old.timer, null, 'the replaced journal stays stopped')
  assert.notEqual(fresh.journal.timer, null, 'the current one runs')
})

test('H-1: LocationService.resume() — one timer whatever the calls; never after disable()', async t => {
  t.mock.timers.enable({ apis: ['setInterval'] })
  const { LocationService } = await import('../presence/locationService.js')
  const service = new LocationService({ mode: 'on', store: await database() })
  service.start()
  const first = service.journal.timer
  service.resume(); service.resume()
  assert.equal(service.journal.timer, first, 'the same interval')
  await service.shutdown(10)
  assert.equal(service.journal.timer, null)
  service.resume()
  assert.notEqual(service.journal.timer, null, 'a drain that did not end the process can resume')
  service.disable()
  service.resume(); service.start()
  assert.equal(service.journal.timer, null, 'disabled stays stopped')
})
