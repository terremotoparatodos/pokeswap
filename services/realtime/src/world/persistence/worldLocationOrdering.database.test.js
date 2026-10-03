import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { asRole, openLocalDatabase, serviceQuery } from './dev/localDatabase.js'

// WORLD LOCATION-4: the ordering migration (20261003120000) on an embedded Postgres that starts
// with Supabase's worst-case default privileges, sequences included (dev/supabaseStubs.sql).
// Design matrix (WORLD_LOCATION_4_DESIGN §7.6): Q1 keyed claims, Q2 v1 compatibility, Q3 state ×
// operation, Q4 lifecycle, Q7 privileges; plus the rollback script.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const GHOST = '99999999-9999-4999-8999-999999999999' // not an auth user
const H1 = 'a0000000-0000-4000-8000-000000000001'
const H2 = 'a0000000-0000-4000-8000-000000000002'
const H3 = 'a0000000-0000-4000-8000-000000000003'
const S1 = 'c0000000-0000-4000-8000-000000000001'
const S2 = 'c0000000-0000-4000-8000-000000000002'
const S3 = 'c0000000-0000-4000-8000-000000000003'
const LEASE = 15_000
const ROLLBACK = fileURLToPath(new URL('../../../../../scripts/world-location/rollback_world_location_ordering.sql', import.meta.url))
const GRANTS_CHECK = fileURLToPath(new URL('../../../../../scripts/world-location/ordering-grants-check.sql', import.meta.url))

async function setup() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${A}'), ('${B}')`)
  const service = serviceQuery(db)
  const fn = async (sql, params) => (await service(sql, params)).rows[0].r
  const api = {
    db, service,
    acquire: (host, lease = LEASE) => fn('SELECT public.world_presence_acquire($1::uuid, $2::int) AS r', [host, lease]),
    activate: (gen, host, lease = LEASE) => fn('SELECT public.world_presence_activate($1::bigint, $2::uuid, $3::int) AS r', [gen, host, lease]),
    renew: (gen, host, lease = LEASE) => fn('SELECT public.world_presence_renew($1::bigint, $2::uuid, $3::int) AS r', [gen, host, lease]),
    drain: (gen, host, ms = 10_000) => fn('SELECT public.world_presence_drain($1::bigint, $2::uuid, $3::int) AS r', [gen, host, ms]),
    stop: (gen, host) => fn('SELECT public.world_presence_stop($1::bigint, $2::uuid) AS r', [gen, host]),
    claim: (user, gen, seq, session, host) => fn('SELECT public.world_location_claim_keyed($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid) AS r', [user, gen, seq, session, host]),
    save: (rows, gen, host) => fn('SELECT public.world_location_save_keyed($1::jsonb, $2::bigint, $3::uuid) AS r', [JSON.stringify(rows), gen, host]),
    claimV1: (user, expected) => fn('SELECT public.world_location_claim($1::uuid, $2::bigint) AS r', [user, expected]),
    saveV1: rows => fn('SELECT public.world_location_save($1::jsonb) AS r', [JSON.stringify(rows)]),
    host: async gen => (await db.query('SELECT state, lease_expires_at FROM public.world_presence_hosts WHERE generation = $1', [gen])).rows[0] ?? null,
    stored: async user => (await db.query('SELECT area_id, tx, ty, epoch::int, seq::int, owner_generation::int AS og, owner_seq::int AS os, owner_session AS session FROM public.world_player_locations WHERE user_id = $1', [user])).rows[0] ?? null,
    // Test-only: the database's clock moves past a host's lease (as the table owner, never a client role).
    expire: gen => db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [gen]),
    /** A host already active: acquire + activate. */
    async active(host) { const { generation } = await api.acquire(host); assert.equal((await api.activate(generation, host)).status, 'active'); return generation },
  }
  return api
}

const row = (userId, epoch, seq, extra = {}) => ({ userId, epoch, seq, areaId: 'pradera', tx: 3, ty: -60, layoutVersion: 'p.abc123', ...extra })
const results = answer => Object.fromEntries(answer.results.map(r => [r.userId, r.result]))

