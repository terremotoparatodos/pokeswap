import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { openLocalDatabase, serviceQuery } from './dev/localDatabase.js'

// CLOUD READINESS-3: the presence-recovery migration (20261005120000) on the embedded Postgres with
// Supabase's worst-case default privileges (dev/supabaseStubs.sql). Sequences are deterministic
// (no timers); the only time travel is the table owner moving a lease into the past, as in
// worldLocationOrdering.database.test.js. Concurrency and locks are proven on real Postgres by
// scripts/world-location/recovery-concurrency.

const P = '11111111-1111-4111-8111-111111111111'
const Q = '22222222-2222-4222-8222-222222222222'
const LEASE = 15_000
const MIGRATIONS = new URL('../../../../../supabase/migrations/', import.meta.url)
const NEW_MIGRATION = new URL('20261005120000_world_presence_recovery.sql', MIGRATIONS)
const GRANTS_CHECK = fileURLToPath(new URL('../../../../../scripts/world-location/recovery-grants-check.sql', import.meta.url))
const ROLLBACK = fileURLToPath(new URL('../../../../../scripts/world-location/rollback_world_presence_recovery.sql', import.meta.url))
// CLOUD JOIN-ORDER-2: the join order (20261006120000) calls the recovery rules; its rollback runs first.
const JOIN_ORDER_ROLLBACK = fileURLToPath(new URL('../../../../../scripts/world-location/rollback_world_location_join_order.sql', import.meta.url))
const V1_FUNCTIONS = ['world_presence_acquire', 'world_presence_activate', 'world_presence_renew', 'world_presence_drain', 'world_presence_stop',
  'world_location_claim_keyed', 'world_location_save_keyed', 'world_location_claim', 'world_location_save']

let hostCount = 0
let sessionCount = 0
const uuid = (prefix, n) => `${prefix}-0000-4000-8000-${String(n).padStart(12, '0')}`

async function setup() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${P}'), ('${Q}')`)
  const service = serviceQuery(db)
  const fn = async (sql, params) => (await service(sql, params)).rows[0].r
  const t = {
    db,
    async host() { const h = uuid('a0000000', ++hostCount); const { generation } = await fn('SELECT public.world_presence_acquire($1::uuid, $2::int) AS r', [h, LEASE]); return { g: generation, h, seq: 0 } },
    activate: x => fn('SELECT public.world_presence_activate($1::bigint, $2::uuid, $3::int) AS r', [x.g, x.h, LEASE]),
    exclusive: x => fn('SELECT public.world_presence_activate_exclusive($1::bigint, $2::uuid, $3::int) AS r', [x.g, x.h, LEASE]),
    renew: x => fn('SELECT public.world_presence_renew($1::bigint, $2::uuid, $3::int) AS r', [x.g, x.h, LEASE]),
    drain: x => fn('SELECT public.world_presence_drain($1::bigint, $2::uuid, 10000) AS r', [x.g, x.h]),
    stop: x => fn('SELECT public.world_presence_stop($1::bigint, $2::uuid) AS r', [x.g, x.h]),
    anyActive: () => fn('SELECT public.world_presence_any_active() AS r', []),
    async active() { const x = await t.host(); assert.equal((await t.activate(x)).status, 'active'); return x },
    claim: (user, x, { takeover = false, seq = ++x.seq, session = uuid('c0000000', ++sessionCount) } = {}) =>
      fn('SELECT public.world_location_claim_keyed_v2($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid, $6::boolean) AS r', [user, x.g, seq, session, x.h, takeover]),
    claimV1: (user, x, seq = ++x.seq) => fn('SELECT public.world_location_claim_keyed($1::uuid, $2::bigint, $3::bigint, $4::uuid, $5::uuid) AS r', [user, x.g, seq, uuid('c0000000', ++sessionCount), x.h]),
    save: (user, x, epoch, seq, tx) => fn('SELECT public.world_location_save_keyed($1::jsonb, $2::bigint, $3::uuid) AS r',
      [JSON.stringify([{ userId: user, epoch, seq, areaId: 'pradera', tx, ty: -60, layoutVersion: 'p.abc123' }]), x.g, x.h]),
    stored: async user => (await db.query('SELECT tx, epoch::int, owner_generation::int AS og FROM public.world_player_locations WHERE user_id = $1', [user])).rows[0] ?? null,
    expire: x => db.query("UPDATE public.world_presence_hosts SET lease_expires_at = now() - interval '1 second' WHERE generation = $1", [x.g]),
    activeGenerations: async () => (await db.query("SELECT generation::int AS g FROM public.world_presence_hosts WHERE state = 'active' AND lease_expires_at > now() ORDER BY 1")).rows.map(r => r.g),
  }
  return t
}
const resultOf = answer => answer.results?.[0]?.result ?? answer.status

