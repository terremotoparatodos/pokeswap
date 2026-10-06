// CLOUD READINESS-3 — integrated local validation: REAL realtime processes (services/realtime/src/index.js,
// development mode) against the REAL world-authority handler over an embedded Postgres with every migration
// (localAuthority.mjs), synthetic users, 127.0.0.1 only. Each scenario starts its own authority and processes.
//
//   node scripts/world-location/recovery-integration.mjs [--only D2A,D2B] [--out report.json]
//
// What it can and cannot show: a process here is a PM2 slot, not a routed slot. There is no NGINX: "the host
// recovered" means a process holds the ACTIVE identity; which process NGINX publishes is the agent's decision
// (the PM2/NGINX emulation, separate). Every wait is bounded; a wait that runs out is BLOCKED, never a pass.
// Real timers: lease 15 s, renew 5 s, standby probe 5 s + jitter.

import { randomBytes } from 'node:crypto'
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, leave, nudge, startRealtime } from './realtimeProcesses.mjs'

const { openDirection } = await import(new URL('../../services/realtime/src/world/testing.js', import.meta.url).href)
const ROLLBACK = fileURLToPath(new URL('./rollback_world_presence_recovery.sql', import.meta.url))
// CLOUD JOIN-ORDER-2: claim v3 sits on top of the recovery SQL; its rollback runs first (the recovery one refuses otherwise).
const JOIN_ORDER_ROLLBACK = fileURLToPath(new URL('./rollback_world_location_join_order.sql', import.meta.url))
const argv = process.argv.slice(2)
const arg = name => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : null }
const only = arg('only')?.split(',') ?? null
let nextPort = 38_100

class Blocked extends Error {}
async function until(label, predicate, ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) { const value = await predicate(); if (value) return value; await delay(200) }
  throw new Blocked(`timed out after ${ms} ms: ${label}`)
}

async function world(t) {
  const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex') })
  const servers = []
  t.cleanup.push(async () => { for (const s of servers) await s.kill(); await local.close() })
  // H2 containment: the standby's promotion is its own switch (WORLD_PRESENCE_STANDBY); the scenarios that exercise it ask for it.
  const start = async (name, { recovery = true, ready = true, standby = false } = {}) => {
    const port = nextPort; nextPort += 2
    const s = await startRealtime({ name, port, env: { ...local.env('on', name), ...(recovery ? { WORLD_PRESENCE_RECOVERY: 'on' } : {}), ...(standby ? { WORLD_PRESENCE_STANDBY: 'on' } : {}) } })
    servers.push(s)
    if (ready) await until(`${name} ready`, async () => (await s.ready()) === 200, 30_000)
    return s
  }
  const hosting = async s => (await s.metrics())?.hosting ?? null
  const live = async () => (await local.hosts()).filter(h => h.state === 'active' && h.live).map(h => h.generation)
  return { local, start, hosting, live }
}

/** The persisted location row of a player, or null (read straight from the database, never from an answer). */
async function rowOf(w, userId) {
  const { rows } = await w.local.query(`SELECT area_id, tx, ty, epoch::int AS epoch, owner_generation::int AS generation, owner_seq::int AS seq,
    owner_session::text AS session FROM public.world_player_locations WHERE user_id = $1`, [userId])
  return rows[0] ?? null
}

/** A location_save of `inst` answered HTTP 200 (any result): what the pre-review barrier accepted. */
const anySave200 = (w, inst) => w.local.events.some(e => e.inst === inst && e.op === 'location_save' && e.status === 200)

/**
 * The tile is really saved: a location_save of `inst` answered `applied` FOR THIS USER, and the row in the database
 * holds exactly `tile` under `generation` (review of 575f3f5: an HTTP 200 alone is not a save).
 */
async function tileSaved(w, inst, userId, tile, generation) {
  const applied = w.local.events.some(e => e.inst === inst && e.op === 'location_save' && e.status === 200
    && Array.isArray(e.answer?.results) && e.answer.results.some(r => r.userId === userId && r.result === 'applied'))
  if (!applied) return false
  const row = await rowOf(w, userId)
  return Boolean(row) && row.area_id === tile.areaId && row.tx === tile.tx && row.ty === tile.ty && row.generation === generation
}

