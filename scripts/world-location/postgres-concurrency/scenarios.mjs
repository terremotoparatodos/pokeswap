// WORLD LOCATION-4 F2 — deterministic interleavings on real Postgres for the two locks of
// 20261003120000_world_location_ordering.sql:
//
//   LOCK TABLE … SHARE ROW EXCLUSIVE in world_presence_activate   (RV1 removes it): A1, A2, A4
//   FOR SHARE on the host row in world_location_claim_keyed        (RV2 removes it): A5, A6
//
// Every actor is its own backend (PgSession) with the real role (SET ROLE service_role). A barrier
// is an explicit transaction held open by one actor plus a lock wait of another actor CONFIRMED in
// pg_stat_activity before the scenario moves on. The assertions check answers, host state and row
// ownership — never whether a lock exists: an operation may block in one build and not in another;
// only what is observable afterwards is judged.
//
// Controls (must pass on every build): A3 (activate against renew), and the two plain races A4b and
// A5b — the shape of the earlier staging tests (Q6), which cannot hit the window (README §3).

import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { SqlError, sleep, withDeadline } from './pgSession.mjs'

export class BarrierError extends Error {}

const STEP_MS = 5_000    // a launched operation must finish or be seen lock-waiting within this
const ANSWER_MS = 10_000 // a released operation must answer within this
const LV = 'f2.1'        // a synthetic layout version
const q = value => `'${String(value).replaceAll("'", "''")}'`

const sql = {
  acquire: (h, ms = 30_000) => `SELECT public.world_presence_acquire(${q(h)}::uuid, ${ms})::text;`,
  activate: (g, h, ms = 30_000) => `SELECT public.world_presence_activate(${g}, ${q(h)}::uuid, ${ms})::text;`,
  renew: (g, h, ms = 30_000) => `SELECT public.world_presence_renew(${g}, ${q(h)}::uuid, ${ms})::text;`,
  drain: (g, h, ms = 10_000) => `SELECT public.world_presence_drain(${g}, ${q(h)}::uuid, ${ms})::text;`,
  stop: (g, h) => `SELECT public.world_presence_stop(${g}, ${q(h)}::uuid)::text;`,
  claim: (u, g, n, s, h) => `SELECT public.world_location_claim_keyed(${q(u)}::uuid, ${g}, ${n}, ${q(s)}::uuid, ${q(h)}::uuid)::text;`,
  save: (rows, g, h) => `SELECT public.world_location_save_keyed(${q(JSON.stringify(rows))}::jsonb, ${g}, ${q(h)}::uuid)::text;`,
}
const row = (userId, epoch, seq, tx) => ({ userId, epoch, seq, areaId: 'pradera', tx, ty: -60, layoutVersion: LV })

/** An operation sent without waiting for it; `done` flips when its answer arrived (= committed). */
function launch(session, text) {
  const op = { done: false }
  op.answer = session.send(text).then(r => { op.done = true; return r })
  return op
}
/** Waits until `op` finished or its backend is waiting on a lock (pg_stat_activity), and says which. */
async function step(ctx, op, session) {
  const end = Date.now() + STEP_MS
  while (Date.now() < end) {
    if (op.done) return 'done'
    const wait = await ctx.mon.one(`SELECT coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') FROM pg_stat_activity WHERE pid = ${session.pid};`)
    if (wait?.startsWith('Lock:')) { await sleep(5); if (!op.done) return `waiting(${wait})` }
    await sleep(10)
  }
  throw new BarrierError(`[${session.name}] neither finished nor lock-waiting after ${STEP_MS} ms`)
}
/** The released operation's parsed answer; an SQL error here is unexpected (harness_error). */
async function answer(op, what) {
  const r = await withDeadline(op.answer, ANSWER_MS, what)
  if (!r.ok) throw new SqlError(`${what}: ${r.errors.join(' | ')}`)
  return JSON.parse(r.rows[0])
}

/** A host on its own connection: acquired (starting) and, unless asked otherwise, activated. */
async function host(ctx, name, { activate = true } = {}) {
  const s = await ctx.open(name)
  const id = randomUUID()
  const { generation } = await s.json(sql.acquire(id))
  ctx.hosts.push(generation)
  if (activate) assert.equal((await s.json(sql.activate(generation, id))).status, 'active', `${name} activates`)
  return { s, id, g: generation, name }
}