/** The common prefix of every takeover case: the old host g2 (active) and a newer owner g3 that saved tile 32 for P. */
async function ownedByNewer(t) {
  const g2 = await t.active(); const g3 = await t.active()
  const c = await t.claim(P, g3)
  assert.equal(c.status, 'claimed')
  assert.equal(resultOf(await t.save(P, g3, c.epoch, 1, 32)), 'applied')
  return { g2, g3, epoch: c.epoch }
}

test('capability marker: world_presence_recovery_version() = 1', async () => {
  const t = await setup()
  assert.equal((await serviceQuery(t.db)('SELECT public.world_presence_recovery_version() AS v', [])).rows[0].v, 1)
  await t.db.close()
})

test('stopped owner (its sockets closed first): a smaller key takes the row, restores its last tile; the stopped host can neither save nor claim again', async () => {
  const t = await setup()
  const { g2, g3, epoch } = await ownedByNewer(t)
  await t.drain(g3); await t.stop(g3)
  const r = await t.claim(P, g2)
  assert.deepEqual([r.status, r.location?.tx, r.epoch], ['claimed', 32, epoch + 1])
  assert.equal((await t.save(P, g3, epoch, 2, 99)).status, 'host_inactive')
  assert.equal((await t.claimV1(P, g3)).status, 'host_inactive')
  assert.deepEqual(await t.stored(P), { tx: 32, epoch: epoch + 1, og: g2.g })
  await t.db.close()
})

test('v1 is unchanged: the same stopped-owner case still answers superseded through world_location_claim_keyed', async () => {
  const t = await setup()
  const { g2, g3 } = await ownedByNewer(t)
  await t.drain(g3); await t.stop(g3)
  assert.equal((await t.claimV1(P, g2)).status, 'superseded')
  await t.db.close()
})

test('draining owner: owner_draining (retryable, nothing written); its final flush is kept and restored after it stops', async () => {
  const t = await setup()
  const { g2, g3, epoch } = await ownedByNewer(t)
  await t.drain(g3)
  const during = await t.claim(P, g2)
  assert.deepEqual([during.status, during.newerActive], ['owner_draining', false])
  assert.equal(resultOf(await t.save(P, g3, epoch, 2, 35)), 'applied', 'the draining owner flushes its last tile')
  // Even an explicit takeover waits for a draining owner's flush.
  assert.equal((await t.claim(P, g2, { takeover: true })).status, 'owner_draining')
  await t.stop(g3)
  const after = await t.claim(P, g2)
  assert.deepEqual([after.status, after.location?.tx], ['claimed', 35])
  await t.db.close()
})

test('unreachable owner (lease ran out; crash or partition): a resume never takes; only an explicit takeover does', async () => {
  const t = await setup()
  const { g2, g3, epoch } = await ownedByNewer(t)
  await t.expire(g3)
  const resumed = await t.claim(P, g2)
  assert.deepEqual([resumed.status, resumed.newerActive], ['owner_unreachable', false])
  assert.deepEqual(await t.stored(P), { tx: 32, epoch, og: g3.g }, 'nothing written')
  const taken = await t.claim(P, g2, { takeover: true })
  assert.deepEqual([taken.status, taken.location?.tx, taken.epoch], ['claimed', 32, epoch + 1])
  // If the owner was only partitioned and comes back, its next save is stale: the player chose «Jugar acá».
  assert.equal((await t.renew(g3)).state, 'active')
  assert.equal(resultOf(await t.save(P, g3, epoch, 2, 40)), 'stale')
  await t.db.close()
})

test('partition that heals before anyone takes: the owner keeps its row and keeps saving', async () => {
  const t = await setup()
  const { g2, g3, epoch } = await ownedByNewer(t)
  await t.expire(g3)
  assert.equal((await t.claim(P, g2)).status, 'owner_unreachable')
  assert.equal((await t.renew(g3)).leaseLive, true)
  assert.equal(resultOf(await t.save(P, g3, epoch, 2, 41)), 'applied')
  await t.db.close()
})

test('a drain window that ran out is not proof of closed sockets: unreachable, not stopped', async () => {
  const t = await setup()
  const { g2, g3 } = await ownedByNewer(t)
  await t.drain(g3); await t.expire(g3)
  assert.equal((await t.claim(P, g2)).status, 'owner_unreachable')
  await t.db.close()
})

