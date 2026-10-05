// CLOUD JOIN-ORDER-1 — the prototype claim v3 under concurrency, on REAL local Postgres (never PGlite).
//   node docs/design/cloud-join-order-1/prototype/pg/run.mjs --container supabase_db_<local> [--rounds 5] [--out report.json]
// Dedicated database `cr4_joinorder` (recreated per build; the stack's `postgres` database is never touched):
// Supabase's default privileges, a minimal auth.users, the migrations of this checkout read with `git show HEAD:`
// (20261001220000, 20261003120000, 20261005120000), then prototype/claim_v3.sql with barrier hooks injected at its
// `-- @hook` lines and, for a mutant, ONE exact replacement. Order is forced with advisory-lock barriers observed
// in pg_stat_activity. Exit: 0 expected outcome everywhere; 1 unexpected; 2 BLOCKED (never a pass or a detection).
import { execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import process from 'node:process'
import { PgSession, sleep, withDeadline } from '../../../../../scripts/world-location/recovery-concurrency/pgSession.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..', '..', '..', '..')
const DB = 'cr4_joinorder'
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const CONTAINER = arg('container')
const ROUNDS = Number(arg('rounds', 5))
const blocked = message => { console.log(`BLOCKED: ${message}`); process.exit(2) }
if (!CONTAINER || !/^supabase_db_[A-Za-z0-9_-]+$/.test(CONTAINER)) blocked('--container must name a local Supabase db container')
try { if (execFileSync('docker', ['inspect', '-f', '{{.State.Running}}', CONTAINER], { encoding: 'utf8' }).trim() !== 'true') blocked('not running') } catch { blocked('container not found') }

const blob = file => execFileSync('git', ['-C', ROOT, 'show', `HEAD:supabase/migrations/${file}`], { encoding: 'utf8' })
const MIGRATIONS = ['20261001220000_world_player_locations.sql', '20261003120000_world_location_ordering.sql', '20261005120000_world_presence_recovery.sql']
const V3 = readFileSync(join(HERE, '..', 'claim_v3.sql'), 'utf8').split('\r\n').join('\n')
const HOOK_FN = `CREATE OR REPLACE FUNCTION public.cr4_hook(p_name text) RETURNS void LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF position(',' || p_name || ',' IN ',' || coalesce(current_setting('cr4.hooks', true), '') || ',') > 0 THEN
    PERFORM pg_advisory_xact_lock(hashtext('cr4:' || p_name || ':' || coalesce(current_setting('cr4.tag', true), '')));
  END IF;
END $$;
GRANT EXECUTE ON FUNCTION public.cr4_hook(text) TO service_role;`
const BUILDS = {
  prototype: null,
  'no-same-page': ['      IF v_same THEN /*PROTO:same-page*/', '      IF false THEN'],
  'no-page-session': ['      v_same := p_page IS NOT NULL AND v_row.owner_page_session IS NOT DISTINCT FROM v_row.owner_session /*PROTO:page-session*/', '      v_same := p_page IS NOT NULL'],
  'duplicate-takes': ["        ELSIF p_attempt = v_row.owner_attempt THEN v_answer := 'duplicate_attempt'; /*PROTO:duplicate*/", '        ELSIF false THEN NULL;'],
  'draining-ignored': ["        ELSIF public.world_presence_owner_state(v_row.owner_generation) = 'draining' THEN v_answer := 'owner_draining';", '        ELSIF false THEN NULL;'],
}
const DETECTS = { 'no-same-page': ['P2'], 'no-page-session': ['P5'], 'duplicate-takes': ['P4'], 'draining-ignored': ['P6'] }
function v3For(build) {
  let text = V3
  const m = BUILDS[build]
  if (m) { const n = text.split(m[0]).length - 1; if (n !== 1) blocked(`mutant ${build}: ${n} matches`); text = text.replace(m[0], () => m[1]) }
  return text.replace(/^(\s*)-- @hook ([a-z_]+)$/gm, (_m, indent, name) => `${indent}PERFORM public.cr4_hook('${name}');`)
}
const psql = (database, sql) => execFileSync('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', database, '-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], { input: sql, encoding: 'utf8' })
function recreate(build) {
  psql('postgres', `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${DB}' AND pid <> pg_backend_pid();`)
  psql('postgres', `DROP DATABASE IF EXISTS ${DB};`)
  psql('postgres', `CREATE DATABASE ${DB};`)
  psql(DB, `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON FUNCTIONS TO anon, authenticated, service_role;
    CREATE SCHEMA IF NOT EXISTS auth; CREATE TABLE auth.users (id uuid PRIMARY KEY);`)
  psql(DB, HOOK_FN)
  for (const file of MIGRATIONS) psql(DB, blob(file))
  psql(DB, v3For(build))
}

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
    async host() { const h = randomUUID(); const r = await svc.json(`SELECT public.world_presence_acquire(${q(h)}::uuid, 15000);`); const x = { g: Number(r.generation), h, seq: 0 }; await svc.json(`SELECT public.world_presence_activate(${x.g}, ${q(x.h)}::uuid, 15000);`); return x },
    claimSql: (u, x, page, attempt, seq = ++x.seq, session = randomUUID()) => `SELECT public.world_location_claim_keyed_v3(${q(u)}::uuid, ${x.g}, ${seq}, ${q(session)}::uuid, ${q(x.h)}::uuid, false, ${page === null ? 'NULL' : q(page)}, ${attempt === null ? 'NULL' : attempt});`,
    claim: (u, x, page, attempt, s = svc) => s.json(w.claimSql(u, x, page, attempt)),
    claimV1: (u, x) => svc.json(`SELECT public.world_location_claim_keyed(${q(u)}::uuid, ${x.g}, ${++x.seq}, ${q(randomUUID())}::uuid, ${q(x.h)}::uuid);`),
    save: (u, x, epoch, seq, tx) => svc.json(`SELECT public.world_location_save_keyed(${q(JSON.stringify([{ userId: u, epoch, seq, areaId: 'ciudad-corazon', tx, ty: 20, layoutVersion: '1.test' }]))}::jsonb, ${x.g}, ${q(x.h)}::uuid);`),
    drain: x => svc.json(`SELECT public.world_presence_drain(${x.g}, ${q(x.h)}::uuid, 10000);`),
    row: u => admin.json(`SELECT row_to_json(r) FROM (SELECT tx, epoch::int AS epoch, owner_generation::int AS owner, owner_attempt::int AS attempt, owner_page AS page FROM public.world_player_locations WHERE user_id = ${q(u)}::uuid) r;`),
    deadlocks: async () => Number(await admin.one(`SELECT deadlocks FROM pg_stat_database WHERE datname = '${DB}';`)),
    hold: (hook, tag) => admin.one(`SELECT pg_advisory_lock(hashtext('cr4:${hook}:${tag}'));`),
    release: (hook, tag) => admin.one(`SELECT pg_advisory_unlock(hashtext('cr4:${hook}:${tag}'));`),
    async hooked(name, hooks, tag) { const s = await open(name); await s.one(`SET cr4.hooks = ${q(hooks)};`); await s.one(`SET cr4.tag = ${q(tag)};`); return s },
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
    async close() { for (const s of sessions) await s.close() },
  }
  return w
}
const parse = r => (r?.ok && r.rows[0] ? JSON.parse(r.rows[0]) : { error: r?.errors?.join(' | ') ?? 'no answer' })
const P = 'tab-page-0001'
const resultOf = a => a?.results?.[0]?.result ?? a?.status

