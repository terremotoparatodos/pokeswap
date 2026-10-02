import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { asRole, openLocalDatabase, serviceQuery } from './dev/localDatabase.js'

// WORLD LOCATION-2: the real migration on an embedded Postgres that starts
// with Supabase's worst-case default privileges (dev/supabaseStubs.sql).
// Matrix cases (WORLD_LOCATION_1_AUDIT §7): 6, 7, 8, 9, 11, 17, 27, plus the
// per-row batch semantics and the rollback script.

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const C = '33333333-3333-4333-8333-333333333333'
const GHOST = '99999999-9999-4999-8999-999999999999' // not an auth user
const ROLLBACK = fileURLToPath(new URL('../../../../../scripts/world-location/rollback_world_player_locations.sql', import.meta.url))

async function setup() {
  const db = await openLocalDatabase()
  await db.exec(`INSERT INTO auth.users VALUES ('${A}'), ('${B}'), ('${C}')`)
  const service = serviceQuery(db)
  // The raw conditional claim, and what a new session does with it: read the current epoch, claim after it.
  const claimAt = async (userId, expected) => (await service('SELECT public.world_location_claim($1::uuid, $2::bigint) AS r', [userId, expected])).rows[0].r
  const claim = async userId => {
    const first = await claimAt(userId, 0)
    return first.status === 'conflict' ? claimAt(userId, first.epoch) : first
  }
  const save = async rows => (await service('SELECT public.world_location_save($1::jsonb) AS r', [JSON.stringify(rows)])).rows[0].r
  const stored = async userId => (await service('SELECT area_id, tx, ty, layout_version, epoch::int, seq::int FROM public.world_player_locations WHERE user_id = $1', [userId])).rows[0] ?? null
  return { db, service, claim, claimAt, save, stored }
}

const row = (userId, epoch, seq, extra = {}) => ({ userId, epoch, seq, areaId: 'pradera', tx: 3, ty: -60, layoutVersion: 'p.abc123', ...extra })
const results = answer => Object.fromEntries(answer.map(r => [r.userId, r.result]))

// ── Trust boundary (case 11) ───────────────────────────────────────────────

test('no client role can read, write or execute anything of the location store', async () => {
  const { db, claim, save } = await setup()
  const { epoch } = await claim(A)
  await save([row(A, epoch, 1)])
  for (const role of ['anon', 'authenticated']) {
    for (const sql of [
      'SELECT * FROM public.world_player_locations',
      `INSERT INTO public.world_player_locations (user_id) VALUES ('${B}')`,
      `UPDATE public.world_player_locations SET tx = 0`,
      'DELETE FROM public.world_player_locations',
      `SELECT public.world_location_claim('${A}'::uuid, 0)`,
      `SELECT public.world_location_save('[]'::jsonb)`,
    ]) await assert.rejects(asRole(db, role, sql, [], A), /permission denied/, `${role}: ${sql.slice(0, 50)}`)
  }
  await db.close()
})

test('catalog: RLS on with no policy, service_role without DELETE, both functions INVOKER and service_role only', async () => {
  const { db } = await setup()
  const one = async sql => (await db.query(sql)).rows
  assert.deepEqual(await one(`SELECT relrowsecurity FROM pg_class WHERE oid = 'public.world_player_locations'::regclass`), [{ relrowsecurity: true }])
  assert.deepEqual(await one(`SELECT polname FROM pg_policy WHERE polrelid = 'public.world_player_locations'::regclass`), [])
  const privileges = async role => (await db.query(
    `SELECT p FROM unnest(ARRAY['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
     WHERE has_table_privilege($1, 'public.world_player_locations', p)`, [role])).rows.map(r => r.p)
  assert.deepEqual(await privileges('anon'), [])
  assert.deepEqual(await privileges('authenticated'), [])
  assert.deepEqual(await privileges('service_role'), ['SELECT', 'INSERT', 'UPDATE'])
  for (const fn of ['public.world_location_claim(uuid, bigint)', 'public.world_location_save(jsonb)']) {
    const [meta] = await one(`SELECT prosecdef, proconfig FROM pg_proc WHERE oid = '${fn}'::regprocedure`)
    assert.equal(meta.prosecdef, false, `${fn} must be SECURITY INVOKER`)
    assert.deepEqual(meta.proconfig, ['search_path=public'])
    for (const role of ['anon', 'authenticated', 'public']) {
      const grantee = role === 'public' ? 'PUBLIC' : role
      const { rows } = await db.query(`SELECT 1 FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
        WHERE p.oid = '${fn}'::regprocedure AND a.privilege_type = 'EXECUTE' AND a.grantee = ${grantee === 'PUBLIC' ? 0 : `'${grantee}'::regrole`}`)
      assert.equal(rows.length, 0, `${grantee} must not execute ${fn}`)
    }
    assert.equal((await one(`SELECT has_function_privilege('service_role', '${fn}', 'EXECUTE') AS ok`))[0].ok, true)
  }
  await db.close()
})

