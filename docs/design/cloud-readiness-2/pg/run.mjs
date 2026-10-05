// CLOUD READINESS-2 — prototype validation on REAL local Postgres (never PGlite, never hosted).
//
//   node docs/design/cloud-readiness-2/pg/run.mjs --container <local supabase db container> [--rounds 3] [--out file.json]
//
// For each build (the prototype and one mutant per protection) it recreates the dedicated database
// `cr2_validation` (never the stack's `postgres` database), applies auth.users (a minimal shim),
// the REAL migrations 20261001220000 + 20261003120000 from this checkout and prototype.sql (with
// the mutant applied in memory: exactly one replacement, verified), then runs every scenario.
//
// Order is forced with advisory-lock barriers inside the prototype (cr2_hook) and observed through
// pg_stat_activity; sleeps never decide an order. Exit: 0 = expected outcome for every build,
// 1 = unexpected outcome, 2 = BLOCKED (no local container, harness error, setup failure).
// Data: synthetic users and hosts only.

import { createHash, randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { PgSession, sleep, withDeadline } from './session.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..')
const DB = 'cr2_validation'
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const CONTAINER = arg('container')
const ROUNDS = Number(arg('rounds', 3))
const OUT = arg('out')
const ONLY = arg('only')?.split(',')
const blocked = message => { console.log(`BLOCKED: ${message}`); process.exit(2) }
if (!CONTAINER || !/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) blocked('--container must name a local Supabase db container (supabase_db_*)')
if (process.env.DOCKER_HOST && !/^(unix|npipe):/.test(process.env.DOCKER_HOST)) blocked('DOCKER_HOST is not local')
try { execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], { encoding: 'utf8' }).trim() === 'true' || blocked(`${CONTAINER} is not running`) } catch { blocked(`${CONTAINER} not found`) }

const MIGRATIONS = ['20261001220000_world_player_locations.sql', '20261003120000_world_location_ordering.sql']
const PROTOTYPE = readFileSync(join(HERE, 'prototype.sql'), 'utf8').split(String.fromCharCode(13)).join('')
const sha = text => createHash('sha256').update(text).digest('hex')

// ── builds: the prototype and one mutant per protection (one exact replacement each) ────────────
const BUILDS = {
  prototype: null,
  'owner-share': ['/*MUT:owner-share*/', "PERFORM 1 FROM public.world_presence_hosts WHERE generation = v_row.owner_generation FOR SHARE;"],
  'draining-takes': ["v_answer := 'owner_draining'; /*MUT:draining-takes*/", 'v_answer := null;'],
  'unreachable-takes': ["v_answer := 'owner_unreachable'; /*MUT:unreachable-takes*/", 'v_answer := null;'],
  'draining-expired-stopped': ["THEN 'unreachable' /*MUT:draining-expired*/", "THEN 'stopped'"],
  'tab-session': ['AND t.owner_session = v_row.owner_session /*MUT:tab-session*/', ''],
  'no-yield': ["WHERE o.generation < p_generation AND o.state = 'starting'", "WHERE false AND o.state = 'starting'"],
  'excl-no-lock': ['LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE; /*MUT:excl-lock*/', ''],
}
// Which scenario must FAIL (detect) for each mutant. The prototype must pass all.
const DETECTS = {
  'owner-share': ['I1'], 'draining-takes': ['S4'], 'unreachable-takes': ['S2'], 'draining-expired-stopped': ['S4b'],
  'tab-session': ['S7'], 'no-yield': ['X1'], 'excl-no-lock': ['X5'],
}
function buildSql(build) {
  const m = BUILDS[build]
  if (!m) return PROTOTYPE
  const [from, to] = m
  const count = PROTOTYPE.split(from).length - 1
  if (count !== 1) blocked(`mutant ${build}: marker found ${count} times`)
  return PROTOTYPE.replace(from, to)
}

// ── database lifecycle ───────────────────────────────────────────────────────────────────────────
const psql = (database, sql) => execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })

function recreate(build) {
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();`)
  psql('postgres', `DROP DATABASE IF EXISTS ${DB};`)
  psql('postgres', `CREATE DATABASE ${DB};`)
  psql(DB, 'CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);')
  const applied = {}
  for (const file of MIGRATIONS) {
    // The committed blob (LF), never the working copy (core.autocrlf may have rewritten it).
    const text = execFileSync('git', ['-C', ROOT, 'show', `HEAD:supabase/migrations/${file}`], { encoding: 'utf8' })
    applied[file] = sha(text).slice(0, 16)
    psql(DB, text)
  }
  const proto = buildSql(build)
  applied['prototype.sql'] = sha(proto).slice(0, 16)
  psql(DB, proto)
  return applied
}

// ── per-build world ──────────────────────────────────────────────────────────────────────────────
async function world() {
  const sessions = []
  const open = async (name, role = 'service_role') => { const s = await new PgSession(CONTAINER, DB, name).init(role); sessions.push(s); return s }
  const admin = await open('admin', null)
  // Fixture reset: every scenario starts with no live host (all hosts here are synthetic).
  await admin.one("UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now() WHERE state <> 'stopped';")
  const svc = await open('svc')
  const q = s => `'${String(s).replaceAll("'", "''")}'`
  const w = {
    admin, svc, open,
    async user() { const id = randomUUID(); await admin.one(`INSERT INTO auth.users VALUES (${q(id)}::uuid);`); return id },
    async acquire(s = svc) { const h = randomUUID(); const r = await s.json(`SELECT public.world_presence_acquire(${q(h)}::uuid, 15000);`); return { g: Number(r.generation), h } },
    activate: (host, s = svc) => s.json(`SELECT public.world_presence_activate(${host.g}, ${q(host.h)}::uuid, 15000);`),
    exclusiveSql: host => `SELECT public.world_presence_activate_exclusive(${host.g}, ${q(host.h)}::uuid, 15000);`,
    exclusive: (host, s = svc) => s.json(w.exclusiveSql(host)),
    renewSql: host => `SELECT public.world_presence_renew(${host.g}, ${q(host.h)}::uuid, 15000);`,
    renew: (host, s = svc) => s.json(w.renewSql(host)),
    drainSql: host => `SELECT public.world_presence_drain(${host.g}, ${q(host.h)}::uuid, 10000);`,
    drain: (host, s = svc) => s.json(w.drainSql(host)),
    stopSql: host => `SELECT public.world_presence_stop(${host.g}, ${q(host.h)}::uuid);`,
    stop: (host, s = svc) => s.json(w.stopSql(host)),
    claimSql: (u, host, seq, { tab = null, resume = false, session = randomUUID() } = {}) =>
      `SELECT public.world_location_claim_keyed_v2(${q(u)}::uuid, ${host.g}, ${seq}, ${q(session)}::uuid, ${q(host.h)}::uuid, ${tab ? q(tab) : 'NULL'}, ${resume});`,
    claim: (u, host, seq, opts, s = svc) => s.json(w.claimSql(u, host, seq, opts)),
    claimV1: (u, host, seq, session = randomUUID(), s = svc) => s.json(`SELECT public.world_location_claim_keyed(${q(u)}::uuid, ${host.g}, ${seq}, ${q(session)}::uuid, ${q(host.h)}::uuid);`),
    saveSql: (u, host, epoch, seq, tx) => `SELECT public.world_location_save_keyed(${q(JSON.stringify([{ userId: u, epoch, seq, areaId: 'ciudad-corazon', tx, ty: 20, layoutVersion: '1.test' }]))}::jsonb, ${host.g}, ${q(host.h)}::uuid);`,
    save: (u, host, epoch, seq, tx, s = svc) => s.json(w.saveSql(u, host, epoch, seq, tx)),
    // Fixtures (admin): a lease that ran out (crash or partition) — the only time travel used.
    expire: host => admin.one(`UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = ${host.g};`),
    row: async u => admin.json(`SELECT row_to_json(r) FROM (SELECT tx, epoch::int AS epoch, seq::int AS seq, owner_generation::int AS owner FROM public.world_player_locations WHERE user_id = ${q(u)}::uuid) r;`),
    hostRow: async host => admin.json(`SELECT row_to_json(r) FROM (SELECT state, activated_at IS NOT NULL AS activated FROM public.world_presence_hosts WHERE generation = ${host.g}) r;`),
    active: async () => (await admin.send('SELECT generation FROM public.world_presence_hosts WHERE state = \'active\' AND lease_expires_at > now() ORDER BY 1;')).rows.map(Number),
    deadlocks: async () => Number(await admin.one(`SELECT deadlocks FROM pg_stat_database WHERE datname = '${DB}';`)),
    // Barriers
    async hold(hook, tag) { await admin.one(`SELECT pg_advisory_lock(hashtext('cr2:${hook}:${tag}'));`) },
    async release(hook, tag) { await admin.one(`SELECT pg_advisory_unlock(hashtext('cr2:${hook}:${tag}'));`) },
    async hooked(name, hooks, tag) { const s = await open(name); await s.one(`SET cr2.hooks = ${q(hooks)};`); await s.one(`SET cr2.tag = ${q(tag)};`); return s },
    /** Waits until `pid` waits on a lock of `kind` ('advisory' | 'row' | 'relation'). */
    async waiting(pid, kind, ms = 10_000) {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        const r = await admin.one(`SELECT coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') FROM pg_stat_activity WHERE pid = ${pid};`)
        if (kind === 'advisory' && r === 'Lock:advisory') return r
        if (kind === 'row' && /^Lock:(transactionid|tuple)$/.test(r)) return r
        if (kind === 'relation' && r === 'Lock:relation') return r
        await sleep(20)
      }
      throw new Error(`harness: pid ${pid} never waited on ${kind}`)
    },
    /** Either the call finished, or it is blocked on a (non-advisory) lock. Observation only. */
    async finishedOrBlocked(promise, pid, ms = 10_000) {
      let done = null
      promise.then(r => { done = r })
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (done) return { blocked: false, result: done }
        const r = await admin.one(`SELECT coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') FROM pg_stat_activity WHERE pid = ${pid};`)
        if (/^Lock:(transactionid|tuple|relation)$/.test(r)) return { blocked: true, wait: r }
        await sleep(20)
      }
      throw new Error('harness: neither finished nor blocked')
    },
    async close() { for (const s of sessions) await s.close() },
  }
  return w
}
const parse = r => (r?.ok && r.rows[0] ? JSON.parse(r.rows[0]) : { error: r?.errors?.join(' | ') ?? 'no answer' })

