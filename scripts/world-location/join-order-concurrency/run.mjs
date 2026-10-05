// CLOUD JOIN-ORDER-2 — the DEFINITIVE join-order SQL (claim v3) under concurrency, on REAL local Postgres.
//
//   node scripts/world-location/join-order-concurrency/run.mjs --container <supabase_db_*> [--rounds 5] [--out report.json]
//
// For each build — the committed migration, and one mutant per protection — it recreates the dedicated
// database `cr5_joinorder` (never the stack's `postgres` database) with Supabase's default function
// privileges, a minimal auth.users and the committed migrations 20261001220000, 20261003120000,
// 20261005120000 and 20261006120000 (read with `git show HEAD:`, never the working copy). The only
// in-memory edits: a barrier at each `-- @hook <name>` comment line of 20261006120000, and the mutant's
// single exact replacement (verified to match once). PGlite is never used here.
//
// Order is forced with advisory-lock barriers (one per hook and session tag) observed through
// pg_stat_activity; sleeps only poll observations and never decide an order. Exit: 0 = every build
// behaved as expected (the migration passes every scenario, each mutant fails the scenario named for
// it); 1 = unexpected; 2 = BLOCKED (no local container, setup failure, harness error or timeout).
// A BLOCKED run never counts as a pass or as a detection. Synthetic data only.

import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { PgSession, sleep, withDeadline } from '../recovery-concurrency/pgSession.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..')
const DB = 'cr5_joinorder'
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const CONTAINER = arg('container')
const ROUNDS = Number(arg('rounds', 5))
const blocked = message => { console.log(`BLOCKED: ${message}`); process.exit(2) }
if (!CONTAINER || !/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) blocked('--container must name a local Supabase db container')
try { if (execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], { encoding: 'utf8' }).trim() !== 'true') blocked('not running') } catch { blocked('container not found') }

const blob = file => execFileSync('git', ['-C', ROOT, 'show', `HEAD:${file}`], { encoding: 'utf8' }).split('\r\n').join('\n')
const EARLIER = ['20261001220000_world_player_locations.sql', '20261003120000_world_location_ordering.sql', '20261005120000_world_presence_recovery.sql']
const MIGRATION = blob('supabase/migrations/20261006120000_world_location_join_order.sql')
const GRANTS = [blob('scripts/world-location/join-order-grants-check.sql'), blob('scripts/world-location/location-grants-check.sql')]
const HOOK_FN = `CREATE OR REPLACE FUNCTION public.cr5_hook(p_name text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF position(',' || p_name || ',' IN ',' || coalesce(current_setting('cr5.hooks', true), '') || ',') > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('cr5:' || p_name || ':' || coalesce(current_setting('cr5.tag', true), '')));
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.cr5_hook(text) TO service_role;`

// One exact replacement per mutant (each removes ONE protection) and the scenarios that must catch it.
const MUTANTS = {
  'no-same-page-refusal': {
    from: `      IF v_row.owner_page_session IS NOT NULL AND v_row.owner_page_session = v_row.owner_session
         AND v_row.owner_page = p_page AND p_attempt <= v_row.owner_attempt THEN`,
    to: '      IF false THEN', detects: ['J1'],
  },
  'no-page-session-binding': {
    from: `      IF v_row.owner_page_session IS NOT NULL AND v_row.owner_page_session = v_row.owner_session
         AND`, to: `      IF v_row.owner_page IS NOT NULL
         AND`, detects: ['J5'],
  },
  'duplicate-takes': { from: 'AND v_row.owner_page = p_page AND p_attempt <= v_row.owner_attempt THEN', to: 'AND v_row.owner_page = p_page AND p_attempt < v_row.owner_attempt THEN', detects: ['J4'] },
  'attempt-authorizes-takeover': {
    from: '      ELSIF (v_row.owner_generation, v_row.owner_seq) < (p_generation, p_seq) THEN',
    to: `      ELSIF v_row.owner_page = p_page AND v_row.owner_page_session = v_row.owner_session THEN
        v_answer := NULL;
      ELSIF (v_row.owner_generation, v_row.owner_seq) < (p_generation, p_seq) THEN`, detects: ['J2'],
  },
  'no-row-lock': { from: 'SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id FOR UPDATE;', to: 'SELECT * INTO v_row FROM public.world_player_locations WHERE user_id = p_user_id;', detects: ['J4'] },
  'adoption-removed': { from: `    IF v_row.owner_generation = p_generation AND v_row.owner_seq = p_seq THEN
      -- Adoption`, to: `    IF false THEN
      -- Adoption`, detects: ['J7'] },
  'caller-no-share': { from: 'WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;', to: 'WHERE generation = p_generation AND host_id = p_host_id;', detects: ['J9'] },
}
const BUILDS = ['migration', ...Object.keys(MUTANTS)]