const GRANTS_CHECK = fileURLToPath(new URL('../../../../../scripts/world-location/location-grants-check.sql', import.meta.url))

test('the read-only hosted check finds nothing after the migration, and catches a reopened grant', async () => {
  const { db } = await setup()
  const check = await readFile(GRANTS_CHECK, 'utf8')
  assert.deepEqual((await db.query(check)).rows, [])
  await db.exec(`GRANT SELECT (area_id) ON public.world_player_locations TO authenticated;
    GRANT EXECUTE ON FUNCTION public.world_location_claim(uuid, bigint) TO anon;
    CREATE POLICY leak ON public.world_player_locations FOR SELECT TO authenticated USING (true);
    GRANT DELETE ON public.world_player_locations TO service_role;`)
  const found = (await db.query(check)).rows.map(r => `${r.kind}:${r.grantee ?? ''}:${r.detail ?? ''}`)
  assert.deepEqual(found.sort(), ['execute:anon:EXECUTE', 'policy::leak', 'service_role_extra:service_role:DELETE', 'table_privilege:authenticated:SELECT'])
  await db.close()
})

// ── Claim ──────────────────────────────────────────────────────────────────

test('claim: the first creates an empty row at epoch 1; each next one bumps the epoch, resets seq and keeps the location', async () => {
  const { db, claim, save, stored } = await setup()
  assert.deepEqual(await claim(A), { status: 'claimed', epoch: 1, location: null })
  assert.deepEqual(await stored(A), { area_id: null, tx: null, ty: null, layout_version: null, epoch: 1, seq: 0 })
  assert.deepEqual(results(await save([row(A, 1, 7)])), { [A]: 'applied' })
  assert.deepEqual(await claim(A), { status: 'claimed', epoch: 2, location: { areaId: 'pradera', tx: 3, ty: -60, layoutVersion: 'p.abc123' } })
  assert.deepEqual(await stored(A), { area_id: 'pradera', tx: 3, ty: -60, layout_version: 'p.abc123', epoch: 2, seq: 0 })
  await db.close()
})

test('claim: an id that is not an auth user writes nothing', async () => {
  const { db, claim, service } = await setup()
  assert.deepEqual(await claim(GHOST), { status: 'unknown_user' })
  assert.equal((await service('SELECT count(*)::int AS n FROM public.world_player_locations', [])).rows[0].n, 0)
  await db.close()
})

test('claim: back-to-back claims of one player get distinct, increasing epochs (one writer wins)', async () => {
  const { db, claim, save } = await setup()
  const epochs = []
  for (let i = 0; i < 3; i++) epochs.push((await claim(A)).epoch)
  assert.deepEqual(epochs, [1, 2, 3])
  // Only the highest epoch can write; every other one is fenced.
  assert.deepEqual(results(await save([row(A, 3, 1)])), { [A]: 'applied' })
  for (const old of [1, 2]) assert.deepEqual(results(await save([row(A, old, 99)])), { [A]: 'stale' })
  await db.close()
})