test('a live owner on a newer host: superseded with newerActive, even for an explicit takeover (live owners keep the v1 order)', async () => {
  const t = await setup()
  const { g2 } = await ownedByNewer(t)
  assert.deepEqual(await t.claim(P, g2), { status: 'superseded', newerActive: true })
  assert.deepEqual(await t.claim(P, g2, { takeover: true }), { status: 'superseded', newerActive: true })
  await t.db.close()
})

test('an owner generation the table no longer has (pruned) is taken over', async () => {
  const t = await setup()
  const { g2, g3 } = await ownedByNewer(t)
  await t.drain(g3); await t.stop(g3)
  await t.db.query('DELETE FROM public.world_presence_hosts WHERE generation = $1', [g3.g])
  assert.equal((await t.claim(P, g2)).status, 'claimed')
  await t.db.close()
})

test('v1 behaviours kept by v2: greater key, adoption, key_reused, the caller host gate, unknown user and invalid input', async () => {
  const t = await setup()
  const g2 = await t.active(); const g3 = await t.active()
  const session = uuid('c0000000', ++sessionCount)
  const a = await t.claim(P, g2, { seq: 1, session })
  const again = await t.claim(P, g2, { seq: 1, session })
  assert.equal(again.epoch, a.epoch, 'adoption')
  await assert.rejects(t.claim(P, g2, { seq: 1 }), /key_reused/)
  assert.equal((await t.claim(P, g3)).epoch, a.epoch + 1, 'a greater key takes')
  assert.equal((await t.claim(Q, { g: 999, h: g2.h, seq: 0 })).status, 'unknown_host')
  await t.drain(g2)
  assert.deepEqual(await t.claim(Q, g2), { status: 'host_inactive', state: 'draining' })
  await t.expire(g3)
  assert.equal((await t.claim(Q, g3)).status, 'host_expired')
  const g4 = await t.active()
  assert.equal((await t.claim('99999999-9999-4999-8999-999999999999', g4)).status, 'unknown_user')
  const service = serviceQuery(t.db)
  await assert.rejects(service('SELECT public.world_location_claim_keyed_v2($1::uuid, $2::bigint, 1, $3::uuid, $4::uuid, NULL) AS r', [P, g4.g, uuid('c0000000', ++sessionCount), g4.h]), /invalid_claim/)
  await t.db.close()
})

test('exclusive activation: yields to a lower starting candidate; the candidate then activates (the D2 race in 9.2)', async () => {
  const t = await setup()
  const C = await t.host(); const S = await t.host()           // S got the HIGHER generation
  assert.deepEqual(await t.exclusive(S), { status: 'candidate_starting' })
  await t.stop(S)
  assert.equal((await t.activate(C)).status, 'active')
  assert.deepEqual(await t.activeGenerations(), [C.g])
  await t.db.close()
})

test('exclusive activation: the candidate acquired after the standby activates normally and the standby hears newerActive', async () => {
  const t = await setup()
  const S = await t.host()
  assert.deepEqual(await t.exclusive(S), { status: 'active' })
  const C = await t.host()
  assert.equal((await t.activate(C)).status, 'active')
  assert.equal((await t.renew(S)).newerActive, true)
  await t.db.close()
})

test('exclusive activation: two standbys, exactly one wins (the lower), no livelock; refusals and retries', async () => {
  const t = await setup()
  const S1 = await t.host(); const S2 = await t.host()
  assert.deepEqual(await t.exclusive(S2), { status: 'candidate_starting' })
  await t.stop(S2)
  assert.deepEqual(await t.exclusive(S1), { status: 'active' })
  assert.deepEqual(await t.exclusive(S1), { status: 'active' }, 'a retry')
  const S3 = await t.host()
  assert.deepEqual(await t.exclusive(S3), { status: 'other_active' })
  assert.deepEqual(await t.exclusive(S2), { status: 'host_inactive', state: 'stopped' })
  const S4 = await t.host(); await t.expire(S4)
  assert.deepEqual(await t.exclusive(S4), { status: 'host_expired', state: 'starting' })
  assert.deepEqual(await t.exclusive({ g: 999, h: S1.h }), { status: 'unknown_host' })
  assert.deepEqual(await t.activeGenerations(), [S1.g])
  await t.db.close()
})

test('exclusive activation: a candidate that died while starting blocks the standby only until its lease runs out', async () => {
  const t = await setup()
  const C = await t.host(); const S = await t.host()
  assert.equal((await t.exclusive(S)).status, 'candidate_starting')
  await t.expire(C)
  assert.equal((await t.exclusive(S)).status, 'active')
  await t.db.close()
})