/**
 * CAPABILITY_ROLLBACK (and its controls): the join-order and recovery SQL are rolled back under a live process with
 * recovery enabled, then a player joins. `variant`:
 *   'normal'      the correct order (join order first);
 *   'refused200'  control from the review: v1 answers HTTP 200 with a refusal (unknown_user) and writes no row;
 *   'transport'   control: every v1 claim fails in transport (HTTP 503);
 *   'wrongOrder'  control: recovery rolled back alone — its script refuses (the error propagates: BLOCKED).
 */
async function capabilityRollback(w, variant) {
  const D = await w.start('D')
  const before = (await w.hosting(D)).recovery
  if (variant !== 'wrongOrder') await w.local.db.exec(await readFile(JOIN_ORDER_ROLLBACK, 'utf8'))
  await w.local.db.exec(await readFile(ROLLBACK, 'utf8'))
  if (variant === 'refused200') {
    // The review's injection, in this test's own embedded database only (never versioned SQL).
    await w.local.db.exec(`CREATE OR REPLACE FUNCTION public.world_location_claim_keyed(p_user_id uuid, p_generation bigint, p_seq bigint, p_session uuid, p_host_id uuid)
      RETURNS jsonb LANGUAGE plpgsql SECURITY INVOKER SET search_path = public AS $$ BEGIN RETURN jsonb_build_object('status', 'unknown_user'); END; $$;`)
  }
  if (variant === 'transport') w.local.rule({ op: 'location_claim', inst: 'D', mode: 'fail', times: 1_000 })
  const p = await w.local.player()
  const s = await connect(D, p.token, { tabId: 'tab-cap-0001', waitSelf: false })
  await until('the join settles', () => s.self || s.left !== null || s.refused !== null, 10_000)
  await delay(300)
  const after = (await w.hosting(D)).recovery
  const key = e => ({ userId: e.body?.userId, generation: e.body?.generation, hostId: e.body?.hostId, sessionId: e.body?.sessionId, seq: e.body?.seq })
  const claims = w.local.events.filter(e => e.inst === 'D' && (e.op === 'location_claim_v2' || e.op === 'location_claim'))
    .map(e => ({ op: e.op, status: e.status, claim: e.answer?.claim ?? null, key: key(e) }))
  const row = await rowOf(w, p.userId)
  const placed = Boolean(s.self)
  await leave(s)
  return { variant, userId: p.userId, before, after, claims, row, placed }
}

/** Every check CAPABILITY_ROLLBACK must pass (pure: the controls apply the same list). */
function rollbackChecks(f) {
  const [v2, v1] = f.claims
  const sameKey = Boolean(v2 && v1) && ['userId', 'generation', 'hostId', 'sessionId', 'seq'].every(k => v2.key[k] !== undefined && v2.key[k] === v1.key[k])
  const claimed = v1?.claim?.status === 'claimed' && Number.isSafeInteger(v1.claim.epoch) && v1.claim.epoch >= 1
  const rowUnderKey = Boolean(f.row && v1) && f.row.generation === v1.key.generation && f.row.seq === v1.key.seq && f.row.session === v1.key.sessionId
  return [
    { label: 'enabled before, disabled (sql-missing) after one unsupported call', ok: f.before?.state === 'enabled' && f.after?.state === 'disabled' && f.after?.reason === 'sql-missing' },
    { label: 'exactly two claims, in order: v2 HTTP 501, then v1 HTTP 200', ok: f.claims.length === 2 && v2.op === 'location_claim_v2' && v2.status === 501 && v1.op === 'location_claim' && v1.status === 200 },
    { label: 'the SAME full key (userId, generation, hostId, sessionId, seq) went through v2 and v1', ok: sameKey && v1.key.userId === f.userId },
    { label: 'v1 answered claimed, with an epoch', ok: claimed },
    { label: 'the persisted row belongs to that key (owner generation, seq, session) and carries the answered epoch', ok: rowUnderKey && claimed && f.row.epoch === v1.claim.epoch },
    { label: 'the player is placed', ok: f.placed },
  ]
}