function migrationFor(build) {
  let text = MIGRATION
  const m = MUTANTS[build]
  if (m) { const n = text.split(m.from).length - 1; if (n !== 1) blocked(`mutant ${build}: ${n} matches`); text = text.replace(m.from, () => m.to) }
  return text.replace(/^(\s*)-- @hook ([a-z_]+)$/gm, (_m, indent, name) => `${indent}PERFORM public.cr5_hook('${name}');`)
}
const psql = (database, sql) => execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
function recreate(build) {
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();`)
  psql('postgres', `DROP DATABASE IF EXISTS ${DB};`)
  psql('postgres', `CREATE DATABASE ${DB};`)
  psql(DB, `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);`)
  psql(DB, HOOK_FN)
  for (const file of EARLIER) psql(DB, blob(`supabase/migrations/${file}`))
  psql(DB, migrationFor(build))
  return GRANTS.map(check => psql(DB, check).trim()).filter(Boolean)
}

const PAGE = 'tab-page-0001'
const SEED = 'tab-seed-0001'
const q = s => `'${String(s).replaceAll("'", "''")}'`
const parse = r => (r?.ok && r.rows[0] ? JSON.parse(r.rows[0]) : { error: r?.errors?.join(' | ') ?? 'no answer' })
const resultOf = a => a?.results?.[0]?.result ?? a?.status

async function world() {
  const sessions = []
  const open = async (name, role = 'service_role') => { const s = await new PgSession(CONTAINER, DB, name).init(role); sessions.push(s); return s }
  const admin = await open('admin', null)
  await admin.one("UPDATE public.world_presence_hosts SET state = 'stopped', stopped_at = now() WHERE state <> 'stopped';")
  const svc = await open('svc')
  const w = {
    admin, svc, open,
    async user() { const id = randomUUID(); await admin.one(`INSERT INTO auth.users VALUES (${q(id)}::uuid);`); return id },
    async host() {
      const h = randomUUID()
      const r = await svc.json(`SELECT public.world_presence_acquire(${q(h)}::uuid, 15000);`)
      const x = { g: Number(r.generation), h, seq: 0 }
      await svc.json(`SELECT public.world_presence_activate(${x.g}, ${q(x.h)}::uuid, 15000);`)
      return x
    },
    claimSql: (u, x, { page = PAGE, attempt, recovery = false, seq = ++x.seq, session = randomUUID() }) =>
      `SELECT public.world_location_claim_keyed_v3(${q(u)}::uuid, ${x.g}, ${seq}, ${q(session)}::uuid, ${q(x.h)}::uuid, false, ${recovery}, ${q(page)}, ${attempt});`,
    claim: (u, x, options, s = svc) => s.json(w.claimSql(u, x, options)),
    claimV1: (u, x) => svc.json(`SELECT public.world_location_claim_keyed(${q(u)}::uuid, ${x.g}, ${++x.seq}, ${q(randomUUID())}::uuid, ${q(x.h)}::uuid);`),
    save: (u, x, epoch, seq, tx, s = svc) => s.json(w.saveSql(u, x, epoch, seq, tx)),
    saveSql: (u, x, epoch, seq, tx) => `SELECT public.world_location_save_keyed(${q(JSON.stringify([{ userId: u, epoch, seq, areaId: 'ciudad-corazon', tx, ty: 20, layoutVersion: '1.test' }]))}::jsonb, ${x.g}, ${q(x.h)}::uuid);`,
    drain: x => svc.json(`SELECT public.world_presence_drain(${x.g}, ${q(x.h)}::uuid, 10000);`),
    drainSql: x => `SELECT public.world_presence_drain(${x.g}, ${q(x.h)}::uuid, 10000);`,
    row: u => admin.json(`SELECT row_to_json(r) FROM (SELECT tx, epoch::int AS epoch, owner_generation::int AS owner, owner_attempt::int AS attempt, owner_page AS page FROM public.world_player_locations WHERE user_id = ${q(u)}::uuid) r;`),
    deadlocks: async () => Number(await admin.one(`SELECT deadlocks FROM pg_stat_database WHERE datname = '${DB}';`)),
    hold: (hook, tag) => admin.one(`SELECT pg_advisory_lock(hashtext('cr5:${hook}:${tag}'));`),
    release: (hook, tag) => admin.one(`SELECT pg_advisory_unlock(hashtext('cr5:${hook}:${tag}'));`),
    async hooked(name, hooks, tag) { const s = await open(name); await s.one(`SET cr5.hooks = ${q(hooks)};`); await s.one(`SET cr5.tag = ${q(tag)};`); return s },
    /** What `pid` is blocked on: 'advisory' (a barrier), 'row' (a row lock), or 'done' when `pending` already answered. */
    async blockedOn(pid, pending, ms = 10_000) {
      let done = false
      pending.then(() => { done = true }, () => { done = true })
      const deadline = Date.now() + ms
      while (Date.now() < deadline) {
        if (done) return 'done'
        const r = await admin.one(`SELECT coalesce(wait_event_type, '') || ':' || coalesce(wait_event, '') FROM pg_stat_activity WHERE pid = ${pid};`)
        if (r === 'Lock:advisory') return 'advisory'
        if (/^Lock:(transactionid|tuple)$/.test(r)) return 'row'
        await sleep(20)
      }
      throw new Error(`harness: pid ${pid} neither blocked nor answered`)
    },
    async close() { for (const s of sessions) await s.close() },
  }
  return w
}