// A1 / A2 / A3 — activate of a STARTING host while a stop / drain / renew of the SAME host holds its
// transaction open (that operation commits first). Invariants I16/I18: the answer is the state the
// activation found; `active` only if the host really went starting → active.
function activateAgainst(op) {
  return async ctx => {
    const c = await host(ctx, `${op}-candidate`, { activate: false })
    const other = await ctx.open(`${op}-other`)
    await other.one('BEGIN;')
    const first = await other.json(op === 'stop' ? sql.stop(c.g, c.id) : op === 'drain' ? sql.drain(c.g, c.id) : sql.renew(c.g, c.id))
    const act = launch(c.s, sql.activate(c.g, c.id))
    const how = await step(ctx, act, c.s)
    await other.one('COMMIT;')
    const got = await answer(act, 'activate')
    const h = await ctx.hostRow(c.g)
    ctx.note(`${op}=${JSON.stringify(first)} activate:${how} → ${JSON.stringify(got)} state=${h.state} activated=${h.activated_at !== null}`)
    if (got.status === 'active') assert.notEqual(h.activated_at, null, `activate answered 'active' but the host never became active (state=${h.state}, activated_at=null)`)
    if (op === 'renew') {
      assert.deepEqual(got, { status: 'active' })
      assert.equal(h.state, 'active')
    } else {
      assert.deepEqual(got, { status: 'host_inactive', state: 'stopped' }, `the ${op} committed first: activate must report the stopped host`)
      assert.equal(h.state, 'stopped')
      assert.equal(h.activated_at, null)
    }
  }
}

// A4 — two candidates. The OLDER one's activation is held behind its own lease renewal (a real
// concurrent operation, its transaction open); the NEWER one activates meanwhile. Invariant I18:
// an activation that commits after a newer host's activation committed is refused (newer_active).
// Always: the newer is never refused, and each host row says what its answer said.
async function activationsHeld(ctx) {
  const older = await host(ctx, 'older', { activate: false })
  const newer = await host(ctx, 'newer', { activate: false })
  const renewer = await ctx.open('older-renew')
  await renewer.one('BEGIN;')
  await renewer.json(sql.renew(older.g, older.id))
  const actOld = launch(older.s, sql.activate(older.g, older.id))
  const howOld = await step(ctx, actOld, older.s)
  const actNew = launch(newer.s, sql.activate(newer.g, newer.id))
  const howNew = await step(ctx, actNew, newer.s)
  const newerFirst = actNew.done && !actOld.done // the newer one committed while the older one could not
  await renewer.one('COMMIT;')
  const o = await answer(actOld, 'older activate')
  const n = await answer(actNew, 'newer activate')
  const [ho, hn] = [await ctx.hostRow(older.g), await ctx.hostRow(newer.g)]
  ctx.note(`older:${howOld} newer:${howNew} newerCommittedFirst=${newerFirst} → older=${JSON.stringify(o)} newer=${JSON.stringify(n)} states=${ho.state}/${hn.state}`)
  assert.deepEqual(n, { status: 'active' }, 'the newer candidate is never refused')
  assert.equal(hn.state, 'active')
  assert.ok(['active', 'newer_active'].includes(o.status), JSON.stringify(o))
  if (newerFirst) assert.deepEqual(o, { status: 'newer_active' }, 'the older activation committed after the newer one was active: it must be refused (I18)')
  assert.equal(ho.state, o.status === 'active' ? 'active' : 'starting', 'the older host row matches its answer')
  if (o.status === 'active') assert.equal((await older.s.json(sql.renew(older.g, older.id))).newerActive, true, 'it learns at its next renew')
}

// A4b — control: the same pair as a plain race (Promise.all), no barrier.
async function activationsRace(ctx) {
  const older = await host(ctx, 'older', { activate: false })
  const newer = await host(ctx, 'newer', { activate: false })
  const [o, n] = await Promise.all([older.s.json(sql.activate(older.g, older.id)), newer.s.json(sql.activate(newer.g, newer.id))])
  ctx.note(`older=${JSON.stringify(o)} newer=${JSON.stringify(n)}`)
  assert.deepEqual(n, { status: 'active' })
  assert.ok(['active', 'newer_active'].includes(o.status), JSON.stringify(o))
}

