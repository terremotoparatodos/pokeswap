// CLOUD READINESS-3 — the DEFINITIVE presence-recovery SQL under concurrency, on REAL local Postgres.
//
//   node scripts/world-location/recovery-concurrency/run.mjs --container <supabase_db_*> [--rounds 5] [--out report.json]
//
// For each build — the committed migration, and one mutant per protection — it recreates the
// dedicated database `cr3_validation` (never the stack's `postgres` database) with Supabase's
// default function privileges, a minimal auth.users, the committed migrations 20261001220000,
// 20261003120000 and 20261005120000 (read with `git show HEAD:`, never the working copy). The only
// in-memory edits: barrier hooks at the migration's `-- @hook <name>` comment lines, and the
// mutant's single exact replacement (verified to match once).
//
// Order is forced with advisory-lock barriers (one per hook and session) observed through
// pg_stat_activity; sleeps never decide an order. Exit: 0 = every build behaved as expected
// (the migration passes everything, each mutant is detected by its scenario); 1 = unexpected;
// 2 = BLOCKED (no local container, setup failure, harness error, unexpected deadlock or a
// timeout). A BLOCKED run never counts as a pass or as a detection. Synthetic data only.

import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PgSession, sleep, withDeadline } from './pgSession.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const DB = 'cr3_validation'
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const CONTAINER = arg('container')
const ROUNDS = Number(arg('rounds', 5))
const OUT = arg('out')
const blocked = message => { console.log(`BLOCKED: ${message}`); process.exit(2) }
if (!CONTAINER || !/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) blocked('--container must name a local Supabase db container (supabase_db_*)')
if (process.env.DOCKER_HOST && !/^(unix|npipe):/.test(process.env.DOCKER_HOST)) blocked('DOCKER_HOST is not local')
try { if (execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], { encoding: 'utf8' }).trim() !== 'true') blocked(`${CONTAINER} is not running`) } catch { blocked(`${CONTAINER} not found`) }

const blob = file => execFileSync('git', ['-C', ROOT, 'show', `HEAD:supabase/migrations/${file}`], { encoding: 'utf8' })
const BASE = ['20261001220000_world_player_locations.sql', '20261003120000_world_location_ordering.sql']
const RECOVERY = '20261005120000_world_presence_recovery.sql'
const HOOK_FN = `CREATE OR REPLACE FUNCTION public.cr3_hook(p_name text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF position(',' || p_name || ',' IN ',' || coalesce(current_setting('cr3.hooks', true), '') || ',') > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('cr3:' || p_name || ':' || coalesce(current_setting('cr3.tag', true), '')));
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.cr3_hook(text) TO service_role;`

// ── builds: the committed migration and one mutant per protection ─────────────────────────────────
const OWNER_READ = '      v_state := public.world_presence_owner_state(v_row.owner_generation);'
const BUILDS = {
  migration: null,
  'owner-share': [OWNER_READ, `      PERFORM 1 FROM public.world_presence_hosts WHERE generation = v_row.owner_generation FOR SHARE;\n${OWNER_READ}`],
  'caller-no-share': ['SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;\n  IF NOT FOUND THEN RETURN jsonb_build_object(\'status\', \'unknown_host\'); END IF;\n  IF h.state <> \'active\' THEN RETURN jsonb_build_object(\'status\', \'host_inactive\', \'state\', h.state); END IF;\n  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object(\'status\', \'host_expired\'); END IF;\n  -- @hook after_host',
    'SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id;\n  IF NOT FOUND THEN RETURN jsonb_build_object(\'status\', \'unknown_host\'); END IF;\n  IF h.state <> \'active\' THEN RETURN jsonb_build_object(\'status\', \'host_inactive\', \'state\', h.state); END IF;\n  IF h.lease_expires_at <= now() THEN RETURN jsonb_build_object(\'status\', \'host_expired\'); END IF;\n  -- @hook after_host'],
  'draining-takes': ["        v_answer := 'owner_draining';", '        v_answer := NULL;'],
  'unreachable-takes': ["        v_answer := CASE WHEN p_takeover THEN NULL ELSE 'owner_unreachable' END;", '        v_answer := NULL;'],
  'takeover-ignored': ["        v_answer := CASE WHEN p_takeover THEN NULL ELSE 'owner_unreachable' END;", "        v_answer := 'owner_unreachable';"],
  'draining-expired-stopped': ["      WHEN h.state IN ('active', 'draining')                      THEN 'unreachable'", "      WHEN h.state = 'active'                                     THEN 'unreachable'"],
  'no-yield': ["WHERE o.generation < p_generation AND o.state = 'starting'", "WHERE false AND o.state = 'starting'"],
  'excl-no-lock': ['  LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE;\n  -- @hook excl_after_lock', '  -- @hook excl_after_lock'],
}
const DETECTS = {
  'owner-share': ['I1'], 'caller-no-share': ['C1'], 'draining-takes': ['S4'], 'unreachable-takes': ['S2'], 'takeover-ignored': ['S2'],
  'draining-expired-stopped': ['S4b'], 'no-yield': ['X1'], 'excl-no-lock': ['X5'],
}
function migrationFor(build) {
  let text = blob(RECOVERY).split('\r\n').join('\n')
  const m = BUILDS[build]
  if (m) {
    const count = text.split(m[0]).length - 1
    if (count !== 1) blocked(`mutant ${build}: its fragment matches ${count} times`)
    text = text.replace(m[0], () => m[1])
  }
  const hooks = text.match(/^\s*-- @hook [a-z_]+$/gm) ?? []
  if (hooks.length !== 5) blocked(`expected 5 hook lines, found ${hooks.length}`)
  return text.replace(/^(\s*)-- @hook ([a-z_]+)$/gm, (_m, indent, name) => `${indent}PERFORM public.cr3_hook('${name}');`)
}