// ── Q4: lifecycle ────────────────────────────────────────────────────────────

test('acquire: a new host starts in starting; a retry returns the same generation and state and touches nothing', async () => {
  const t = await setup()
  const first = await t.acquire(H1)
  assert.equal(first.state, 'starting')
  assert.ok(Number.isSafeInteger(first.generation) && first.generation >= 1)
  const lease = (await t.host(first.generation)).lease_expires_at
  const again = await t.acquire(H1, 120_000)
  assert.deepEqual(again, first, 'a lost answer retried: same generation, same state')
  assert.equal((await t.host(first.generation)).lease_expires_at.getTime(), lease.getTime(), 'acquire never modifies an existing row')
  await t.activate(first.generation, H1)
  assert.deepEqual(await t.acquire(H1), { generation: first.generation, state: 'active' }, 'nor its state')
  const second = await t.acquire(H2)
  assert.ok(second.generation > first.generation, 'generations only grow')
  await t.db.close()
})

test('activate: only from starting, with a live lease, never over a newer active host; a retry is idempotent', async () => {
  const t = await setup()
  const { generation: g1 } = await t.acquire(H1)
  assert.deepEqual(await t.activate(g1, H2), { status: 'unknown_host' }, 'exact identity: generation AND host id')
  assert.deepEqual(await t.activate(g1 + 99, H1), { status: 'unknown_host' })
  assert.deepEqual(await t.activate(g1, H1), { status: 'active' })
  assert.deepEqual(await t.activate(g1, H1), { status: 'active' }, 'a retry after a lost answer')
  assert.equal((await t.host(g1)).state, 'active')

  // A slow candidate whose starting lease ran out can never activate.
  const { generation: g2 } = await t.acquire(H2)
  await t.expire(g2)
  assert.deepEqual(await t.activate(g2, H2), { status: 'host_expired', state: 'starting' })
  assert.equal((await t.host(g2)).state, 'starting')

  // Two candidates: the newer activates first, the older one is refused.
  const { generation: g3 } = await t.acquire(H3)
  const { generation: g4 } = await t.acquire('a0000000-0000-4000-8000-000000000004')
  assert.deepEqual(await t.activate(g4, 'a0000000-0000-4000-8000-000000000004'), { status: 'active' })
  assert.deepEqual(await t.activate(g3, H3), { status: 'newer_active' })
  assert.equal((await t.host(g3)).state, 'starting')
  // The older active host (g1) was NOT changed by g4's activation: it learns on its own renew.
  assert.equal((await t.host(g1)).state, 'active')
  assert.equal((await t.renew(g1, H1)).newerActive, true)
  await t.db.close()
})

test('draining never returns to active; stopped is terminal; acquire of a stopped host stays stopped', async () => {
  const t = await setup()
  const g = await t.active(H1)
  assert.deepEqual(await t.drain(g, H1), { status: 'ok', state: 'draining' })
  assert.deepEqual(await t.drain(g, H1), { status: 'ok', state: 'draining' }, 'idempotent')
  assert.deepEqual(await t.activate(g, H1), { status: 'host_inactive', state: 'draining' })
  assert.equal((await t.renew(g, H1)).state, 'draining')
  assert.equal((await t.host(g)).state, 'draining')
  assert.deepEqual(await t.stop(g, H1), { status: 'ok', state: 'stopped' })
  assert.deepEqual(await t.stop(g, H1), { status: 'ok', state: 'stopped' }, 'idempotent')
  assert.deepEqual(await t.activate(g, H1), { status: 'host_inactive', state: 'stopped' })
  assert.deepEqual(await t.renew(g, H1), { status: 'host_inactive', state: 'stopped' })
  assert.deepEqual(await t.drain(g, H1), { status: 'host_inactive', state: 'stopped' })
  assert.equal((await t.acquire(H1)).state, 'stopped')
  // A candidate that aborts: starting → stopped.
  const { generation: c } = await t.acquire(H2)
  assert.deepEqual(await t.drain(c, H2), { status: 'ok', state: 'stopped' })
  assert.deepEqual(await t.stop(c + 50, H2), { status: 'unknown_host' })
  await t.db.close()
})