// ── scenarios ────────────────────────────────────────────────────────────────────────────────────
// Each returns { facts, checks: [{ name, ok }] }. A check names a SAFETY or BEHAVIOUR property.
const T = 'tab-aaaaaaaa', TB = 'tab-bbbbbbbb'
const SCENARIOS = {
  // S1 — crash: the same page resumes on a LOWER generation; its previous connection is gone by
  // construction of the client (one room per page). Takes at once, restores the last saved tile.
  async S1(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const c = await w.claim(P, g3, 1, { tab: T }); await w.save(P, g3, c.epoch, 1, 32)
    await w.expire(g3)
    const r = await w.claim(P, g2, 1, { tab: T, resume: true })
    const late = await w.save(P, g3, c.epoch, 2, 99)
    const row = await w.row(P)
    return { facts: { r, late, row }, checks: [
      { name: 'same-tab resume after a crash is claimed', ok: r.status === 'claimed' },
      { name: 'restores the last tile saved by the dead owner', ok: r.location?.tx === 32 && r.epoch === c.epoch + 1 },
      { name: 'a late save of the expired owner changes nothing', ok: row.tx === 32 && row.owner === g2.g },
    ] }
  },
  // S2 — partition: ANOTHER page resumes while the owner is unreachable (its socket may be live).
  async S2(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const c = await w.claim(P, g3, 1, { tab: T }); await w.save(P, g3, c.epoch, 1, 32)
    await w.expire(g3)
    const r = await w.claim(P, g2, 1, { tab: TB, resume: true })
    const revive = await w.renew(g3)                     // the partition heals
    const after = await w.save(P, g3, c.epoch, 2, 40)    // the live page on g3 keeps saving
    return { facts: { r, revive, after }, checks: [
      { name: 'another page never takes a row whose owner may still be live (unreachable)', ok: r.status === 'owner_unreachable' },
      { name: 'the healed owner keeps its row (its next save applies)', ok: after.results?.[0]?.result === 'applied' },
    ] }
  },
  // S3 — stopped owner: its sockets closed before stop (I-9), so any page may take the row.
  async S3(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const c = await w.claim(P, g3, 1, { tab: T }); await w.save(P, g3, c.epoch, 1, 33)
    await w.drain(g3); await w.stop(g3)
    const r = await w.claim(P, g2, 1, { tab: TB, resume: true })
    return { facts: { r }, checks: [{ name: 'a stopped owner is taken over with its last tile', ok: r.status === 'claimed' && r.location?.tx === 33 }] }
  },
  // S4 — draining owner: wait for its final flush (even for the same page).
  async S4(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const c = await w.claim(P, g3, 1, { tab: T }); await w.save(P, g3, c.epoch, 1, 34)
    await w.drain(g3)
    const during = await w.claim(P, g2, 1, { tab: T, resume: true })
    const flush = await w.save(P, g3, c.epoch, 2, 35)
    await w.stop(g3)
    const after = await w.claim(P, g2, 2, { tab: T, resume: true })
    return { facts: { during, flush, after }, checks: [
      { name: 'a draining owner answers owner_draining (retryable)', ok: during.status === 'owner_draining' },
      { name: 'its final flush is kept and then restored', ok: flush.results?.[0]?.result === 'applied' && after.status === 'claimed' && after.location?.tx === 35 },
    ] }
  },
  // S4b — a draining owner whose window ran out but whose process may still hold sockets (stall).
  async S4b(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    await w.claim(P, g3, 1, { tab: T }); await w.drain(g3); await w.expire(g3)
    const r = await w.claim(P, g2, 1, { tab: TB, resume: true })
    return { facts: { r }, checks: [{ name: 'expired drain is not proof of closed sockets: another page does not take', ok: r.status === 'owner_unreachable' }] }
  },
  // S5 — a FRESH join of another page is the explicit replacement (product rule), even when unreachable.
  async S5(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    await w.claim(P, g3, 1, { tab: T }); await w.expire(g3)
    const r = await w.claim(P, g2, 1, { tab: TB, resume: false })
    return { facts: { r }, checks: [{ name: 'fresh join (explicit replace) takes an unreachable owner', ok: r.status === 'claimed' }] }
  },
  // S6 — a live owner on a newer host, another page resumes on the older one: unchanged order.
  async S6(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    await w.claim(P, g3, 1, { tab: T })
    const r = await w.claim(P, g2, 1, { tab: TB, resume: true })
    return { facts: { r }, checks: [{ name: 'live newer owner, other page: superseded with newerActive', ok: r.status === 'superseded' && r.newerActive === true }] }
  },
  // S7 — mixed fleet: a v1 claim takes the row; the tab recorded for the PREVIOUS owner session must
  // not match any more.
  async S7(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    await w.claim(P, g2, 1, { tab: T })
    const v1 = await w.claimV1(P, g3, 1)
    const r = await w.claim(P, g2, 2, { tab: T, resume: true })
    return { facts: { v1, r }, checks: [
      { name: 'v1 takes as before', ok: v1.status === 'claimed' },
      { name: 'a stale tab record never authorizes a takeover from a live v1 session', ok: r.status === 'superseded' },
    ] }
  },
  // S8 — v1 behaviours kept: adoption (same key retried) and greater key.
  async S8(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const session = randomUUID()
    const a = await w.claim(P, g2, 1, { tab: T, session }); const b = await w.claim(P, g2, 1, { tab: T, session })
    const c = await w.claim(P, g3, 1, { tab: TB })
    return { facts: { a, b, c }, checks: [
      { name: 'adoption: same key + session = same epoch', ok: a.status === 'claimed' && b.status === 'claimed' && a.epoch === b.epoch },
      { name: 'greater key takes as in v1', ok: c.status === 'claimed' && c.epoch === a.epoch + 1 },
    ] }
  },

  // I1 — claim paused after reading the owner's state ‖ the owner's renew (revival).
  async I1(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const c = await w.claim(P, g3, 1, { tab: T }); await w.save(P, g3, c.epoch, 1, 32); await w.expire(g3)
    const s = await w.hooked('i1-claim', 'after_state', 'i1'); await w.hold('after_state', 'i1')
    const claim = s.send(w.claimSql(P, g2, 1, { tab: T, resume: true }))
    await w.waiting(s.pid, 'advisory')
    const r2 = await w.open('i1-renew')
    const renew = await w.finishedOrBlocked(r2.send(w.renewSql(g3)), r2.pid)
    await w.release('after_state', 'i1')
    const r = parse(await claim)
    const renewResult = renew.blocked ? null : parse(renew.result)
    const late = await w.save(P, g3, c.epoch, 2, 77)
    return { facts: { renewBlocked: renew.blocked, wait: renew.wait, r, renewResult, late }, checks: [
      { name: 'the owner renew never waits on another host\'s claim', ok: renew.blocked === false },
      { name: 'the same page still takes over', ok: r.status === 'claimed' },
      { name: 'the revived owner cannot write the taken row (stale)', ok: late.results?.[0]?.result === 'stale' || late.status === 'host_expired' },
    ] }
  },
  // I2 — same-page claim paused (owner read as active) ‖ the owner's drain.
  async I2(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    const c = await w.claim(P, g3, 1, { tab: T })
    const s = await w.hooked('i2-claim', 'after_state', 'i2'); await w.hold('after_state', 'i2')
    const claim = s.send(w.claimSql(P, g2, 1, { tab: T, resume: true }))
    await w.waiting(s.pid, 'advisory')
    const d = await w.open('i2-drain')
    const drain = await w.finishedOrBlocked(d.send(w.drainSql(g3)), d.pid)
    await w.release('after_state', 'i2')
    const r = parse(await claim)
    const flush = await w.save(P, g3, c.epoch, 1, 55)
    return { facts: { drainBlocked: drain.blocked, r, flush }, checks: [
      { name: 'same page claim linearizes before the drain (takes)', ok: r.status === 'claimed' },
      { name: 'the zombie owner\'s final flush cannot overwrite the new owner', ok: flush.results?.[0]?.result === 'stale' },
    ] }
  },
  // I3 — other-page claim paused after reading 'unreachable' ‖ the owner's stop commits.
  async I3(w) {
    const P = await w.user(); const g2 = await w.acquire(); await w.activate(g2); const g3 = await w.acquire(); await w.activate(g3)
    await w.claim(P, g3, 1, { tab: T }); await w.expire(g3)
    const s = await w.hooked('i3-claim', 'after_state', 'i3'); await w.hold('after_state', 'i3')
    const claim = s.send(w.claimSql(P, g2, 1, { tab: TB, resume: true }))
    await w.waiting(s.pid, 'advisory')
    const st = await w.open('i3-stop'); const stopP = st.send(w.stopSql(g3)); const stop = await w.finishedOrBlocked(stopP, st.pid)
    await w.release('after_state', 'i3')
    const r = parse(await claim)
    await withDeadline(stopP, 20_000, 'I3 stop')
    void stop
    const retry = await w.claim(P, g2, 2, { tab: TB, resume: true })
    return { facts: { r, retry }, checks: [
      { name: 'a stale read of a dying owner only delays (never a wrong takeover)', ok: r.status === 'owner_unreachable' },
      { name: 'the retry after the stop takes over', ok: retry.status === 'claimed' },
    ] }
  },
  // I4 — the deadlock candidate: claim (caller A < owner B) holds A + the row; B's save holds B and
  // waits for the row; B's renew queues FOR UPDATE on B; then the claim asks for B (owner-share).
  async I4(w) {
    const P = await w.user(); const A = await w.acquire(); await w.activate(A); const B = await w.acquire(); await w.activate(B)
    const c = await w.claim(P, B, 1, { tab: T })
    const before = await w.deadlocks()
    const s = await w.hooked('i4-claim', 'after_row', 'i4'); await w.hold('after_row', 'i4')
    const claim = s.send(w.claimSql(P, A, 1, { tab: T, resume: true }))
    await w.waiting(s.pid, 'advisory')
    const sv = await w.open('i4-save'); const save = sv.send(w.saveSql(P, B, c.epoch, 1, 61)); await w.waiting(sv.pid, 'row')
    const rn = await w.open('i4-renew'); const renew = rn.send(w.renewSql(B))
    const renewState = await w.finishedOrBlocked(renew, rn.pid)
    await w.release('after_row', 'i4')
    const results = await withDeadline(Promise.all([claim, save, renew]), 20_000, 'I4 completion')
    const errors = results.flatMap(r => r.errors ?? [])
    const after = await w.deadlocks()
    return { facts: { renewBlockedBeforeRelease: renewState.blocked, deadlocks: after - before, errors }, checks: [
      { name: 'no deadlock between claim, the owner\'s save and its renew', ok: after - before === 0 && !errors.some(e => /deadlock/.test(e)) },
    ] }
  },
  // I5 — the same page retries on two hosts at once (both smaller keys than a stopped owner).
  async I5(w) {
    const P = await w.user(); const A = await w.acquire(); await w.activate(A); const B = await w.acquire(); await w.activate(B); const O = await w.acquire(); await w.activate(O)
    const c = await w.claim(P, O, 1, { tab: T }); await w.drain(O); await w.stop(O)
    const s1 = await w.hooked('i5-a', 'after_row', 'i5'); await w.hold('after_row', 'i5')
    const p1 = s1.send(w.claimSql(P, A, 1, { tab: T, resume: true })); await w.waiting(s1.pid, 'advisory')
    const s2 = await w.open('i5-b'); const p2 = s2.send(w.claimSql(P, B, 1, { tab: T, resume: true })); await w.waiting(s2.pid, 'row')
    await w.release('after_row', 'i5')
    const [r1, r2] = [parse(await p1), parse(await p2)]
    const row = await w.row(P)
    return { facts: { r1, r2, row }, checks: [
      { name: 'both answers are claims; the last one owns the row', ok: r1.status === 'claimed' && r2.status === 'claimed' && row.owner === B.g },
      { name: 'epochs advance once per takeover', ok: row.epoch === c.epoch + 2 },
    ] }
  },

  // X1 — the standby acquires a HIGHER generation than the deploy candidate that is still booting.
  async X1(w) {
    const C = await w.acquire(); const S = await w.acquire()
    const ex = await w.exclusive(S)
    if (ex.status !== 'active') await w.stop(S)
    const act = await w.activate(C)
    return { facts: { ex, act, active: await w.active() }, checks: [
      { name: 'the standby yields to a booting candidate with a lower generation', ok: ex.status === 'candidate_starting' },
      { name: 'the deploy candidate activates (is not displaced by the standby)', ok: act.status === 'active' },
    ] }
  },
  // X2 — the candidate acquires AFTER the standby: both active, the standby hears newerActive.
  async X2(w) {
    const S = await w.acquire(); const ex = await w.exclusive(S); const C = await w.acquire(); const act = await w.activate(C)
    const r = await w.renew(S)
    return { facts: { ex, act, r }, checks: [
      { name: 'standby active, then candidate active (normal rollout order)', ok: ex.status === 'active' && act.status === 'active' },
      { name: 'the standby learns of the newer host (it will drain)', ok: r.newerActive === true },
    ] }
  },
  // X3 — two standbys: the lower generation wins, no livelock.
  async X3(w) {
    const S1 = await w.acquire(); const S2 = await w.acquire()
    const e2 = await w.exclusive(S2); if (e2.status !== 'active') await w.stop(S2)
    const e1 = await w.exclusive(S1)
    return { facts: { e1, e2, active: await w.active() }, checks: [
      { name: 'exactly one standby activates', ok: e2.status === 'candidate_starting' && e1.status === 'active' && (await w.active()).length === 1 },
    ] }
  },
  // X4 — a candidate that crashed while starting: its lease runs out and the standby proceeds.
  async X4(w) {
    const C = await w.acquire(); await w.expire(C); const S = await w.acquire(); const ex = await w.exclusive(S)
    return { facts: { ex }, checks: [{ name: 'a dead starting candidate does not block the standby forever', ok: ex.status === 'active' }] }
  },
  // X5 — TOCTOU: exclusive paused after its checks ‖ its own stop.
  async X5(w) {
    const S = await w.acquire()
    const s = await w.hooked('x5-ex', 'excl_after_check', 'x5'); await w.hold('excl_after_check', 'x5')
    const ex = s.send(w.exclusiveSql(S)); await w.waiting(s.pid, 'advisory')
    const st = await w.open('x5-stop'); const stopP = st.send(w.stopSql(S)); const stop = await w.finishedOrBlocked(stopP, st.pid)
    // The activation answer is read BEFORE the stop finishes (the stop may still be waiting).
    await w.release('excl_after_check', 'x5')
    const r = parse(await ex)
    const rowAtAnswer = await w.hostRow(S)
    await withDeadline(stopP, 20_000, 'X5 stop')
    const row = rowAtAnswer
    // Coherent: 'active' answered ⇒ the activation was applied (activated) before any stop.
    return { facts: { r, stopBlocked: stop.blocked, row }, checks: [
      { name: 'an answer of active implies the activation really happened', ok: r.status !== 'active' || row.activated === true },
    ] }
  },
  // X6 — D2-A end to end: candidate displaced by an autorestarted slot; the slot is stopped by the
  // agent; the candidate's process (standby) recovers with a NEW identity.
  async X6(w) {
    const O = await w.acquire(); await w.activate(O)
    const C = await w.acquire()                       // deploy candidate booting
    const X = await w.acquire(); await w.activate(X)  // autorestarted old slot: newer generation
    const act = await w.activate(C)                   // C displaced (newer_active)
    await w.stop(C)                                   // as HostLifecycle does on newer_active (#stopNow)
    await w.drain(O); await w.stop(O); await w.drain(X); await w.stop(X)   // the agent stops the old slot
    const none = await w.active()
    const S = await w.acquire(); const ex = await w.exclusive(S)          // C's process, new identity
    return { facts: { act, none, ex, active: await w.active() }, checks: [
      { name: 'reproduces D2-A: no active host', ok: act.status === 'newer_active' && none.length === 0 },
      { name: 'standby recovers exactly one active host', ok: ex.status === 'active' && (await w.active()).length === 1 },
    ] }
  },
}