test('D2-A end to end: the candidate is displaced by the autorestarted slot, the agent stops the old slots, a standby with a NEW identity recovers exactly one host', async () => {
  const t = await setup()
  const O = await t.active()
  const C = await t.host()                       // deploy candidate booting
  const X = await t.active()                     // the old slot restarted by PM2: a newer generation
  assert.equal((await t.activate(C)).status, 'newer_active')
  await t.stop(C)                                // HostLifecycle #stopNow on newer_active: terminal
  await t.drain(O); await t.stop(O); await t.drain(X); await t.stop(X)
  assert.equal(await t.anyActive(), false)
  assert.deepEqual(await t.activate(C), { status: 'host_inactive', state: 'stopped' }, 'the displaced identity never comes back')
  const S = await t.host()
  assert.deepEqual(await t.exclusive(S), { status: 'active' })
  assert.equal(await t.anyActive(), true)
  assert.deepEqual(await t.activeGenerations(), [S.g])
  await t.db.close()
})

test('privileges: the recovery functions are closed to clients (catalog check = 0 rows), and the check is not vacuous', async () => {
  const t = await setup()
  assert.deepEqual((await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows, [])
  await t.db.exec('GRANT EXECUTE ON FUNCTION public.world_presence_any_active() TO anon; GRANT EXECUTE ON FUNCTION public.world_location_claim_keyed_v2(uuid, bigint, bigint, uuid, uuid, boolean) TO PUBLIC')
  const kinds = (await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows.map(r => `${r.kind}:${r.object}:${r.grantee}`).sort()
  assert.deepEqual(kinds, [
    'execute:world_location_claim_keyed_v2(uuid,bigint,bigint,uuid,uuid,boolean):anon',
    'execute:world_location_claim_keyed_v2(uuid,bigint,bigint,uuid,uuid,boolean):authenticated',
    'execute:world_presence_any_active():anon',
    'public_execute:world_location_claim_keyed_v2(uuid,bigint,bigint,uuid,uuid,boolean):PUBLIC',
  ])
  await t.db.close()
})

test('the v1 functions keep their exact definitions and privileges (golden against a database without the migration)', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const before = new PGlite()
  await before.exec(await readFile(fileURLToPath(new URL('./dev/supabaseStubs.sql', import.meta.url)), 'utf8'))
  for (const name of ['20260926002154_world_skills_authority.sql', '20260926002207_world_skills_gate.sql', '20261001051958_world_multi_yield.sql',
    '20261001220000_world_player_locations.sql', '20261003120000_world_location_ordering.sql']) await before.exec(await readFile(fileURLToPath(new URL(name, MIGRATIONS)), 'utf8'))
  const after = (await setup()).db
  const snapshot = async db => (await db.query(`SELECT p.proname, pg_get_functiondef(p.oid) AS def, p.proacl::text AS acl FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY($1) ORDER BY p.proname, p.oid::regprocedure::text`, [V1_FUNCTIONS])).rows
  const [a, b] = [await snapshot(before), await snapshot(after)]
  assert.equal(a.length, 9)
  assert.deepEqual(b, a)
  const text = await readFile(NEW_MIGRATION, 'utf8')
  for (const name of V1_FUNCTIONS) assert.doesNotMatch(text, new RegExp(`FUNCTION public\\.${name}\\(`), `${name} is not redefined`)
  assert.doesNotMatch(text, /\b(CREATE|ALTER|DROP)\s+(TABLE|INDEX|SEQUENCE)\b/i, 'no table, index or sequence change')
  await before.close(); await after.close()
})

test('rollback: drops exactly the recovery functions; v1 keeps working; the migration re-applies cleanly', async () => {
  const t = await setup()
  const g = await t.active()
  await t.db.exec(await readFile(JOIN_ORDER_ROLLBACK, 'utf8'))
  await t.db.exec(await readFile(ROLLBACK, 'utf8'))
  const left = (await t.db.query("SELECT proname FROM pg_proc WHERE proname IN ('world_presence_any_active', 'world_presence_activate_exclusive', 'world_location_claim_keyed_v2', 'world_presence_owner_state', 'world_presence_recovery_version')")).rows
  assert.deepEqual(left, [])
  assert.equal((await t.claimV1(P, g)).status, 'claimed', 'v1 untouched')
  await t.db.exec(await readFile(NEW_MIGRATION, 'utf8'))
  assert.equal((await t.claim(Q, g)).status, 'claimed')
  assert.deepEqual((await t.db.query(await readFile(GRANTS_CHECK, 'utf8'))).rows, [])
  await t.db.close()
})