test('renew never changes the state; draining is not extended; an expired active host revives only without a newer one', async () => {
  const t = await setup()
  const { generation: s } = await t.acquire(H1)
  const before = (await t.host(s)).lease_expires_at
  assert.deepEqual(await t.renew(s, H1, 60_000), { status: 'ok', state: 'starting', newerActive: false, leaseLive: true })
  assert.ok((await t.host(s)).lease_expires_at > before, 'starting extends')
  await t.expire(s)
  assert.deepEqual(await t.renew(s, H1), { status: 'host_expired', state: 'starting' }, 'an expired candidate never revives')

  const g = await t.active(H2)
  await t.expire(g)
  const revived = await t.renew(g, H2)
  assert.equal(revived.state, 'active')
  assert.equal(revived.leaseLive, true, 'no newer host: the active lease revives')

  const d = await t.active(H3)
  await t.drain(d, H3, 5_000)
  const window = (await t.host(d)).lease_expires_at
  assert.equal((await t.renew(d, H3, 120_000)).state, 'draining')
  assert.equal((await t.host(d)).lease_expires_at.getTime(), window.getTime(), 'the drain window is fixed')

  // g's lease runs out while a newer host (h4) is active: renew reports it and does not revive g.
  const h4 = 'a0000000-0000-4000-8000-000000000004'
  await t.active(h4)
  await t.expire(g)
  assert.deepEqual(await t.renew(g, H2), { status: 'ok', state: 'active', newerActive: true, leaseLive: false })
  await t.db.close()
})

test('newerActive counts only active hosts with a live lease (never starting, draining, stopped or expired)', async () => {
  const t = await setup()
  const g = await t.active(H1)
  const { generation: starting } = await t.acquire(H2)
  assert.equal((await t.renew(g, H1)).newerActive, false, 'a starting candidate does not displace or drain the active host')
  const n = await t.active(H3)
  assert.equal((await t.renew(g, H1)).newerActive, true)
  await t.expire(n)
  assert.equal((await t.renew(g, H1)).newerActive, false, 'expired')
  await t.renew(n, H3)
  await t.drain(n, H3)
  assert.equal((await t.renew(g, H1)).newerActive, false, 'draining')
  await t.stop(n, H3)
  assert.equal((await t.renew(g, H1)).newerActive, false, 'stopped')
  assert.ok(starting > g)
  await t.db.close()
})

// ── Q1: keyed claims ─────────────────────────────────────────────────────────

test('claim: a greater key takes the row (epoch + 1, seq 0), a smaller one is superseded for good', async () => {
  const t = await setup()
  const g1 = await t.active(H1)
  const first = await t.claim(A, g1, 1, S1, H1)
  assert.deepEqual(first, { status: 'claimed', epoch: 1, newerActive: false, location: null })
  await t.save([row(A, 1, 1)], g1, H1)
  const second = await t.claim(A, g1, 2, S2, H1)
  assert.equal(second.status, 'claimed')
  assert.equal(second.epoch, 2)
  assert.deepEqual(second.location, { areaId: 'pradera', tx: 3, ty: -60, layoutVersion: 'p.abc123' })
  assert.deepEqual(await t.stored(A), { area_id: 'pradera', tx: 3, ty: -60, epoch: 2, seq: 0, og: g1, os: 2, session: S2 })
  // T3/T4/T7 at the row: the older session's claim (key g1:1) arrives late, retried or not.
  for (let i = 0; i < 3; i++) assert.deepEqual(await t.claim(A, g1, 1, S1, H1), { status: 'superseded', newerActive: false })
  assert.equal((await t.stored(A)).epoch, 2, 'nothing written')
  // A newer host's session always wins over any session of an older host.
  const g2 = await t.active(H2)
  assert.equal((await t.claim(A, g2, 1, S3, H2)).epoch, 3)
  assert.deepEqual(await t.claim(A, g1, 99, S1, H1), { status: 'superseded', newerActive: true })
  await t.db.close()
})