const SCENARIOS = {
  // P1 — the old attempt claimed first on the NEWER host; the newer attempt (smaller key) takes it; the old save is stale.
  async P1(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    const old = await w.claim(u, B, P, 1)
    const cur = await w.claim(u, A, P, 2)
    const late = await w.save(u, B, old.epoch, 1, 99)
    const row = await w.row(u)
    return { facts: { old, cur, late, row }, checks: [{ name: 'the newer attempt takes the row whatever the keys; the old session cannot save', ok: cur.status === 'claimed' && row.owner === A.g && row.attempt === 2 && resultOf(late) === 'stale' }] }
  },
  // P2 — the newer attempt first; the old attempt (on a NEWER host, greater key) is stale_attempt and writes nothing.
  async P2(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    const cur = await w.claim(u, A, P, 2)
    const old = await w.claim(u, B, P, 1)
    const row = await w.row(u)
    return { facts: { cur, old, row }, checks: [{ name: 'an older attempt never takes the row, even with a greater key', ok: old.status === 'stale_attempt' && row.owner === A.g && row.epoch === cur.epoch }] }
  },
  // P3 — concurrent: one attempt holds the row (paused), the other waits on the row lock; both orders end with the newer attempt.
  async P3(w) {
    const out = {}
    for (const first of ['old', 'new']) {
      const u = await w.user(); const A = await w.host(); const B = await w.host()
      const tag = `p3-${first}`
      const s1 = await w.hooked(`${tag}-1`, 'after_row', tag)
      await w.claim(u, A, 'tab-seed-0001', 1)                 // a row exists (another page owns it, smaller key)
      await w.hold('after_row', tag)
      const firstSql = first === 'old' ? w.claimSql(u, B, P, 1) : w.claimSql(u, A, P, 2)
      const secondSql = first === 'old' ? w.claimSql(u, A, P, 2) : w.claimSql(u, B, P, 1)
      const p1 = s1.send(firstSql); await w.waiting(s1.pid, 'advisory')
      const s2 = await w.open(`${tag}-2`); const p2 = s2.send(secondSql); await w.waiting(s2.pid, 'row')
      await w.release('after_row', tag)
      const [r1, r2] = [parse(await p1), parse(await p2)]
      out[first] = { r1, r2, row: await w.row(u) }
    }
    const ok = out.old.row.attempt === 2 && out.new.row.attempt === 2 && out.new.r2.status === 'stale_attempt'
    return { facts: out, checks: [{ name: 'serialized on the row: the newer attempt owns it in both orders; an old one arriving second is stale', ok }] }
  },
  // P4 — a duplicate (same page, same attempt) from two hosts at once: exactly one claims.
  async P4(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    await w.claim(u, A, 'tab-seed-0001', 1)
    const s1 = await w.hooked('p4-1', 'after_row', 'p4'); await w.hold('after_row', 'p4')
    const p1 = s1.send(w.claimSql(u, A, P, 3)); await w.waiting(s1.pid, 'advisory')
    const s2 = await w.open('p4-2'); const p2 = s2.send(w.claimSql(u, B, P, 3)); await w.waiting(s2.pid, 'row')
    await w.release('after_row', 'p4')
    const [r1, r2] = [parse(await p1), parse(await p2)]
    return { facts: { r1, r2 }, checks: [{ name: 'a duplicate attempt claims once; the copy is duplicate_attempt', ok: r1.status === 'claimed' && r2.status === 'duplicate_attempt' }] }
  },
  // P5 — mixed fleet: a legacy keyed claim (no page info) takes the row; the page's info is then invalid: a newer
  // attempt of the page on an older host must NOT take a live legacy owner by page order (it falls back to keys).
  async P5(w) {
    const u = await w.user(); const A = await w.host(); const C = await w.host()
    await w.claim(u, A, P, 2)
    const legacy = await w.claimV1(u, C)                       // another realtime version, another page, newer host
    const next = await w.claim(u, A, P, 3)
    const row = await w.row(u)
    return { facts: { legacy, next, row }, checks: [{ name: 'stale page info never authorizes a takeover from a live legacy owner', ok: legacy.status === 'claimed' && next.status === 'superseded' && row.owner === C.g }] }
  },
  // P6 — the page's newer attempt waits for an older attempt's host that is draining (its final flush is kept).
  async P6(w) {
    const u = await w.user(); const A = await w.host(); const B = await w.host()
    const old = await w.claim(u, B, P, 1)
    await w.drain(B)
    const during = await w.claim(u, A, P, 2)
    const flush = await w.save(u, B, old.epoch, 1, 41)
    return { facts: { during, flush }, checks: [{ name: 'a draining owner keeps its final flush (owner_draining, then the flush applies)', ok: during.status === 'owner_draining' && resultOf(flush) === 'applied' }] }
  },
  // D — deadlock check across the scenarios' interleavings (P3/P4 hold the row and queue a second claim).
  async D(w) {
    const before = await w.deadlocks()
    await SCENARIOS.P3(w); await SCENARIOS.P4(w)
    const after = await w.deadlocks()
    return { facts: { deadlocks: after - before }, checks: [{ name: 'no deadlock', ok: after - before === 0 }] }
  },
}