// A5 / A6 — a claim of user U by host `cur` against a drain / stop of `cur`. The claim is held
// between its host check and its row write by a real concurrent writer of U's row: the previous
// owner's final flush, its transaction open. Invariant I17: a host never gains a row after its
// drain/stop committed; the row keeps its owner, epoch and session unless the claim landed first.
function claimAgainst(op) {
  return async ctx => {
    const u = await ctx.newUser()
    const old = await host(ctx, 'previous-owner')
    const cur = await host(ctx, 'claiming-host')
    const oldSession = randomUUID()
    assert.equal((await old.s.json(sql.claim(u, old.g, 1, oldSession, old.id))).status, 'claimed', 'fixture: the previous owner')
    const flusher = await ctx.open('previous-owner-flush')
    await flusher.one('BEGIN;')
    assert.equal((await flusher.json(sql.save([row(u, 1, 1, 7)], old.g, old.id))).results[0].result, 'applied', 'fixture: the flush')
    const session = randomUUID()
    const claim = launch(cur.s, sql.claim(u, cur.g, 1, session, cur.id))
    const howClaim = await step(ctx, claim, cur.s)
    const ctl = await ctx.open(`${op}-control`)
    const leave = launch(ctl, op === 'drain' ? sql.drain(cur.g, cur.id) : sql.stop(cur.g, cur.id))
    const howLeave = await step(ctx, leave, ctl)
    const leftFirst = leave.done && !claim.done // the drain/stop committed while the claim was still pending
    const ownedAtLeave = leftFirst ? await ctx.ownedBy(cur.g) : null
    await flusher.one('COMMIT;')
    const c = await answer(claim, 'claim')
    const l = await answer(leave, op)
    const final = await ctx.locRow(u)
    ctx.note(`claim:${howClaim} ${op}:${howLeave} ${op}CommittedFirst=${leftFirst} → claim=${c.status} ${op}=${JSON.stringify(l)} owner=${final.owner_generation === cur.g ? 'claiming-host' : final.owner_generation === old.g ? 'previous-owner' : final.owner_generation} epoch=${final.epoch}`)
    assert.equal(l.state, op === 'drain' ? 'draining' : 'stopped')
    assert.equal((await ctx.hostRow(cur.g)).state, l.state)
    if (leftFirst) {
      assert.equal(ownedAtLeave, 0, 'fixture: the host owned nothing when it left active')
      assert.notEqual(c.status, 'claimed', `the claim committed after the host's ${op} had committed: a ${l.state} host gained the row`)
      assert.deepEqual(c, { status: 'host_inactive', state: l.state }, 'the late claim reports why')
      assert.deepEqual([final.owner_generation, final.owner_session, final.epoch], [old.g, oldSession, 1], 'the row keeps its owner, session and epoch')
    } else {
      assert.equal(c.status, 'claimed', 'the claim landed while its host was active')
      assert.deepEqual([final.owner_generation, final.owner_seq, final.owner_session, final.epoch], [cur.g, 1, session, 2], 'the claim took the row')
    }
    assert.equal(final.tx, 7, 'the previous owner\'s flush is kept')
  }
}

// A5b — control: claim ‖ drain as a plain race (the earlier staging Q6 shape).
async function claimDrainRace(ctx) {
  const u = await ctx.newUser()
  const h = await host(ctx, 'host')
  const ctl = await ctx.open('drain-control')
  const [c, d] = await Promise.all([h.s.json(sql.claim(u, h.g, 1, randomUUID(), h.id)), ctl.json(sql.drain(h.g, h.id))])
  ctx.note(`claim=${c.status} drain=${d.state}`)
  assert.equal(d.state, 'draining')
  assert.ok(c.status === 'claimed' || (c.status === 'host_inactive' && c.state === 'draining'), JSON.stringify(c))
}

/** id → { title, run(ctx) }. The ids are the evidence's (WORLD LOCATION-4 F2). */
export const SCENARIOS = {
  A1: { title: 'activate against stop of the same starting host', run: activateAgainst('stop') },
  A2: { title: 'activate against drain of the same starting host', run: activateAgainst('drain') },
  A3: { title: 'control: activate against renew of the same starting host', run: activateAgainst('renew') },
  A4: { title: 'two activations, the older held behind its own renewal', run: activationsHeld },
  A4b: { title: 'control: two activations as a plain race', run: activationsRace },
  A5: { title: 'claim against drain of the claiming host', run: claimAgainst('drain') },
  A6: { title: 'claim against stop of the claiming host', run: claimAgainst('stop') },
  A5b: { title: 'control: claim and drain as a plain race', run: claimDrainRace },
}