// ── database lifecycle ───────────────────────────────────────────────────────────────────────────
const psql = (database, sql) => execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
function recreate(build) {
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();`)
  psql('postgres', `DROP DATABASE IF EXISTS ${DB};`)
  psql('postgres', `CREATE DATABASE ${DB};`)
  // Supabase's default privileges (the worst case the migrations must revoke) and a minimal auth.users.
  psql(DB, `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
    CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);`)
  psql(DB, HOOK_FN)
  for (const file of BASE) psql(DB, blob(file))
  psql(DB, migrationFor(build))
  const grants = psql(DB, execFileSync('git', ['-C', ROOT, 'show', 'HEAD:scripts/world-location/recovery-grants-check.sql'], { encoding: 'utf8' })).trim()
  return { grants: grants === '' ? 'closed (0 rows)' : grants }
}

// ── one scenario's world ─────────────────────────────────────────────────────────────────────────
async function world() {
  const sessions = []
  const open = async (name, role = 'service_role') => { const s = await new PgSession(CONTAINER, DB, name).init(role); sessions.push(s); return s }
  const admin = await open('admin', null)
  await admin.one("UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now() WHERE state <> 'stopped';")
  const svc = await open('svc')
  const q = s => `'${String(s).replaceAll("'", "''")}'`
  const w = {
    admin, svc, open,
    async user() { const id = randomUUID(); await admin.one(`INSERT INTO auth.users VALUES (${q(id)}::uuid);`); return id },
    async acquire(s = svc) { const h = randomUUID(); const r = await s.json(`SELECT public.world_presence_acquire(${q(h)}::uuid, 15000);`); return { g: Number(r.generation), h, seq: 0 } },
    activate: (x, s = svc) => s.json(`SELECT public.world_presence_activate(${x.g}, ${q(x.h)}::uuid, 15000);`),
    async active() { const x = await w.acquire(); await w.activate(x); return x },
    exclusiveSql: x => `SELECT public.world_presence_activate_exclusive(${x.g}, ${q(x.h)}::uuid, 15000);`,
    exclusive: (x, s = svc) => s.json(w.exclusiveSql(x)),
    renewSql: x => `SELECT public.world_presence_renew(${x.g}, ${q(x.h)}::uuid, 15000);`,
    renew: (x, s = svc) => s.json(w.renewSql(x)),
    drainSql: x => `SELECT public.world_presence_drain(${x.g}, ${q(x.h)}::uuid, 10000);`,
    drain: (x, s = svc) => s.json(w.drainSql(x)),
    stopSql: x => `SELECT public.world_presence_stop(${x.g}, ${q(x.h)}::uuid);`,
    stop: (x, s = svc) => s.json(w.stopSql(x)),
    claimSql: (u, x, { takeover = false, seq = ++x.seq } = {}) => `SELECT public.world_location_claim_keyed_v2(${q(u)}::uuid, ${x.g}, ${seq}, ${q(randomUUID())}::uuid, ${q(x.h)}::uuid, ${takeover});`,
    claim: (u, x, opts, s = svc) => s.json(w.claimSql(u, x, opts)),
    saveSql: (u, x, epoch, seq, tx) => `SELECT public.world_location_save_keyed(${q(JSON.stringify([{ userId: u, epoch, seq, areaId: 'ciudad-corazon', tx, ty: 20, layoutVersion: '1.test' }]))}::jsonb, ${x.g}, ${q(x.h)}::uuid);`,
    save: (u, x, epoch, seq, tx, s = svc) => s.json(w.saveSql(u, x, epoch, seq, tx)),
    expire: x => admin.one(`UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = ${x.g};`),
    row: async u => admin.json(`SELECT row_to_json(r) FROM (SELECT tx, epoch::int AS epoch, owner_generation::int AS owner FROM public.world_player_locations WHERE user_id = ${q(u)}::uuid) r;`),
    hostRow: async x => admin.json(`SELECT row_to_json(r) FROM (SELECT state, activated_at IS NOT NULL AS activated FROM public.world_presence_hosts WHERE generation = ${x.g}) r;`),
    active2: async () => (await admin.send("SELECT generation FROM public.world_presence_hosts WHERE state = 'active' AND lease_expires_at > now() ORDER BY 1;")).rows.map(Number),
    deadlocks: async () => Number(await admin.one(`SELECT deadlocks FROM pg_stat_database WHERE datname = '${DB}';`)),
    hold: (hook, tag) => admin.one(`SELECT pg_advisory_lock(hashtext('cr3:${hook}:${tag}'));`),
    release: (hook, tag) => admin.one(`SELECT pg_advisory_unlock(hashtext('cr3:${hook}:${tag}'));`),
    async hooked(name, hooks, tag) { const s = await open(name); await s.one(`SET cr3.hooks = ${q(hooks)};`); await s.one(`SET cr3.tag = ${q(tag)};`); return s },
    async waiting(pid, kind, ms = 10_000) {
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        const r = await admin.one(`SELECT coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') FROM pg_stat_activity WHERE pid = ${pid};`)
        if (kind === 'advisory' && r === 'Lock:advisory') return r
        if (kind === 'row' && /^Lock:(transactionid|tuple)$/.test(r)) return r
        await sleep(20)
      }
      throw new Error(`harness: pid ${pid} never waited on ${kind}`)
    },
    /** Observation only: either the call finished, or it is blocked on a (non-advisory) lock. */
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
const resultOf = a => a?.results?.[0]?.result ?? a?.status