test('claim: a lost answer retried adopts the same claim and epoch; the same key from another session is a caller bug', async () => {
  const t = await setup()
  const g = await t.active(H1)
  const first = await t.claim(A, g, 7, S1, H1)
  const retried = await t.claim(A, g, 7, S1, H1)
  assert.deepEqual(retried, first, 'adoption: same epoch, no increment')
  assert.equal((await t.stored(A)).epoch, first.epoch)
  await assert.rejects(t.claim(A, g, 7, S2, H1), /key_reused/)
  assert.deepEqual(await t.claim(GHOST, g, 8, S2, H1), { status: 'unknown_user' })
  await assert.rejects(t.claim(A, g, 0, S1, H1), /invalid_claim/)
  await assert.rejects(t.claim(A, g, 1, null, H1), /invalid_claim/)
  await t.db.close()
})

// ── Q3: state × operation ────────────────────────────────────────────────────

test('claims fail closed unless the host is active with a live lease and the exact identity', async () => {
  const t = await setup()
  const { generation: starting } = await t.acquire(H1)
  assert.deepEqual(await t.claim(A, starting, 1, S1, H1), { status: 'host_inactive', state: 'starting' })
  const g = await t.active(H2)
  assert.deepEqual(await t.claim(A, g, 1, S1, H1), { status: 'unknown_host' }, 'generation of one host, id of another')
  assert.deepEqual(await t.claim(A, g + 50, 1, S1, H2), { status: 'unknown_host' })
  await t.expire(g)
  assert.deepEqual(await t.claim(A, g, 1, S1, H2), { status: 'host_expired' })
  await t.renew(g, H2)
  assert.equal((await t.claim(A, g, 1, S1, H2)).status, 'claimed')
  await t.drain(g, H2)
  assert.deepEqual(await t.claim(B, g, 2, S2, H2), { status: 'host_inactive', state: 'draining' }, 'a draining host creates no claim')
  await t.stop(g, H2)
  assert.deepEqual(await t.claim(B, g, 3, S3, H2), { status: 'host_inactive', state: 'stopped' })
  assert.equal(await t.stored(B), null, 'no row was created by a refused claim')
  await t.db.close()
})

test('saves: active normal; draining only the final flush of rows it still owns; never after losing authority', async () => {
  const t = await setup()
  const g1 = await t.active(H1)
  const a = await t.claim(A, g1, 1, S1, H1)
  const b = await t.claim(B, g1, 2, S2, H1)
  assert.deepEqual(results(await t.save([row(A, a.epoch, 1), row(B, b.epoch, 1)], g1, H1)), { [A]: 'applied', [B]: 'applied' })
  assert.deepEqual(results(await t.save([row(A, a.epoch, 1)], g1, H1)), { [A]: 'duplicate' })
  // Another host's session takes B; g1 then drains.
  const g2 = await t.active(H2)
  const b2 = await t.claim(B, g2, 1, S3, H2)
  assert.equal(b2.epoch, b.epoch + 1)
  await t.drain(g1, H1)
  // Final flush: A (still owned) is written; B (lost) is stale, even with the CURRENT epoch guessed.
  const flush = await t.save([row(A, a.epoch, 2, { tx: 9 }), row(B, b2.epoch, 9, { tx: 9 })], g1, H1)
  assert.deepEqual(results(flush), { [A]: 'applied', [B]: 'stale' })
  assert.equal(flush.newerActive, true)
  assert.equal((await t.stored(B)).tx, 3, 'the lost row is untouched')
  // Its own old epoch is stale too: no write after losing authority.
  assert.deepEqual(results(await t.save([row(B, b.epoch, 10)], g1, H1)), { [B]: 'stale' })
  // The window closes: nothing more from the draining host.
  await t.expire(g1)
  assert.deepEqual(await t.save([row(A, a.epoch, 3)], g1, H1), { status: 'host_expired', state: 'draining' })
  await t.stop(g1, H1)
  assert.deepEqual(await t.save([row(A, a.epoch, 4)], g1, H1), { status: 'host_inactive', state: 'stopped' })
  // The new owner writes normally.
  assert.deepEqual(results(await t.save([row(B, b2.epoch, 1, { tx: 5 })], g2, H2)), { [B]: 'applied' })
  await t.db.close()
})