/** The pre-review check (575f3f5), kept only to show what the controls would have let through. */
const preReviewRollbackCheck = f => f.placed && f.claims.length === 2 && f.claims[0].op === 'location_claim_v2' && f.claims[0].status === 501
  && f.claims[1].op === 'location_claim' && f.claims[1].status === 200 && f.claims[0].key.seq === f.claims[1].key.seq

const SCENARIOS = {
  /** D2-A: the old process is displaced by a newer one, which then stops: the old process recovers with a NEW identity. */
  async D2A(t) {
    const out = {}
    for (const recovery of [true, false]) {
      const w = await world(t)
      const A = await w.start(`A${recovery ? '' : '-off'}`, { recovery, standby: true })
      const generationA = (await w.hosting(A)).generation
      const B = await w.start(`B${recovery ? '' : '-off'}`)
      await until('A displaced', async () => (await w.hosting(A))?.displaced, 20_000)
      const stoppedAt = Date.now()
      await B.shutdown()
      if (recovery) {
        const h = await until('A promoted', async () => { const x = await w.hosting(A); return x?.standbyCounters?.promotions === 1 ? x : null }, 40_000)
        const recoveredMs = Date.now() - stoppedAt
        const p = await w.local.player()
        const socket = await connect(A, p.token, { tabId: 'tab-d2a-0001' })
        out.recovered = { recoveredMs, oldGeneration: generationA, newGeneration: h.generation, ready: await A.ready(), liveHosts: await w.live(), playerPlaced: Boolean(socket.self) }
        await leave(socket)
        t.check('D2-A: one host again, with a NEW identity, admitting players', out.recovered.newGeneration > generationA && out.recovered.ready === 200 && out.recovered.liveHosts.length === 1 && out.recovered.playerPlaced)
      } else {
        await delay(25_000)
        out.control = { ready: await A.ready(), liveHosts: await w.live(), standby: (await w.hosting(A))?.standby }
        t.check('control (kill switch off): D2-A stays without an active host', out.control.ready === 503 && out.control.liveHosts.length === 0 && out.control.standby === false)
      }
    }
    return out
  },

  /** D2-B: a player claimed on a newer host that STOPPED; resuming on the older, still active one restores its tile (no false 4409). */
  async D2B(t) {
    const out = {}
    for (const recovery of [true, false]) {
      const w = await world(t)
      const A = await w.start(`A${recovery ? '' : '-off'}`, { recovery })
      // A must not learn of B in this window (its renew answers would say newerActive): they fail, for less than a lease.
      w.local.rule({ op: 'presence_renew', inst: A.name, mode: 'fail', times: 1_000 })
      const B = await w.start(`B${recovery ? '' : '-off'}`)
      const p = await w.local.player()
      const onB = await connect(B, p.token, { tabId: 'tab-d2b-0001' })
      await nudge(onB, openDirection)
      const tile = { areaId: onB.self.areaId, tx: onB.self.tx, ty: onB.self.ty }
      await B.shutdown()                                  // drains (saves the tile) and stops its identity
      w.local.clearRules('presence_renew')
      const onA = await connect(A, p.token, { tabId: 'tab-d2b-0001', resume: true, waitSelf: false })
      await until('the resume settles', () => onA.self || onA.left !== null || onA.refused !== null, 10_000)
      await delay(300)
      const got = onA.self && { areaId: onA.self.areaId, tx: onA.self.tx, ty: onA.self.ty }
      const settled = { tile, restored: got, left: onA.left, closing: [...onA.closing], refused: onA.refused }
      out[recovery ? 'recovery' : 'control'] = settled
      await leave(onA)
      if (recovery) t.check('D2-B: the resume on the older host restores the tile saved by the stopped one', JSON.stringify(got) === JSON.stringify(tile) && settled.left === null)
      else t.check('control (kill switch off): the same resume is the false 4409', settled.left === 4409 && settled.closing.includes('replaced'))
    }
    return out
  },

  /** A crashed newer owner: a resume gets 4503 owner-unreachable and writes nothing; only «Jugar acá» (takeover) restores. */
  async UNREACHABLE(t) {
    const w = await world(t)
    const A = await w.start('A')
    w.local.rule({ op: 'presence_renew', inst: A.name, mode: 'fail', times: 1_000 })
    const B = await w.start('B')
    const p = await w.local.player()
    const onB = await connect(B, p.token, { tabId: 'tab-unr-0001' })
    await nudge(onB, openDirection)
    const tile = { areaId: onB.self.areaId, tx: onB.self.tx, ty: onB.self.ty }
    const generationB = (await w.hosting(B)).generation
    await leave(onB)                                       // a disconnect is an urgent save
    // The barrier before the crash: the save was APPLIED for this player and the row really holds the tile under B
    // (review of 575f3f5: an HTTP 200 alone proved nothing). Not met within the bound: BLOCKED, never a pass.
    await until('the tile persisted (applied, row = tile under B)', () => tileSaved(w, 'B', p.userId, tile, generationB), 10_000)
    const persisted = await rowOf(w, p.userId)
    await B.kill()                                         // crash: B stays 'active' until its lease runs out
    await until('B lease expired', async () => !(await w.local.hosts()).find(h => h.generation === generationB)?.live, 30_000)
    w.local.clearRules('presence_renew')
    await until('A serving again', async () => (await A.ready()) === 200, 20_000)
    const resumes = []
    for (const options of [{ resume: true }, {}]) {
      const s = await connect(A, p.token, { tabId: 'tab-unr-0001', waitSelf: false, ...options })
      await until('the join settles', () => s.self || s.left !== null || s.refused !== null, 10_000)
      resumes.push({ options, left: s.left, closing: s.closing, placed: Boolean(s.self) })
      await leave(s)
    }
    const playHere = await connect(A, p.token, { tabId: 'tab-unr-0001', takeover: true })
    const got = { areaId: playHere.self.areaId, tx: playHere.self.tx, ty: playHere.self.ty }
    await leave(playHere)
    t.check('a resume and a plain fresh join get 4503 owner-unreachable', resumes.every(r => r.left === 4503 && r.closing.includes('owner-unreachable') && !r.placed))
    t.check('«Jugar acá» (takeover) restores the last confirmed tile', JSON.stringify(got) === JSON.stringify(tile))
    return { tile, persistedBeforeCrash: persisted && { areaId: persisted.area_id, tx: persisted.tx, ty: persisted.ty, generation: persisted.generation }, generationB, resumes, playHere: got }
  },

  /**
   * Control for the UNREACHABLE barrier: a REAL location_save that answers HTTP 200 without applying (stale: the row's
   * epoch moved under the session) must never satisfy it, while the pre-review barrier (any HTTP 200) would have.
   */
  async CONTROL_UNREACHABLE_SAVE_NOT_APPLIED(t) {
    const w = await world(t)
    const B = await w.start('B')
    const p = await w.local.player()
    const onB = await connect(B, p.token, { tabId: 'tab-unr-ctl-0001' })
    const generationB = (await w.hosting(B)).generation
    await until('the claim persisted a row', async () => (await rowOf(w, p.userId)) !== null, 10_000)
    await w.local.db.query('UPDATE public.world_player_locations SET epoch = epoch + 1 WHERE user_id = $1', [p.userId])   // this database only
    await nudge(onB, openDirection)
    const tile = { areaId: onB.self.areaId, tx: onB.self.tx, ty: onB.self.ty }
    await leave(onB)
    await until('a location_save of B answered HTTP 200', () => anySave200(w, 'B'), 10_000)
    const results = w.local.events.filter(e => e.inst === 'B' && e.op === 'location_save' && e.status === 200).map(e => e.answer?.results ?? null)
    const accepted = await tileSaved(w, 'B', p.userId, tile, generationB)
    t.check('the pre-review barrier (any HTTP 200) would have accepted this save', anySave200(w, 'B'))
    t.check('the save answered 200 WITHOUT applying for this player', results.flat().some(r => r?.userId === p.userId && r.result !== 'applied') && !results.flat().some(r => r?.userId === p.userId && r.result === 'applied'))
    t.check('the new barrier rejects it (not applied, row not the tile)', accepted === false)
    return { tile, results, accepted, row: await rowOf(w, p.userId) }
  },

  /** SIGINT while the standby's exclusive activation is in flight: the process exits; the late activation is never installed by it. */
  async SIGINT_PROMOTION(t) {
    const w = await world(t)
    const A = await w.start('A', { standby: true })
    const B = await w.start('B')
    await until('A displaced', async () => (await w.hosting(A))?.displaced, 20_000)
    w.local.rule({ op: 'presence_activate_exclusive', inst: 'A', mode: 'hold', times: 1 })
    await B.shutdown()
    await until('the exclusive activation is held', () => w.local.held() === 1, 40_000)
    const exit = A.shutdown()
    const code = await Promise.race([exit, delay(20_000).then(() => 'still running')])
    const late = await w.local.releaseHeld()              // the activation reaches the database after the process is gone
    const hosts = await w.local.hosts()
    t.check('the process exits on SIGTERM during its promotion', code === 0)
    t.check('the late activation finds the identity already stopped: no active host without a process', late?.status === 'host_inactive' && hosts.every(h => !(h.state === 'active' && h.live)))
    return { exitCode: code, lateAnswer: late, hosts: hosts.map(h => ({ generation: h.generation, state: h.state, live: h.live })) }
  },

  /** The authority is down while in standby: no promotion; it recovers once the authority answers again. */
  async AUTHORITY_DOWN(t) {
    const w = await world(t)
    const A = await w.start('A', { standby: true })
    const B = await w.start('B')
    await until('A displaced', async () => (await w.hosting(A))?.displaced, 20_000)
    w.local.rule({ op: '*', inst: 'A', mode: 'fail', times: 100_000 })
    await B.shutdown()
    await delay(20_000)
    const during = await w.hosting(A)
    w.local.clearRules()
    const after = await until('A promoted', async () => { const x = await w.hosting(A); return x?.standbyCounters?.promotions === 1 ? x : null }, 40_000)
    t.check('no promotion while the authority is down (probe failures only)', during.standbyCounters.promotions === 0 && during.standbyCounters.probeFailures > 0)
    t.check('recovers once the authority answers', after.standbyCounters.promotions === 1 && (await w.live()).length === 1)
    return { during: during.standbyCounters, after: after.standbyCounters }
  },

  /** The recovery SQL is rolled back under a live process: one v2 call is unsupported, the same key goes through v1, recovery stays off. */
  async CAPABILITY_ROLLBACK(t) {
    const w = await world(t)
    const facts = await capabilityRollback(w, 'normal')
    for (const c of rollbackChecks(facts)) t.check(c.label, c.ok)
    return facts
  },

  /** Control (review F1): HTTP 200 with a refused claim and no row must FAIL the scenario's checks — never PASS. */
  async CONTROL_ROLLBACK_REFUSED_200(t) {
    const w = await world(t)
    const facts = await capabilityRollback(w, 'refused200')
    const checks = rollbackChecks(facts)
    t.check('the pre-review check would have passed it (the gap the review found)', preReviewRollbackCheck(facts))
    t.check('the scenario checks fail it: v1 not claimed, no row under the key', checks.some(c => !c.ok) && !checks[3].ok && !checks[4].ok && facts.row === null)
    return { facts, failing: checks.filter(c => !c.ok).map(c => c.label) }
  },

  /** Control: a transport failure of every v1 claim is a FAIL of the checks (not a pass, not BLOCKED). */
  async CONTROL_ROLLBACK_TRANSPORT(t) {
    const w = await world(t)
    const facts = await capabilityRollback(w, 'transport')
    const checks = rollbackChecks(facts)
    t.check('v1 failed in transport (HTTP 503), recorded', facts.claims.some(c => c.op === 'location_claim' && c.status === 503))
    t.check('the scenario checks fail it (no claimed answer, no row)', !checks[3].ok && !checks[4].ok)
    return { facts, failing: checks.filter(c => !c.ok).map(c => c.label) }
  },

  /** Control: the wrong rollback order is refused by the recovery script, visibly — the scenario would be BLOCKED, not FAIL/PASS. */
  async CONTROL_ROLLBACK_WRONG_ORDER(t) {
    const w = await world(t)
    let error = null
    try { await capabilityRollback(w, 'wrongOrder') } catch (e) { error = String(e?.message ?? e) }
    t.check('the recovery rollback refuses with its explicit order error', /run rollback_world_location_join_order\.sql first/.test(error ?? ''))
    t.check('it is an exception (classified BLOCKED by the runner), not a check outcome', error !== null)
    return { error }
  },

  /** Two deploy candidates start at once next to an active host: exactly one active host settles and stays (no oscillation). */
  async CONCURRENT_CANDIDATES(t) {
    const w = await world(t)
    await w.start('A', { standby: true })
    // Concurrent candidates: the older one may be displaced at once (503, by design), so only listening is awaited.
    await Promise.all([w.start('B', { ready: false, standby: true }), w.start('C', { ready: false, standby: true })])
    await until('one active host', async () => (await w.live()).length === 1, 30_000)
    const samples = []
    for (let i = 0; i < 20; i++) { samples.push(await w.live()); await delay(1_000) }
    const stable = samples.every(s => s.length === 1 && s[0] === samples[0][0])
    t.check('exactly one active host for 20 s, always the same (no alternation between standbys)', stable)
    return { samples: samples.map(s => s.join(',')) }
  },
}

