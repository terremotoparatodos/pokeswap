import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { openLocalDatabase, serviceQuery } from './dev/localDatabase.js'

// CLOUD JOIN-ORDER-2: the join-order migration (20261006120000) on the embedded Postgres with Supabase's
// worst-case default privileges (dev/supabaseStubs.sql). Behaviour only: concurrency and locks are proven
// on real Postgres by scripts/world-location/join-order-concurrency. Sequences are deterministic; the only
// time travel is the table owner moving a lease into the past, as in the recovery tests.

const LEASE = 15_000
const MIGRATIONS = new URL('../../../../../supabase/migrations/', import.meta.url)
const NEW_MIGRATION = new URL('20261006120000_world_location_join_order.sql', MIGRATIONS)
const GRANTS_CHECK = fileURLToPath(new URL('../../../../../scripts/world-location/join-order-grants-check.sql', import.meta.url))
const LOCATION_GRANTS_CHECK = fileURLToPath(new URL('../../../../../scripts/world-location/location-grants-check.sql', import.meta.url))
const ROLLBACK = fileURLToPath(new URL('../../../../../scripts/world-location/rollback_world_location_join_order.sql', import.meta.url))
const RECOVERY_ROLLBACK = fileURLToPath(new URL('../../../../../scripts/world-location/rollback_world_presence_recovery.sql', import.meta.url))
const EARLIER_FUNCTIONS = ['world_presence_acquire', 'world_presence_activate', 'world_presence_renew', 'world_presence_drain', 'world_presence_stop',
  'world_location_claim_keyed', 'world_location_save_keyed', 'world_location_claim', 'world_location_save',
  'world_presence_recovery_version', 'world_presence_owner_state', 'world_location_claim_keyed_v2', 'world_presence_activate_exclusive', 'world_presence_any_active']
const PAGE = 'tab-page-0001'
const OTHER = 'tab-other-001'