const report = { container: CONTAINER, database: DB, rounds: ROUNDS, head: execFileSync('git', ['-C', ROOT, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(), postgres: null, builds: {} }
let unexpected = 0, harness = 0
for (const build of Object.keys(BUILDS)) {
  try { recreate(build) } catch (error) { blocked(`setup ${build}: ${String(error.message).slice(0, 300)}`) }
  const result = { scenarios: {}, harnessErrors: 0 }
  for (const [name, scenario] of Object.entries(SCENARIOS)) {
    const rounds = []
    for (let i = 0; i < ROUNDS; i++) {
      const w = await world()
      if (!report.postgres) report.postgres = await w.admin.one('SHOW server_version;')
      try { rounds.push(await withDeadline(scenario(w), 60_000, name)) } catch (error) { result.harnessErrors++; rounds.push({ harnessError: String(error.message).slice(0, 300) }) } finally { await w.close() }
    }
    result.scenarios[name] = { pass: rounds.filter(r => r.checks?.every(c => c.ok)).length, of: ROUNDS, harnessErrors: rounds.filter(r => r.harnessError).map(r => r.harnessError), sample: rounds[0]?.facts ?? null }
  }
  const failing = Object.entries(result.scenarios).filter(([, s]) => s.pass < s.of).map(([n]) => n)
  const expected = build === 'prototype' ? [] : DETECTS[build]
  harness += result.harnessErrors
  result.verdict = result.harnessErrors ? 'BLOCKED' : build === 'prototype' ? (failing.length ? 'FAIL' : 'PASS') : expected.every(n => failing.includes(n)) ? 'DETECTED' : 'SURVIVED'
  if (result.verdict === 'FAIL' || result.verdict === 'SURVIVED') unexpected++
  Object.assign(result, { failing, expected })
  report.builds[build] = result
  console.log(`${build.padEnd(18)} ${result.verdict.padEnd(9)} failing=[${failing.join(',')}] expected=[${expected.join(',')}]${result.harnessErrors ? ` harnessErrors=${result.harnessErrors}` : ''}`)
}
const out = arg('out')
if (out) writeFileSync(out, JSON.stringify(report, null, 2) + '\n')
process.exit(harness ? 2 : unexpected ? 1 : 0)