test('saves from a starting, expired, unknown or foreign host are refused for the whole batch', async () => {
  const t = await setup()
  const g = await t.active(H1)
  const a = await t.claim(A, g, 1, S1, H1)
  const { generation: starting } = await t.acquire(H2)
  assert.deepEqual(await t.save([row(A, a.epoch, 1)], starting, H2), { status: 'host_inactive', state: 'starting' })
  assert.deepEqual(await t.save([row(A, a.epoch, 1)], g, H2), { status: 'unknown_host' })
  // An active host that does not own the row, guessing its epoch: stale (owner condition).
  const other = await t.active(H3)
  assert.deepEqual(results(await t.save([row(A, a.epoch, 1)], other, H3)), { [A]: 'stale' })
  await t.expire(g)
  assert.deepEqual(await t.save([row(A, a.epoch, 1)], g, H1), { status: 'host_expired', state: 'active' })
  assert.equal((await t.stored(A)).seq, 0, 'nothing written')
  await t.db.close()
})

// ── Q2: v1 compatibility (realtime 4d0ab64) ─────────────────────────────────

test('v1 still works on rows no keyed session owns, and fails closed on keyed rows', async () => {
  const t = await setup()
  // A v1 session (the old dark realtime) on a fresh row.
  const v1 = await t.claimV1(A, 0)
  assert.deepEqual(v1, { status: 'claimed', epoch: 1, location: null })
  assert.deepEqual(await t.saveV1([row(A, 1, 1)]), [{ userId: A, result: 'applied' }])
  // A keyed session takes it over (owner_generation 0 < any generation).
  const g = await t.active(H1)
  const keyed = await t.claim(A, g, 1, S1, H1)
  assert.equal(keyed.epoch, 2)
  // The old protocol now fails closed: conflicts (even expecting the current epoch) and stale saves.
  assert.deepEqual(await t.claimV1(A, 0), { status: 'conflict', epoch: 2 })
  assert.deepEqual(await t.claimV1(A, 2), { status: 'conflict', epoch: 2 })
  assert.deepEqual(await t.saveV1([row(A, 2, 5)]), [{ userId: A, result: 'stale' }])
  assert.deepEqual(await t.saveV1([row(A, 1, 5)]), [{ userId: A, result: 'stale' }])
  assert.deepEqual(await t.stored(A), { area_id: 'pradera', tx: 3, ty: -60, epoch: 2, seq: 0, og: g, os: 1, session: S1 })
  await t.db.close()
})

// ── Q7: privileges ───────────────────────────────────────────────────────────

const FUNCTIONS = [
  `SELECT public.world_presence_acquire('${H1}'::uuid, 15000)`,
  `SELECT public.world_presence_activate(1, '${H1}'::uuid, 15000)`,
  `SELECT public.world_presence_renew(1, '${H1}'::uuid, 15000)`,
  `SELECT public.world_presence_drain(1, '${H1}'::uuid, 10000)`,
  `SELECT public.world_presence_stop(1, '${H1}'::uuid)`,
  `SELECT public.world_location_claim_keyed('${A}'::uuid, 1, 1, '${S1}'::uuid, '${H1}'::uuid)`,
  `SELECT public.world_location_save_keyed('[]'::jsonb, 1, '${H1}'::uuid)`,
  `SELECT public.world_location_claim('${A}'::uuid, 0)`,
  `SELECT public.world_location_save('[]'::jsonb)`,
]
const OBJECTS = [
  'SELECT * FROM public.world_presence_hosts',
  `INSERT INTO public.world_presence_hosts (host_id, lease_expires_at) VALUES ('${H2}', now())`,
  `UPDATE public.world_presence_hosts SET state = 'active'`,
  "SELECT nextval('public.world_presence_generation_seq')",
  "SELECT currval('public.world_presence_generation_seq')",
  "SELECT setval('public.world_presence_generation_seq', 1000)",
  'SELECT last_value FROM public.world_presence_generation_seq',
]