/** Holds `first` at after_row (it owns the row lock), sends `second`, releases. Returns both answers and what `second` waited on. */
async function rowRace(w, tag, firstSql, secondSql, { secondHooked = false } = {}) {
  const s1 = await w.hooked(`${tag}-1`, 'after_row', `${tag}-1`)
  const s2 = secondHooked ? await w.hooked(`${tag}-2`, 'after_row', `${tag}-2`) : await w.open(`${tag}-2`)
  await w.hold('after_row', `${tag}-1`)
  if (secondHooked) await w.hold('after_row', `${tag}-2`)
  const p1 = s1.send(firstSql)
  if ((await w.blockedOn(s1.pid, p1)) !== 'advisory') throw new Error('harness: the first claim never reached its barrier')
  const p2 = s2.send(secondSql)
  const second = await w.blockedOn(s2.pid, p2)
  await w.release('after_row', `${tag}-1`)
  const r1 = parse(await p1)
  if (secondHooked) await w.release('after_row', `${tag}-2`)
  const r2 = parse(await p2)
  return { r1, r2, secondWaitedOn: second }
}

const SCENARIOS = {
  // J1 — the newer attempt owns the row; the OLD attempt arrives from a NEWER host (greater key): stale_attempt, nothing written.
  async J1(w) {
    const checks = []
    for (const recovery of [false, true]) {
      const u = await w.user(); const A = await w.host(); const B = await w.host()
      const cur = await w.claim(u, A, { attempt: 2, recovery })
      const old = await w.claim(u, B, { attempt: 1, recovery })
      const row = await w.row(u)
      const save = await w.save(u, A, cur.epoch, 1, 31)
      checks.push({ name: `recovery=${recovery}: the old attempt never takes the row (greater key or not); the current one keeps saving`, ok: old.status === 'stale_attempt' && row.owner === A.g && row.attempt === 2 && row.epoch === cur.epoch && resultOf(save) === 'applied' })
    }
    return { checks }
  },
  // J2 — the reverse order: the OLD attempt claimed first on the NEWER host; the newer attempt (older host) gets exactly the v1/v2 answer.
  async J2(w) {
    const checks = []
    for (const recovery of [false, true]) {
      const u = await w.user(); const A = await w.host(); const B = await w.host()
      await w.claim(u, B, { attempt: 1, recovery })
      const cur = await w.claim(u, A, { attempt: 2, recovery })
      const row = await w.row(u)
      checks.push({ name: `recovery=${recovery}: the attempt number authorizes no takeover from a live owner (superseded, as v1/v2)`, ok: cur.status === 'superseded' && cur.newerActive === true && row.owner === B.g && row.attempt === 1 })
    }
    return { checks }
  },
  // J3 — concurrent: the first claim holds the row lock, the second waits on it; both orders, both rule sets.
  async J3(w) {
    const checks = []
    for (const recovery of [false, true]) for (const first of ['old', 'new']) {
      const u = await w.user(); const A = await w.host(); const B = await w.host()
      await w.claim(u, A, { page: SEED, attempt: 1, recovery })               // another page owns the row (smaller key)
      const oldSql = w.claimSql(u, B, { attempt: 1, recovery }); const newSql = w.claimSql(u, A, { attempt: 2, recovery })
      const { r1, r2, secondWaitedOn } = await rowRace(w, `j3-${recovery}-${first}`, first === 'old' ? oldSql : newSql, first === 'old' ? newSql : oldSql)
      const row = await w.row(u)
      const ok = secondWaitedOn === 'row' && r1.status === 'claimed' && (first === 'new'
        ? r2.status === 'stale_attempt' && row.attempt === 2 && row.owner === A.g
        : r2.status === 'superseded' && row.attempt === 1 && row.owner === B.g)
      checks.push({ name: `recovery=${recovery}, ${first} first: serialized on the row lock, decided on the committed row`, ok })
    }
    return { checks }
  },
  // J4 — a duplicate (same page and attempt) from two hosts at once: exactly one claims.
  async J4(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    await w.claim(u, A, { page: SEED, attempt: 1 })
    const { r1, r2, secondWaitedOn } = await rowRace(w, 'j4', w.claimSql(u, A, { attempt: 3 }), w.claimSql(u, B, { attempt: 3 }), { secondHooked: true })
    const row = await w.row(u)
    return { facts: { r1, r2, secondWaitedOn, row }, checks: [{ name: 'a duplicate claims once; the copy is duplicate_attempt (it waited on the row lock)', ok: secondWaitedOn === 'row' && r1.status === 'claimed' && r2.status === 'duplicate_attempt' && row.owner === A.g }] }
  },
  // J5 — mixed fleet: a v1 claim (another realtime version) takes the row; the page's info is no longer bound to the owner.
  async J5(w) {
    const u = await w.user(); const A = await w.host(); const C = await w.host(); const D = await w.host()
    await w.claim(u, A, { attempt: 2 })
    const legacy = await w.claimV1(u, C)
    const old = await w.claim(u, D, { attempt: 1 })                          // an older attempt of the page, newest host
    const row = await w.row(u)
    return { facts: { legacy, old, row }, checks: [{ name: 'after a legacy take the page info is void: ordered by keys only (documented partial guarantee)', ok: legacy.status === 'claimed' && old.status === 'claimed' && row.owner === D.g && row.attempt === 1 }] }
  },
  // J6 — recovery rules: the page's newer attempt waits for a draining owner (its older attempt); the final flush is kept.
  async J6(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    const old = await w.claim(u, B, { attempt: 1, recovery: true })
    await w.drain(B)
    const during = await w.claim(u, A, { attempt: 2, recovery: true })
    const flush = await w.save(u, B, old.epoch, 1, 41)
    return { facts: { during, flush }, checks: [{ name: 'a draining owner keeps its final flush (owner_draining, then the flush applies)', ok: during.status === 'owner_draining' && resultOf(flush) === 'applied' }] }
  },
  // J7 — a retry of the SAME claim (same key and session) racing its own first send: one write, both answers claimed with one epoch.
  async J7(w) {
    const u = await w.user(); const A = await w.host()
    await w.claim(u, A, { page: SEED, attempt: 1 })
    const session = randomUUID(); const seq = ++A.seq
    const sql = w.claimSql(u, A, { attempt: 2, seq, session })
    const { r1, r2, secondWaitedOn } = await rowRace(w, 'j7', sql, sql)
    const row = await w.row(u)
    return { facts: { r1, r2, row }, checks: [{ name: 'an internal retry is idempotent (adoption: same epoch, written once)', ok: secondWaitedOn === 'row' && r1.status === 'claimed' && r2.status === 'claimed' && r1.epoch === r2.epoch && row.epoch === r1.epoch }] }
  },
  // J8 — a stale claim holding the row while the current owner saves: the save waits, then applies; the claim is refused.
  async J8(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    const cur = await w.claim(u, A, { attempt: 2 })
    const { r1, r2, secondWaitedOn } = await rowRace(w, 'j8', w.claimSql(u, B, { attempt: 1 }), w.saveSql(u, A, cur.epoch, 1, 33))
    const row = await w.row(u)
    return { facts: { r1, r2, row }, checks: [{ name: 'the refused claim never blocks the owner beyond its transaction nor loses its save', ok: secondWaitedOn === 'row' && r1.status === 'stale_attempt' && resultOf(r2) === 'applied' && row.tx === 33 && row.owner === A.g }] }
  },
  // J9 — the caller's host gate: a drain of the caller's host waits for an in-flight claim (FOR SHARE), as v1/v2.
  async J9(w) {
    const u = await w.user(); const A = await w.host()
    const s1 = await w.hooked('j9-1', 'after_host', 'j9'); const s2 = await w.open('j9-2')
    await w.hold('after_host', 'j9')
    const p1 = s1.send(w.claimSql(u, A, { attempt: 1 }))
    if ((await w.blockedOn(s1.pid, p1)) !== 'advisory') throw new Error('harness: the claim never reached its barrier')
    const p2 = s2.send(w.drainSql(A))
    const drain = await w.blockedOn(s2.pid, p2)
    await w.release('after_host', 'j9')
    const [r1] = [parse(await p1), parse(await p2)]
    return { facts: { drain, r1 }, checks: [{ name: 'the drain of the caller host waits for the claim (no claim lands on a host already draining)', ok: drain === 'row' && r1.status === 'claimed' }] }
  },
  // D — deadlock check across the interleavings that hold the row and queue a second statement.
  async D(w) {
    const before = await w.deadlocks()
    await SCENARIOS.J3(w); await SCENARIOS.J4(w); await SCENARIOS.J7(w); await SCENARIOS.J8(w)
    const after = await w.deadlocks()
    return { facts: { deadlocks: after - before }, checks: [{ name: 'no deadlock', ok: after - before === 0 }] }
  },
}