// --repeat N runs each selected scenario N times, serially, and keeps EVERY result (name#1 … name#N).
const repeat = Math.max(1, Number(arg('repeat') ?? 1) || 1)
const runs = Object.entries(SCENARIOS).filter(([name]) => !only || only.includes(name))
  .flatMap(([name, scenario]) => Array.from({ length: repeat }, (_, i) => [repeat > 1 ? `${name}#${i + 1}` : name, scenario]))
const report = { tree: '<worktree>', startedAt: new Date().toISOString(), node: process.version, repeat, scenarios: {} }
let failed = false
let blocked = false
for (const [name, scenario] of runs) {
  const t = { checks: [], cleanup: [], check(label, ok) { this.checks.push({ label, ok: Boolean(ok) }) } }
  const started = Date.now()
  let facts = null
  let verdict
  try {
    facts = await scenario(t)
    verdict = t.checks.every(c => c.ok) ? 'PASS' : 'FAIL'
  } catch (error) {
    verdict = 'BLOCKED'
    facts = { error: String(error?.message ?? error).slice(0, 400) }
  } finally {
    for (const clean of t.cleanup.reverse()) await clean().catch(() => {})
  }
  if (verdict === 'FAIL') failed = true
  if (verdict === 'BLOCKED') blocked = true
  report.scenarios[name] = { verdict, seconds: Math.round((Date.now() - started) / 1000), checks: t.checks, facts }
  console.log(`${name.padEnd(22)} ${verdict.padEnd(8)} ${Math.round((Date.now() - started) / 1000)}s ${t.checks.filter(c => !c.ok).map(c => `✗ ${c.label}`).join(' | ')}${facts?.error ? ` ${facts.error}` : ''}`.trimEnd())
}
report.finishedAt = new Date().toISOString()
const out = arg('out')
if (out) await writeFile(out, JSON.stringify(report, null, 2) + '\n')
process.exit(blocked ? 2 : failed ? 1 : 0)