// ── Claim: conditional on the epoch read (review B2) ───────────────────────

test('claim is conditional: it writes only if the stored epoch is still the expected one; otherwise conflict + current epoch, nothing written', async () => {
  const { db, claimAt, save, stored } = await setup()
  assert.deepEqual(await claimAt(A, 0), { status: 'claimed', epoch: 1, location: null })
  assert.deepEqual(await claimAt(A, 0), { status: 'conflict', epoch: 1 }, 'a row exists: 0 is no longer the truth')
  assert.deepEqual(results(await save([row(A, 1, 4)])), { [A]: 'applied' })
  assert.deepEqual(await claimAt(A, 7), { status: 'conflict', epoch: 1 }, 'an epoch from the future claims nothing')
  assert.deepEqual(await stored(A), { area_id: 'pradera', tx: 3, ty: -60, layout_version: 'p.abc123', epoch: 1, seq: 4 }, 'conflicts write nothing')
  assert.equal((await claimAt(A, 1)).epoch, 2)
  assert.deepEqual(await claimAt(A, 1), { status: 'conflict', epoch: 2 })
  assert.deepEqual(await claimAt(B, 3), { status: 'conflict', epoch: 0 }, 'no row yet: the current epoch is 0')
  assert.deepEqual(await claimAt(GHOST, 0), { status: 'unknown_user' })
  for (const bad of [-1, null]) await assert.rejects(claimAt(A, bad), /invalid_expected_epoch/)
  await db.close()
})

test('R2 in the database: an abandoned claim that runs after the live session\'s claim writes nothing, and the live session keeps writing', async () => {
  const { db, claimAt, save, stored } = await setup()
  // C1 read epoch 0 (no row) and was given up before its claim ran; C2 read 0 too and claimed.
  const c2 = await claimAt(A, 0)
  assert.equal(c2.epoch, 1)
  assert.deepEqual(await claimAt(A, 0), { status: 'conflict', epoch: 1 }, 'C1 lands late: no effect')
  assert.deepEqual(results(await save([row(A, 1, 1)])), { [A]: 'applied' }, 'C2 is not stale')
  // The same with a row: both read epoch 1, C2 claims 2, C1's claim with epoch 1 lands late.
  const c2again = await claimAt(A, 1)
  assert.equal(c2again.epoch, 2)
  assert.deepEqual(await claimAt(A, 1), { status: 'conflict', epoch: 2 })
  assert.deepEqual(results(await save([row(A, 2, 1, { tx: 9 })])), { [A]: 'applied' })
  assert.deepEqual({ epoch: (await stored(A)).epoch, tx: (await stored(A)).tx }, { epoch: 2, tx: 9 })
  // A late claim that DID land before the live session read is simply older: the live one claims after it.
  assert.equal((await claimAt(A, 2)).epoch, 3) // C1 lands first
  assert.deepEqual(await claimAt(A, 2), { status: 'conflict', epoch: 3 }) // C2, which had read 2, learns 3…
  assert.equal((await claimAt(A, 3)).epoch, 4) // …and claims after it
  assert.deepEqual(results(await save([row(A, 3, 1)])), { [A]: 'stale' }, 'the late one is the fenced one')
  await db.close()
})

test('concurrent claims with the same expectation: exactly one writes, the others answer conflict with its epoch', async () => {
  const { db, claimAt, stored } = await setup()
  await claimAt(A, 0)
  const answers = await Promise.all([claimAt(A, 1), claimAt(A, 1), claimAt(A, 1)])
  assert.equal(answers.filter(a => a.status === 'claimed').length, 1)
  assert.deepEqual(answers.filter(a => a.status === 'conflict'), [{ status: 'conflict', epoch: 2 }, { status: 'conflict', epoch: 2 }])
  assert.equal((await stored(A)).epoch, 2)
  await db.close()
})

// ── Save: CAS (cases 6, 7, 8, 17) ──────────────────────────────────────────