/** g2 (old, active) and g3 (newer owner) that saved tile 32 for a fresh user. */
async function ownedByNewer(w) {
  const P = await w.user(); const g2 = await w.active(); const g3 = await w.active()
  const c = await w.claim(P, g3); await w.save(P, g3, c.epoch, 1, 32)
  return { P, g2, g3, epoch: c.epoch }
}

// ── scenarios ────────────────────────────────────────────────────────────────────────────────────
const SCENARIOS = {
  async S2(w) {
    const { P, g2, g3, epoch } = await ownedByNewer(w)
    await w.expire(g3)
    const resumed = await w.claim(P, g2)
    const unchanged = await w.row(P)
    const takeover = await w.claim(P, g2, { takeover: true })
    return { facts: { resumed, unchanged, takeover }, checks: [
      { name: 'a resume never takes from an unreachable owner', ok: resumed.status === 'owner_unreachable' && unchanged.owner === g3.g && unchanged.epoch === epoch },
      { name: 'an explicit takeover does, restoring the last tile', ok: takeover.status === 'claimed' && takeover.location?.tx === 32 },
    ] }
  },
  async S3(w) {
    const { P, g2, g3 } = await ownedByNewer(w)
    await w.drain(g3); await w.stop(g3)
    const r = await w.claim(P, g2)
    return { facts: { r }, checks: [{ name: 'a stopped owner is taken over with its last tile', ok: r.status === 'claimed' && r.location?.tx === 32 }] }
  },
  async S4(w) {
    const { P, g2, g3, epoch } = await ownedByNewer(w)
    await w.drain(g3)
    const during = await w.claim(P, g2)
    const flush = await w.save(P, g3, epoch, 2, 35)
    await w.stop(g3)
    const after = await w.claim(P, g2)
    return { facts: { during, flush, after }, checks: [
      { name: 'owner_draining while the owner drains', ok: during.status === 'owner_draining' },
      { name: 'its final flush is kept and then restored', ok: resultOf(flush) === 'applied' && after.status === 'claimed' && after.location?.tx === 35 },
    ] }
  },
  async S4b(w) {
    const { P, g2, g3 } = await ownedByNewer(w)
    await w.drain(g3); await w.expire(g3)
    const r = await w.claim(P, g2)
    return { facts: { r }, checks: [{ name: 'an expired drain is not proof of closed sockets', ok: r.status === 'owner_unreachable' }] }
  },
  async S6(w) {
    const { P, g2 } = await ownedByNewer(w)
    const r = await w.claim(P, g2); const t = await w.claim(P, g2, { takeover: true })
    return { facts: { r, t }, checks: [{ name: 'a live newer owner keeps the v1 order (also against a takeover)', ok: r.status === 'superseded' && r.newerActive === true && t.status === 'superseded' }] }
  },
  // C1 — I17 for v2: a claim whose host check passed ‖ that host's drain. The drain must wait.
  async C1(w) {
    const P = await w.user(); const A = await w.active()
    const s = await w.hooked('c1-claim', 'after_host', 'c1'); await w.hold('after_host', 'c1')
    const claim = s.send(w.claimSql(P, A)); await w.waiting(s.pid, 'advisory')
    const d = await w.open('c1-drain'); const drainP = d.send(w.drainSql(A)); const drain = await w.finishedOrBlocked(drainP, d.pid)
    await w.release('after_host', 'c1')
    const r = parse(await claim); await withDeadline(drainP, 20_000, 'C1 drain')
    return { facts: { r, drainBlocked: drain.blocked }, checks: [
      { name: 'a host never wins a row after its own drain committed (the drain waits for the claim)', ok: drain.blocked === true || r.status !== 'claimed' },
    ] }
  },
  // I1 — claim paused after reading the owner (unreachable) ‖ the owner's renew: never blocked; takeover still decided.
  async I1(w) {
    const { P, g2, g3, epoch } = await ownedByNewer(w)
    await w.expire(g3)
    const s = await w.hooked('i1-claim', 'after_state', 'i1'); await w.hold('after_state', 'i1')
    const claim = s.send(w.claimSql(P, g2, { takeover: true })); await w.waiting(s.pid, 'advisory')
    const rn = await w.open('i1-renew'); const renewP = rn.send(w.renewSql(g3)); const renew = await w.finishedOrBlocked(renewP, rn.pid)
    await w.release('after_state', 'i1')
    const r = parse(await claim); await withDeadline(renewP, 20_000, 'I1 renew')
    const late = await w.save(P, g3, epoch, 2, 77)
    return { facts: { renewBlocked: renew.blocked, wait: renew.wait, r, late }, checks: [
      { name: 'the owner\'s renew never waits on another host\'s claim', ok: renew.blocked === false },
      { name: 'the takeover decided on what it read; the revived owner cannot write the taken row', ok: r.status === 'claimed' && resultOf(late) === 'stale' },
    ] }
  },
  // I2 — a resume paused after reading a LIVE owner ‖ the owner's drain: superseded stands (linearized before the drain).
  async I2(w) {
    const { P, g2, g3 } = await ownedByNewer(w)
    const s = await w.hooked('i2-claim', 'after_state', 'i2'); await w.hold('after_state', 'i2')
    const claim = s.send(w.claimSql(P, g2)); await w.waiting(s.pid, 'advisory')
    const d = await w.open('i2-drain'); const drainP = d.send(w.drainSql(g3)); const drain = await w.finishedOrBlocked(drainP, d.pid)
    await w.release('after_state', 'i2')
    const r = parse(await claim); await withDeadline(drainP, 20_000, 'I2 drain')
    return { facts: { r, drainBlocked: drain.blocked }, checks: [
      { name: 'the drain is not blocked by another host\'s claim', ok: drain.blocked === false },
      { name: 'a resume against a live owner never takes', ok: r.status === 'superseded' },
    ] }
  },
  // I3 — a resume paused after reading 'unreachable' ‖ the owner's stop: the stale read only delays.
  async I3(w) {
    const { P, g2, g3 } = await ownedByNewer(w)
    await w.expire(g3)
    const s = await w.hooked('i3-claim', 'after_state', 'i3'); await w.hold('after_state', 'i3')
    const claim = s.send(w.claimSql(P, g2)); await w.waiting(s.pid, 'advisory')
    const st = await w.open('i3-stop'); const stopP = st.send(w.stopSql(g3)); await w.finishedOrBlocked(stopP, st.pid)
    await w.release('after_state', 'i3')
    const r = parse(await claim); await withDeadline(stopP, 20_000, 'I3 stop')
    const retry = await w.claim(P, g2)
    return { facts: { r, retry }, checks: [
      { name: 'a stale read of a dying owner only delays', ok: r.status === 'owner_unreachable' },
      { name: 'the retry after the stop takes over', ok: retry.status === 'claimed' && retry.location?.tx === 32 },
    ] }
  },
  // I4 — the deadlock candidate: claim (A < B) holds A + the row; B's save holds B and waits for the row; B's renew queues.
  async I4(w) {
    const { P, g2: A, g3: B, epoch } = await ownedByNewer(w)
    const before = await w.deadlocks()
    const s = await w.hooked('i4-claim', 'after_row', 'i4'); await w.hold('after_row', 'i4')
    const claim = s.send(w.claimSql(P, A)); await w.waiting(s.pid, 'advisory')
    const sv = await w.open('i4-save'); const save = sv.send(w.saveSql(P, B, epoch, 2, 61)); await w.waiting(sv.pid, 'row')
    const rn = await w.open('i4-renew'); const renew = rn.send(w.renewSql(B)); await w.finishedOrBlocked(renew, rn.pid)
    await w.release('after_row', 'i4')
    const results = await withDeadline(Promise.all([claim, save, renew]), 20_000, 'I4 completion')
    const errors = results.flatMap(r => r.errors ?? [])
    const after = await w.deadlocks()
    return { facts: { deadlocks: after - before, errors, claim: parse(results[0]) }, checks: [
      { name: 'no deadlock between a claim, the owner\'s save and its renew', ok: after - before === 0 && errors.length === 0 },
    ] }
  },
  // I5 — two claims of the same player from two hosts, both smaller than a stopped owner.
  async I5(w) {
    const P = await w.user(); const A = await w.active(); const B = await w.active(); const O = await w.active()
    const c = await w.claim(P, O); await w.drain(O); await w.stop(O)
    const s1 = await w.hooked('i5-a', 'after_row', 'i5'); await w.hold('after_row', 'i5')
    const p1 = s1.send(w.claimSql(P, A)); await w.waiting(s1.pid, 'advisory')
    const s2 = await w.open('i5-b'); const p2 = s2.send(w.claimSql(P, B)); await w.waiting(s2.pid, 'row')
    await w.release('after_row', 'i5')
    const [r1, r2] = [parse(await p1), parse(await p2)]
    const row = await w.row(P)
    return { facts: { r1, r2, row }, checks: [
      { name: 'serialized on the row: the greater key ends owning it, one epoch per takeover', ok: r1.status === 'claimed' && r2.status === 'claimed' && row.owner === B.g && row.epoch === c.epoch + 2 },
    ] }
  },
  async X1(w) {
    const C = await w.acquire(); const S = await w.acquire()
    const ex = await w.exclusive(S); if (ex.status !== 'active') await w.stop(S)
    const act = await w.activate(C)
    return { facts: { ex, act }, checks: [
      { name: 'the standby yields to a booting candidate of a lower generation', ok: ex.status === 'candidate_starting' },
      { name: 'the deploy candidate is not displaced by the standby', ok: act.status === 'active' },
    ] }
  },
  async X3(w) {
    const S1 = await w.acquire(); const S2 = await w.acquire()
    const e2 = await w.exclusive(S2); if (e2.status !== 'active') await w.stop(S2)
    const e1 = await w.exclusive(S1)
    const active = await w.active2()
    return { facts: { e1, e2, active }, checks: [{ name: 'two standbys: exactly one activates', ok: e2.status === 'candidate_starting' && e1.status === 'active' && active.length === 1 }] }
  },
  // X5 — TOCTOU: the exclusive activation paused after its checks ‖ its own stop.
  async X5(w) {
    const S = await w.acquire()
    const s = await w.hooked('x5-ex', 'excl_after_check', 'x5'); await w.hold('excl_after_check', 'x5')
    const ex = s.send(w.exclusiveSql(S)); await w.waiting(s.pid, 'advisory')
    const st = await w.open('x5-stop'); const stopP = st.send(w.stopSql(S)); const stop = await w.finishedOrBlocked(stopP, st.pid)
    await w.release('excl_after_check', 'x5')
    const r = parse(await ex)
    const rowAtAnswer = await w.hostRow(S)
    await withDeadline(stopP, 20_000, 'X5 stop')
    return { facts: { r, stopBlocked: stop.blocked, rowAtAnswer }, checks: [
      { name: 'an answer of active implies the activation really happened', ok: r.status !== 'active' || rowAtAnswer.activated === true },
    ] }
  },
  // X6 — exclusive ‖ normal activation of a candidate acquired later: serialized; both end active; the standby hears newerActive.
  async X6(w) {
    // C is acquired BEFORE the exclusive activation holds the table lock (an acquire inserts: it would wait too).
    const S = await w.acquire(); const C = await w.acquire()
    const s = await w.hooked('x6-ex', 'excl_after_check', 'x6'); await w.hold('excl_after_check', 'x6')
    const ex = s.send(w.exclusiveSql(S)); await w.waiting(s.pid, 'advisory')
    const ca = await w.open('x6-act'); const actP = ca.send(`SELECT public.world_presence_activate(${C.g}, '${C.h}'::uuid, 15000);`); const act = await w.finishedOrBlocked(actP, ca.pid)
    await w.release('excl_after_check', 'x6')
    const r = parse(await ex); const a = parse(await withDeadline(actP, 20_000, 'X6 activate'))
    const renew = await w.renew(S)
    return { facts: { r, a, actBlocked: act.blocked, renew }, checks: [
      { name: 'the normal activation waits for the exclusive one (table lock)', ok: act.blocked === true },
      { name: 'both active, the standby learns of the newer candidate', ok: r.status === 'active' && a.status === 'active' && renew.newerActive === true },
    ] }
  },
}