let users = 0
let hosts = 0
let sessions = 0
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`
const nextSession = () => uuid('c0000000', ++sessions)

async function setup() {
  const db = await openLocalDatabase()
  const service = serviceQuery(db)
  const fn = async (sql, params) => (await service(sql, params)).rows[0].r
  const t = {
    db,
    async user() { const u = uuid('b0000000', ++users); await db.query('INSERT INTO auth.users VALUES ($1)', [u]); return u },
    async host() { const h = uuid('a0000000', ++hosts); const { generation } = await fn('SELECT public.world_presence_acquire($1::uuid, $2::int) AS r', [h, LEASE]); return { g: generation, h, seq: 0 } },
    activate: x => fn('SELECT public.world_presence_activate($1::bigint, $2::uuid, $3::int) AS r', [x.g, x.h, LEASE]),
    drain: x => fn('SELECT public.world_presence_drain($1::bigint, $2::uuid, 10000) AS r', [x.g, x.h]),
    stop: x => fn('SELECT public.world_presence_stop($1::bigint, $2::uuid) AS r', [x.g, x.h]),
    expire: x => db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [x.g]),
    async active() { const x = await t.host(); assert.equal((await t.activate(x)).status, 'active'); return x },
    v3: (user, x, { page = PAGE, attempt, takeover = false, recovery = false, seq = ++x.seq, session = nextSession() }) =>
      fn('SELECT public.world_location_claim_keyed_v3($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid, $6::boolean, $7::boolean, $8::text, $9::bigint) AS r',
        [user, x.g, seq, session, x.h, takeover, recovery, page, attempt]),
    v2: (user, x, { takeover = false, seq = ++x.seq, session = nextSession() } = {}) =>
      fn('SELECT public.world_location_claim_keyed_v2($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid, $6::boolean) AS r', [user, x.g, seq, session, x.h, takeover]),
    v1: (user, x, { seq = ++x.seq, session = nextSession() } = {}) =>
      fn('SELECT public.world_location_claim_keyed($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid) AS r', [user, x.g, seq, session, x.h]),
    save: (user, x, epoch, seq, tx) => fn('SELECT public.world_location_save_keyed($1::jsonb, $2::bigint, $3::uuid) AS r',
      [JSON.stringify([{ userId: user, epoch, seq, areaId: 'pradera', tx, ty: -60, layoutVersion: 'p.abc123' }]), x.g, x.h]),
    row: async user => (await db.query(`SELECT epoch::int, owner_generation::int AS g, owner_seq::int AS s, owner_page AS page, owner_attempt::int AS attempt,
      owner_page_session = owner_session AS "pageValid", tx FROM public.world_player_locations WHERE user_id = $1`, [user])).rows[0] ?? null,
  }
  return t
}
const statusOf = answer => answer.status
const resultOf = answer => answer.results?.[0]?.result ?? answer.status

test('capability marker: world_location_join_order_version() = 1', async () => {
  const t = await setup()
  assert.equal((await serviceQuery(t.db)('SELECT public.world_location_join_order_version() AS v', [])).rows[0].v, 1)
  await t.db.close()
})

test('the first claim records the page and attempt with its session; a retry of the SAME claim adopts (idempotent, nothing written)', async () => {
  const t = await setup()
  const u = await t.user(); const a = await t.active()
  const session = nextSession()
  const first = await t.v3(u, a, { attempt: 3, seq: 1, session })
  assert.equal(first.status, 'claimed')
  assert.deepEqual(await t.row(u), { epoch: 1, g: a.g, s: 1, page: PAGE, attempt: 3, pageValid: true, tx: null })
  const again = await t.v3(u, a, { attempt: 3, seq: 1, session })
  assert.deepEqual([again.status, again.epoch], ['claimed', first.epoch], 'adoption: same epoch')
  await assert.rejects(t.v3(u, a, { attempt: 3, seq: 1, session: nextSession() }), /key_reused/)
  await t.db.close()
})

test('3 — an OLDER attempt of the same page never takes the row, even with a greater key (a newer host): stale_attempt, nothing written', async () => {
  const t = await setup()
  const u = await t.user()
  const a = await t.active(); const b = await t.active()          // b is newer: its keys are greater
  const current = await t.v3(u, a, { attempt: 2 })
  assert.equal((await t.save(u, a, current.epoch, 1, 31)).results[0].result, 'applied')
  const before = await t.row(u)
  for (const recovery of [false, true]) {
    const old = await t.v3(u, b, { attempt: 1, recovery })
    assert.deepEqual(old, { status: 'stale_attempt', newerActive: false }, `recovery=${recovery}`)
  }
  assert.deepEqual(await t.row(u), before, 'nothing written')
  // 4: the current session keeps saving under its own epoch.
  assert.equal(resultOf(await t.save(u, a, current.epoch, 2, 32)), 'applied')
  await t.db.close()
})

test('8 — a repeated attempt (same page and number, another key) is duplicate_attempt; retrying the refused claim stays refused (idempotent)', async () => {
  const t = await setup()
  const u = await t.user()
  const a = await t.active(); const b = await t.active()
  await t.v3(u, a, { attempt: 5 })
  const session = nextSession()
  assert.equal(statusOf(await t.v3(u, b, { attempt: 5, seq: 1, session })), 'duplicate_attempt')
  assert.equal(statusOf(await t.v3(u, b, { attempt: 5, seq: 1, session })), 'duplicate_attempt', 'the same claim retried')
  assert.equal(statusOf(await t.v3(u, b, { attempt: 4, seq: 2 })), 'stale_attempt')
  assert.equal((await t.row(u)).g, a.g)
  await t.db.close()
})

test('the counter authorizes no takeover: a NEWER attempt of the same page gets exactly what v1/v2 would answer', async () => {
  const t = await setup()
  // The page's older attempt owns the row from the NEWER host (it claimed first); the newer attempt comes from the older host.
  const a = await t.active(); const b = await t.active()
  const u1 = await t.user()
  await t.v3(u1, b, { attempt: 1 })
  assert.deepEqual(await t.v3(u1, a, { attempt: 2 }), { status: 'superseded', newerActive: true }, 'v1 rules: a live greater key keeps the row')
  assert.deepEqual(await t.v3(u1, a, { attempt: 3, recovery: true }), { status: 'superseded', newerActive: true }, 'v2 rules: a live owner keeps the row')
  assert.equal((await t.row(u1)).attempt, 1)
  // With the recovery rules, the owner's state decides, as v2: draining waits, unreachable needs «Jugar acá», stopped is taken.
  const older = await t.active(); const newer = await t.active()
  const u3 = await t.user()
  await t.v3(u3, newer, { attempt: 1 }); await t.drain(newer)
  assert.equal(statusOf(await t.v3(u3, older, { attempt: 2, recovery: true })), 'owner_draining')
  await t.stop(newer)
  assert.equal(statusOf(await t.v3(u3, older, { attempt: 3, recovery: true })), 'claimed', 'a stopped owner is taken (v2)')
  const older4 = await t.active(); const newer4 = await t.active()
  const u4 = await t.user()
  await t.v3(u4, newer4, { attempt: 1 }); await t.expire(newer4)
  assert.equal(statusOf(await t.v3(u4, older4, { attempt: 2, recovery: true })), 'owner_unreachable', 'never by attempt alone')
  assert.equal(statusOf(await t.v3(u4, older4, { attempt: 3, recovery: true, takeover: true })), 'claimed', 'only the explicit takeover')
  await t.db.close()
})

test('6 — attempts are compared only within the same account and page', async () => {
  const t = await setup()
  const a = await t.active(); const b = await t.active()
  const u = await t.user(); const v = await t.user()
  await t.v3(u, a, { attempt: 9 })
  assert.equal(statusOf(await t.v3(u, b, { page: OTHER, attempt: 1 })), 'claimed', 'another page of the same account: the key order (as v1)')
  await t.v3(v, a, { attempt: 9 })
  assert.equal(statusOf(await t.v3(v, b, { attempt: 1, page: OTHER })), 'claimed')
  const w = await t.user()
  await t.v3(w, a, { attempt: 9 })
  // Another account's row never orders this one's.
  assert.equal(statusOf(await t.v3(await t.user(), b, { attempt: 1 })), 'claimed')
  await t.db.close()
})

test('mixed fleet: a v1 or v2 claim invalidates the page info (it never writes it); the page is then ordered by keys only', async () => {
  const t = await setup()
  for (const legacy of ['v1', 'v2']) {
    const a = await t.active(); const b = await t.active(); const c = await t.active()
    const u = await t.user()
    await t.v3(u, a, { attempt: 5 })
    assert.equal(statusOf(await t[legacy](u, b)), 'claimed', `${legacy} takes by key`)
    const row = await t.row(u)
    assert.deepEqual([row.page, row.attempt, row.pageValid], [PAGE, 5, false], 'still there, but bound to a session that no longer owns the row')
    assert.equal(statusOf(await t.v3(u, c, { attempt: 1 })), 'claimed', 'no stale_attempt from invalid page info (documented partial guarantee)')
    assert.equal((await t.row(u)).pageValid, true)
  }
  await t.db.close()
})

test('differential: without a same-page refusal, v3 answers and writes exactly what v1 (recovery=false) or v2 (recovery=true) does', async () => {
  const t = await setup()
  const states = ['active', 'draining', 'unreachable', 'stopped', 'unknown']
  const cases = []
  for (const state of states) for (const keys of ['greater', 'smaller']) for (const takeover of [false, true]) for (const recovery of [false, true]) {
    if (takeover && !recovery) continue
    cases.push({ state, keys, takeover, recovery })
  }
  for (const c of cases) {
    // Same shape twice: the reference user through v1/v2, the other through v3 (another page owns its row).
    const first = await t.active(); const second = await t.active()
    const [owner, caller] = c.keys === 'greater' ? [first, second] : [second, first]
    const ref = await t.user(); const sub = await t.user()
    await t.v2(ref, owner); await t.v3(sub, owner, { page: OTHER, attempt: 7 })
    if (c.state === 'draining') await t.drain(owner)
    if (c.state === 'unreachable') await t.expire(owner)
    if (c.state === 'stopped') { await t.drain(owner); await t.stop(owner) }
    if (c.state === 'unknown') await t.db.query('UPDATE public.world_player_locations SET owner_generation = 999999 WHERE user_id = ANY($1)', [[ref, sub]])
    const expected = c.recovery ? await t.v2(ref, caller, { takeover: c.takeover }) : await t.v1(ref, caller)
    const actual = await t.v3(sub, caller, { attempt: 1, takeover: c.takeover, recovery: c.recovery })
    const label = JSON.stringify(c)
    assert.equal(actual.status, expected.status, label)
    assert.equal(actual.newerActive, expected.newerActive, label)
    const [r, s] = [await t.row(ref), await t.row(sub)]
    // Each host numbers its own claims (the reference went first), so the owner is compared by generation.
    assert.deepEqual([s.g, s.epoch], [r.g, r.epoch], `${label}: same owner and epoch`)
  }
  assert.equal(cases.length, 30)
  await t.db.close()
})

test('the caller\'s host gate, unknown user and invalid input: defined answers or errors, never a write', async () => {
  const t = await setup()
  const u = await t.user()
  const starting = await t.host()
  assert.deepEqual(await t.v3(u, starting, { attempt: 1 }), { status: 'host_inactive', state: 'starting' })
  assert.deepEqual(await t.v3(u, { g: 99999, h: starting.h, seq: 0 }, { attempt: 1 }), { status: 'unknown_host' })
  const a = await t.active()
  await t.expire(a)
  assert.deepEqual(await t.v3(u, a, { attempt: 1 }), { status: 'host_expired' })
  const b = await t.active()
  assert.deepEqual(await t.v3(uuid('dddddddd', 1), b, { attempt: 1 }), { status: 'unknown_user' })
  // 9: invalid or inconsistent input raises before anything is read or written.
  for (const [page, attempt] of [[PAGE, null], [null, 3], [PAGE, 0], [PAGE, -1], [PAGE, 2 ** 31], ['<b>', 1], ['short', 1], ['x'.repeat(65), 1]]) {
    await assert.rejects(t.v3(u, b, { page, attempt }), /invalid_attempt/, JSON.stringify([page, attempt]))
  }
  await assert.rejects(t.v3(u, b, { attempt: 1, takeover: true, recovery: false }), /invalid_claim/, 'a takeover exists only with the recovery rules')
  await assert.rejects(serviceQuery(t.db)('SELECT public.world_location_claim_keyed_v3($1::uuid, $2::bigint, 1, $3::uuid, $4::uuid, false, NULL, $5, 1) AS r', [u, b.g, nextSession(), b.h, PAGE]), /invalid_claim/)
  assert.equal(await t.row(u), null)
  await t.db.close()
})

test('the table keeps the three columns together (shape constraint), whoever writes', async () => {
  const t = await setup()
  const u = await t.user(); const a = await t.active()
  await t.v3(u, a, { attempt: 1 })
  await assert.rejects(t.db.query('UPDATE public.world_player_locations SET owner_attempt = NULL WHERE user_id = $1', [u]), /owner_page_shape/)
  await assert.rejects(t.db.query('UPDATE public.world_player_locations SET owner_page_session = NULL WHERE user_id = $1', [u]), /owner_page_shape/)
  await t.db.close()
})

test('privileges: the join-order functions are closed to clients (catalog check = 0 rows, not vacuous); the table check stays at 0 rows', async () => {
  const t = await setup()
  assert.deepEqual((await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows, [])
  assert.deepEqual((await t.db.query(await readFile(LOCATION_GRANTS_CHECK, 'utf8'))).rows, [], 'the new columns add no client access')
  await t.db.exec('GRANT EXECUTE ON FUNCTION public.world_location_join_order_version() TO anon; GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed_v3(uuid, bigint, bigint, uuid, uuid, boolean, boolean, text, bigint) TO PUBLIC')
  const kinds = (await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows.map(r => `${r.kind}:${r.object}:${r.grantee}`).sort()
  assert.deepEqual(kinds, [
    'execute:world_location_claim_keyed_v3(uuid,bigint,bigint,uuid,uuid,boolean,boolean,text,bigint):anon',
    'execute:world_location_claim_keyed_v3(uuid,bigint,bigint,uuid,uuid,boolean,boolean,text,bigint):authenticated',
    'execute:world_location_join_order_version():anon',
    'public_execute:world_location_claim_keyed_v3(uuid,bigint,bigint,uuid,uuid,boolean,boolean,text,bigint):PUBLIC',
  ])
  await t.db.close()
})

test('every earlier function keeps its exact definition and privileges (golden against a database without the migration)', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const before = new PGlite()
  await before.exec(await readFile(fileURLToPath(new URL('./dev/supabaseStubs.sql', import.meta.url)), 'utf8'))
  for (const name of ['20260926002154_world_skills_authority.sql', '20260926002207_world_skills_gate.sql', '20261001051958_world_multi_yield.sql',
    '20261001220000_world_player_locations.sql', '20261003120000_world_location_ordering.sql', '20261005120000_world_presence_recovery.sql']) await before.exec(await readFile(fileURLToPath(new URL(name, MIGRATIONS)), 'utf8'))
  const after = (await setup()).db
  const snapshot = async db => (await db.query(`SELECT p.proname, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY($1) ORDER BY p.proname, p.oid::regprocedure::text`, [EARLIER_FUNCTIONS])).rows
  const [a, b] = [await snapshot(before), await snapshot(after)]
  assert.equal(a.length, EARLIER_FUNCTIONS.length)
  assert.deepEqual(b, a)
  const policies = async db => (await db.query("SELECT polname FROM pg_policy WHERE polrelid = 'public.world_player_locations'::regclass")).rows
  assert.deepEqual(await policies(after), await policies(before))
  const text = await readFile(NEW_MIGRATION, 'utf8')
  for (const name of EARLIER_FUNCTIONS) assert.doesNotMatch(text, new RegExp(`FUNCTION public\\.${name}\\(`), `${name} is not redefined`)
  await before.close(); await after.close()
})

test('rollback: refuses the recovery rollback first; drops exactly the join order; v1/v2 keep working; the migration re-applies (twice: idempotent)', async () => {
  const t = await setup()
  const a = await t.active()
  const u = await t.user()
  await t.v3(u, a, { attempt: 1 })
  await assert.rejects(t.db.exec(await readFile(RECOVERY_ROLLBACK, 'utf8')), /run rollback_world_location_join_order\.sql first/)
  await t.db.exec('ROLLBACK')
  assert.equal((await t.db.query("SELECT count(*)::int AS n FROM pg_proc WHERE proname = 'world_presence_owner_state'")).rows[0].n, 1, 'nothing changed')
  await t.db.exec(await readFile(ROLLBACK, 'utf8'))
  const left = (await t.db.query("SELECT proname FROM pg_proc WHERE proname IN ('world_location_claim_keyed_v3', 'world_location_join_order_version')")).rows
  assert.deepEqual(left, [])
  const columns = (await t.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'world_player_locations' AND column_name LIKE 'owner_page%' OR column_name = 'owner_attempt'")).rows
  assert.deepEqual(columns, [])
  assert.equal(statusOf(await t.v2(await t.user(), a)), 'claimed', 'v2 untouched')
  assert.equal(statusOf(await t.v1(await t.user(), a)), 'claimed', 'v1 untouched')
  assert.equal((await t.row(u).catch(() => 'no columns')), 'no columns', 'the page columns are gone')
  await t.db.exec(await readFile(NEW_MIGRATION, 'utf8'))
  await t.db.exec(await readFile(NEW_MIGRATION, 'utf8'))
  assert.equal(statusOf(await t.v3(await t.user(), a, { attempt: 1 })), 'claimed')
  assert.deepEqual((await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows, [])
  await t.db.close()
})