test('a late write of an older session is stale and changes nothing (case 6)', async () => {
  const { db, claim, save, stored } = await setup()
  await claim(A)
  await save([row(A, 1, 5, { tx: 1 })])
  await claim(A) // a new session (epoch 2) on any instance
  assert.deepEqual(results(await save([row(A, 1, 6, { tx: 2 })])), { [A]: 'stale' })
  assert.deepEqual(results(await save([row(A, 1, 1_000_000, { tx: 2 })])), { [A]: 'stale' }, 'a huge seq does not help an old epoch')
  assert.equal((await stored(A)).tx, 1)
  await db.close()
})

test('a newer epoch from a forged or restored writer is stale too: only the stored epoch writes', async () => {
  const { db, claim, save, stored } = await setup()
  await claim(A)
  assert.deepEqual(results(await save([row(A, 2, 1, { tx: 9 })])), { [A]: 'stale' })
  assert.equal((await stored(A)).tx, null)
  await db.close()
})

test('duplicate and regressive seq: a retry or a reordered older batch is a no-op (cases 7, 8)', async () => {
  const { db, claim, save, stored } = await setup()
  await claim(A)
  assert.deepEqual(results(await save([row(A, 1, 2, { tx: 2 })])), { [A]: 'applied' })
  assert.deepEqual(results(await save([row(A, 1, 2, { tx: 2 })])), { [A]: 'duplicate' }, 'retry of an applied batch')
  assert.deepEqual(results(await save([row(A, 1, 1, { tx: 1 })])), { [A]: 'duplicate' }, 'older batch delivered late')
  assert.deepEqual(await stored(A), { area_id: 'pradera', tx: 2, ty: -60, layout_version: 'p.abc123', epoch: 1, seq: 2 })
  await db.close()
})

test('a crossing (seq n) and the disconnect (seq n+1) delivered in either order leave the newer area (case 17)', async () => {
  for (const order of [['cross', 'leave'], ['leave', 'cross']]) {
    const { db, claim, save, stored } = await setup()
    await claim(A)
    const writes = {
      cross: row(A, 1, 1, { areaId: 'pradera', tx: -5, ty: -69 }),
      leave: row(A, 1, 2, { areaId: 'cueva-inicial', tx: 10, ty: 11, layoutVersion: 'c.def456' }),
    }
    for (const step of order) await save([writes[step]])
    assert.deepEqual(await stored(A), { area_id: 'cueva-inicial', tx: 10, ty: 11, layout_version: 'c.def456', epoch: 1, seq: 2 }, order.join(' then '))
    await db.close()
  }
})

test('save to a player with no claimed row is stale (nothing is created by a save)', async () => {
  const { db, save, stored } = await setup()
  assert.deepEqual(results(await save([row(A, 1, 1)])), { [A]: 'stale' })
  assert.equal(await stored(A), null)
  await db.close()
})

// ── Save: per-row batch results ────────────────────────────────────────────

test('a batch answers row by row, in input order: one stale or invalid row never confirms or blocks the others', async () => {
  const { db, claim, save, stored } = await setup()
  await claim(A); await claim(B); await claim(C)
  await claim(B) // B moved to epoch 2 elsewhere
  await save([row(C, 1, 4, { tx: 4 })])
  const answer = await save([
    row(C, 1, 3, { tx: 3 }), // duplicate (older seq)
    row(A, 1, 1, { tx: 1 }), // applied
    row(B, 1, 1, { tx: 1 }), // stale (epoch 1 < 2)
  ])
  assert.deepEqual(answer, [{ userId: C, result: 'duplicate' }, { userId: A, result: 'applied' }, { userId: B, result: 'stale' }])
  assert.equal((await stored(A)).tx, 1)
  assert.equal((await stored(B)).tx, null)
  assert.equal((await stored(C)).tx, 4)
  await db.close()
})