const report = { container: CONTAINER, database: DB, rounds: ROUNDS, head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), postgres: null, builds: {} }
let unexpected = 0, harness = 0
for (const build of BUILDS) {
  let grants
  try { grants = recreate(build) } catch (error) { blocked(`setup ${build}: ${String(error.message).slice(0, 300)}`) }
  const result = { grants: grants.length ? grants : 'closed (0 rows)', scenarios: {}, harnessErrors: 0 }
  if (build === 'migration' && grants.length) unexpected++
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const rounds = []
    for (let i = 0; i < ROUNDS; i++) {
      const w = await world()
      if (!report.postgres) report.postgres = await w.admin.one('SHOW server_version;')
      try { rounds.push(await withDeadline(scenario(w), 90_000, name)) } catch (error) { result.harnessErrors++; rounds.push({ harnessError: String(error.message).slice(0, 300) }) } finally { await w.close() }
    }
    const failedChecks = [...new Set(rounds.flatMap(r => (r.checks ?? []).filter(c => !c.ok).map(c => c.name)))]
    result.scenarios[name] = { pass: rounds.filter(r => r.checks?.every(c => c.ok)).length, of: ROUNDS, failedChecks, harnessErrors: rounds.filter(r => r.harnessError).map(r => r.harnessError), sample: rounds[0]?.facts ?? null }
  }
  const failing = Object.entries(result.scenarios).filter(([, s]) => s.pass < s.of).map(([n]) => n)
  const expected = MUTANTS[build]?.detects ?? []
  harness += result.harnessErrors
  // A mutant counts as DETECTED only by a failed CHECK in its named scenario(s); harness errors make the build BLOCKED.
  result.verdict = result.harnessErrors ? 'BLOCKED' : build === 'migration' ? (failing.length ? 'FAIL' : 'PASS') : expected.every(n => failing.includes(n)) ? 'DETECTED' : 'SURVIVED'
  if (result.verdict === 'FAIL' || result.verdict === 'SURVIVED') unexpected++
  Object.assign(result, { failing, expected })
  report.builds[build] = result
  console.log(`${build.padEnd(28)} ${result.verdict.padEnd(9)} failing=[${failing.join(',')}] expected=[${expected.join(',')}]${result.harnessErrors ? ` harnessErrors=${result.harnessErrors}` : ''}${build === 'migration' ? ` grants=${grants.length ? 'OPEN' : 'closed'}` : ''}`)
}
const migration = report.builds.migration
console.log(`postgres ${report.postgres} head ${report.head.slice(0, 7)} rounds ${ROUNDS}: ${Object.entries(migration.scenarios).map(([n, s]) => `${n} ${s.pass}/${s.of}`).join(', ')}`)
const out = arg('out')
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
process.exit(harness ? 2 : unexpected ? 1 : 0)