test('privileges: anon, authenticated and PUBLIC cannot touch the table, the sequence or any RPC', async () => {
  const t = await setup()
  await t.active(H1)
  // A role with no grant at all: whatever it can do, it got from PUBLIC.
  await t.db.exec('CREATE ROLE ordering_probe NOLOGIN; GRANT USAGE ON SCHEMA public TO ordering_probe')
  const asProbe = sql => t.db.transaction(async tx => { await tx.exec('SET LOCAL ROLE ordering_probe'); return tx.query(sql) })
  for (const sql of [...OBJECTS, ...FUNCTIONS]) {
    for (const role of ['anon', 'authenticated']) await assert.rejects(asRole(t.db, role, sql, [], A), /permission denied/, `${role}: ${sql.slice(0, 60)}`)
    await assert.rejects(asProbe(sql), /permission denied/, `PUBLIC: ${sql.slice(0, 60)}`)
  }
  await t.db.close()
})

test('privileges: service_role does everything the functions need (sequence nextval, LOCK, FOR SHARE) and no more', async () => {
  const t = await setup()
  // Every operation runs as service_role (serviceQuery): acquire's nextval, activate's LOCK TABLE, claim's FOR SHARE.
  const g = await t.active(H1)
  assert.equal((await t.claim(A, g, 1, S1, H1)).status, 'claimed')
  assert.equal((await t.save([row(A, 1, 1)], g, H1)).status, 'ok')
  for (const sql of [
    'DELETE FROM public.world_presence_hosts',
    'TRUNCATE public.world_presence_hosts',
    "SELECT setval('public.world_presence_generation_seq', 1000)",
    'SELECT last_value FROM public.world_presence_generation_seq',
  ]) await assert.rejects(t.service(sql), /permission denied/, `service_role: ${sql}`)
  await t.db.close()
})

test('catalog: the ordering grants check returns zero rows (closed)', async () => {
  const t = await setup()
  const { rows } = await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))
  assert.deepEqual(rows, [])
  await t.db.close()
})

test('catalog check is not vacuous: it reports a privilege a default would leave behind', async () => {
  const t = await setup()
  await t.db.exec(`GRANT USAGE ON SEQUENCE public.world_presence_generation_seq TO anon;
    GRANT EXECUTE ON FUNCTION public.world_presence_renew(bigint, uuid, integer) TO PUBLIC;
    GRANT DELETE ON public.world_presence_hosts TO service_role`)
  const { rows } = await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))
  const kinds = rows.map(r => `${r.kind}:${r.grantee}`).sort()
  assert.deepEqual(kinds, ['execute:anon', 'execute:authenticated', 'public_execute:PUBLIC', 'sequence_privilege:anon', 'service_role_table:service_role'])
  await t.db.close()
})

// ── Rollback ─────────────────────────────────────────────────────────────────

test('rollback: drops the ordering objects and restores the v1 bodies; the migration re-applies cleanly', async () => {
  const t = await setup()
  const g = await t.active(H1)
  await t.claim(A, g, 1, S1, H1)
  await t.db.exec(await readFile(ROLLBACK, 'utf8'))
  const exists = async name => (await t.db.query('SELECT to_regclass($1) AS r', [name])).rows[0].r !== null
  assert.equal(await exists('public.world_presence_hosts'), false)
  assert.equal(await exists('public.world_presence_generation_seq'), false)
  const columns = (await t.db.query("SELECT column_name FROM information_schema.columns WHERE table_name = 'world_player_locations' AND column_name LIKE 'owner_%'")).rows
  assert.deepEqual(columns, [])
  const keyed = (await t.db.query("SELECT proname FROM pg_proc WHERE proname LIKE 'world_presence_%' OR proname LIKE 'world_location_%_keyed'")).rows
  assert.deepEqual(keyed, [])
  // v1 works again exactly as before (the keyed row is now an ordinary row).
  const again = await t.claimV1(A, 0)
  assert.equal(again.status, 'conflict')
  assert.equal((await t.claimV1(A, again.epoch)).status, 'claimed')
  const migration = fileURLToPath(new URL('../../../../../supabase/migrations/20261003120000_world_location_ordering.sql', import.meta.url))
  await t.db.exec(await readFile(migration, 'utf8'))
  assert.deepEqual((await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows, [])
  await t.db.close()
})