test('invalid rows answer "invalid" and change nothing, while their batch-mates still apply (case 9)', async () => {
  const bad = [
    { tx: 1.5 }, { ty: 4096 }, { tx: -4097 }, { areaId: 'Ciudad' }, { areaId: 'dg:cueva:1' }, { areaId: 'x' },
    { layoutVersion: 'UPPER' }, { layoutVersion: '' }, { epoch: 0 }, { seq: 0 }, { seq: -1 }, { seq: '2' }, { tx: '3' },
    { tx: null }, { areaId: 7 },
  ]
  for (const extra of bad) {
    const { db, claim, save, stored } = await setup()
    await claim(A); await claim(B)
    const answer = await save([row(A, 1, 1, extra), row(B, 1, 1)])
    assert.deepEqual(results(answer), { [A]: 'invalid', [B]: 'applied' }, JSON.stringify(extra))
    assert.equal((await stored(A)).area_id, null, JSON.stringify(extra))
    await db.close()
  }
  // A missing key is invalid too (NULL must not slip through a comparison).
  for (const key of ['epoch', 'seq', 'areaId', 'tx', 'ty', 'layoutVersion']) {
    const { db, claim, save } = await setup()
    await claim(A)
    const partial = row(A, 1, 1); delete partial[key]
    assert.deepEqual(results(await save([partial])), { [A]: 'invalid' }, `without ${key}`)
    await db.close()
  }
})

test('a malformed batch is refused whole and writes nothing', async () => {
  const { db, claim, save, stored } = await setup()
  await claim(A)
  for (const batch of [[], Array.from({ length: 201 }, () => row(A, 1, 1)), [row(A, 1, 1), row(A, 1, 2)], [row('not-a-uuid', 1, 1)], [{ epoch: 1 }], {}]) {
    await assert.rejects(save(batch), /invalid_batch|duplicate_batch_user/, JSON.stringify(batch).slice(0, 60))
  }
  assert.equal((await stored(A)).seq, 0)
  // 200 rows is the limit, and fine.
  const users = Array.from({ length: 200 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`)
  await db.exec(`INSERT INTO auth.users VALUES ${users.map(u => `('${u}')`).join(',')}`)
  for (const u of users) await claim(u)
  const answer = await save(users.map(u => row(u, 1, 1)))
  assert.equal(answer.length, 200)
  assert.ok(answer.every(r => r.result === 'applied'))
  await db.close()
})

test('the table refuses out-of-range or partial rows even from service_role (case 9)', async () => {
  const { db, service, claim } = await setup()
  await claim(A)
  for (const set of ['tx = 5000, ty = 0, area_id = \'pradera\', layout_version = \'v\'', 'area_id = \'pradera\'', 'area_id = \'Bad Area\', tx = 0, ty = 0, layout_version = \'v\'', 'epoch = 0', 'seq = -1']) {
    await assert.rejects(service(`UPDATE public.world_player_locations SET ${set} WHERE user_id = $1`, [A]), /violates check constraint/, set)
  }
  await db.close()
})

// ── Lifecycle ──────────────────────────────────────────────────────────────

test('deleting the auth user deletes the location row (case 27)', async () => {
  const { db, claim, save, stored } = await setup()
  await claim(A); await save([row(A, 1, 1)])
  await db.query(`DELETE FROM auth.users WHERE id = $1`, [A])
  assert.equal(await stored(A), null)
  await db.close()
})

test('the migration is idempotent, and the rollback script removes the table and both functions', async () => {
  const { db, claim, save } = await setup()
  await claim(A); await save([row(A, 1, 1)])
  await db.exec(await readFile(fileURLToPath(new URL('../../../../../supabase/migrations/20261001220000_world_player_locations.sql', import.meta.url)), 'utf8'))
  await db.exec(await readFile(ROLLBACK, 'utf8'))
  const left = await db.query(`SELECT to_regclass('public.world_player_locations') AS t,
    to_regprocedure('public.world_location_claim(uuid, bigint)') AS c, to_regprocedure('public.world_location_save(jsonb)') AS s`)
  assert.deepEqual(left.rows[0], { t: null, c: null, s: null })
  await db.close()
})