// ── runner ───────────────────────────────────────────────────────────────────────────────────────
const report = { container: CONTAINER, database: DB, rounds: ROUNDS, head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), startedAt: new Date().toISOString(), postgres: null, builds: {} }
let unexpected = 0
let blockedRun = false
for (const build of Object.keys(BUILDS)) {
  let setup
  try { setup = recreate(build) } catch (error) { blocked(`setup of ${build}: ${String(error.message).slice(0, 300)}`) }
  const result = { setup, scenarios: {}, harnessErrors: 0 }
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const rounds = []
    for (let i = 0; i < ROUNDS; i++) {
      const w = await world()
      if (!report.postgres) report.postgres = await w.admin.one('SHOW server_version;')
      try { rounds.push(await withDeadline(scenario(w), 60_000, name)) } catch (error) { result.harnessErrors++; rounds.push({ harnessError: String(error.message).slice(0, 300) }) } finally { await w.close() }
    }
    result.scenarios[name] = {
      pass: rounds.filter(r => r.checks && r.checks.every(c => c.ok)).length, of: ROUNDS,
      failedChecks: [...new Set(rounds.flatMap(r => (r.checks ?? []).filter(c => !c.ok).map(c => c.name)))],
      harnessErrors: rounds.filter(r => r.harnessError).map(r => r.harnessError), sample: rounds[0]?.facts ?? null,
    }
  }
  const failing = Object.entries(result.scenarios).filter(([, s]) => s.pass < s.of).map(([n]) => n)
  const expected = build === 'migration' ? [] : DETECTS[build]
  Object.assign(result, { failing, expected })
  if (result.harnessErrors) blockedRun = true
  result.verdict = result.harnessErrors ? 'BLOCKED' : build === 'migration'
    ? (failing.length === 0 && setup.grants === 'closed (0 rows)' ? 'PASS' : 'FAIL')
    : (expected.every(n => failing.includes(n)) ? 'DETECTED' : 'SURVIVED')
  if (result.verdict === 'FAIL' || result.verdict === 'SURVIVED') unexpected++
  report.builds[build] = result
  console.log(`${build.padEnd(26)} ${result.verdict.padEnd(9)} failing=[${failing.join(',')}] expected=[${expected.join(',')}] grants=${setup.grants}${result.harnessErrors ? ` harnessErrors=${result.harnessErrors}` : ''}`)
}
report.finishedAt = new Date().toISOString()
if (OUT) writeFileSync(OUT, JSON.stringify(report, null, 2) + '\n')
process.exit(blockedRun ? 2 : unexpected ? 1 : 0)