// ── runner ───────────────────────────────────────────────────────────────────────────────────────
const report = { container: CONTAINER, database: DB, rounds: ROUNDS, startedAt: new Date().toISOString(), postgres: null, builds: {} }
let unexpected = 0
for (const build of Object.keys(BUILDS)) {
  let applied
  try { applied = recreate(build) } catch (error) { blocked(`setup of ${build}: ${String(error.message).slice(0, 300)}`) }
  const result = { applied, scenarios: {}, harnessErrors: 0 }
  const names = Object.keys(SCENARIOS).filter(n => !ONLY || ONLY.includes(n))
  for (const name of names) {
    const rounds = []
    for (let i = 0; i < ROUNDS; i++) {
      const w = await world()
      if (!report.postgres) report.postgres = await w.admin.one('SHOW server_version;')
      try { rounds.push(await withDeadline(SCENARIOS[name](w), 60_000, name)) } catch (error) { result.harnessErrors++; rounds.push({ harnessError: String(error.message).slice(0, 300) }) } finally { await w.close() }
    }
    const failedChecks = [...new Set(rounds.flatMap(r => (r.checks ?? []).filter(c => !c.ok).map(c => c.name)))]
    result.scenarios[name] = { pass: rounds.filter(r => r.checks && r.checks.every(c => c.ok)).length, of: ROUNDS, failedChecks, harnessErrors: rounds.filter(r => r.harnessError).map(r => r.harnessError), sample: rounds[0]?.facts ?? null }
  }
  const failing = Object.entries(result.scenarios).filter(([, s]) => s.pass < s.of).map(([n]) => n)
  const expected = build === 'prototype' ? [] : DETECTS[build]
  result.failing = failing
  result.expected = expected
  result.verdict = result.harnessErrors ? 'BLOCKED' : build === 'prototype'
    ? (failing.length === 0 ? 'PASS' : 'FAIL')
    : (expected.every(n => failing.includes(n)) ? 'DETECTED' : 'SURVIVED')
  if (result.verdict === 'FAIL' || result.verdict === 'SURVIVED') unexpected++
  report.builds[build] = result
  console.log(`${build.padEnd(26)} ${result.verdict.padEnd(9)} failing=[${failing.join(',')}] expected=[${expected.join(',')}]${result.harnessErrors ? ` harnessErrors=${result.harnessErrors}` : ''}`)
}
report.finishedAt = new Date().toISOString()
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
if (Object.values(report.builds).some(b => b.harnessErrors)) process.exit(2)
process.exit(unexpected ? 1 : 0)
