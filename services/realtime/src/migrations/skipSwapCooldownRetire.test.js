import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { asRole } from '../world/persistence/dev/localDatabase.js'

// SWAP RETIRE-2: the real retirement migration for skip_swap_cooldown, on an
// embedded Postgres. It lives here because this package holds the repository's
// only PGlite harness (and its Supabase stubs, which start from Supabase's
// worst-case default privileges); it touches no WORLD code.
//
// The starting point reproduces hosted as far as the repository knows it: the
// function exactly as 20260914130000_restore_skip_swap_cooldown.sql defines
// it, EXECUTE granted to authenticated, plus the tables it reads and writes.

const repo = path => fileURLToPath(new URL(`../../../../${path}`, import.meta.url))
const STUBS = fileURLToPath(new URL('../world/persistence/dev/supabaseStubs.sql', import.meta.url))
const RESTORE = repo('supabase/migrations/20260914130000_restore_skip_swap_cooldown.sql')
const RETIRE = repo('supabase/migrations/20260930150000_retire_skip_swap_cooldown.sql')

const A = '11111111-1111-4111-8111-111111111111'
const CLIENTS = ['anon', 'authenticated']

// Production's tables, reduced to the columns skip_swap_cooldown and the audit need.
const SCHEMA = `
  CREATE TABLE public.profiles (id uuid PRIMARY KEY, tokens integer, swap_cooldown_until timestamptz);
  CREATE TABLE public.token_ledger (id bigserial PRIMARY KEY, user_id uuid, amount integer, reason text, created_at timestamptz DEFAULT now());
  CREATE TABLE public.swap_history (id bigserial PRIMARY KEY, user_id uuid, pokemon_given_id integer, pokemon_received_id integer, was_shiny boolean, rarity text, created_at timestamptz DEFAULT now());
  GRANT SELECT ON public.profiles, public.token_ledger, public.swap_history TO authenticated;
  INSERT INTO auth.users VALUES ('${A}');
  INSERT INTO public.profiles VALUES ('${A}', 5000, now() + interval '8 hours');
  INSERT INTO public.token_ledger (user_id, amount, reason) VALUES ('${A}', 5000, 'seed');
  INSERT INTO public.swap_history (user_id, pokemon_given_id, pokemon_received_id, was_shiny, rarity)
    VALUES ('${A}', 25, 133, true, 'rare'), ('${A}', 133, 7, false, 'common');
`

async function hostedLike() {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()
  await db.exec(await readFile(STUBS, 'utf8'))
  await db.exec(SCHEMA)
  await db.exec(await readFile(RESTORE, 'utf8'))
  return db
}

const retire = async db => db.exec(await readFile(RETIRE, 'utf8'))

async function overloads(db) {
  const { rows } = await db.query(`SELECT p.oid::regprocedure::text AS sig, p.prosrc, obj_description(p.oid, 'pg_proc') AS note
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'skip_swap_cooldown' ORDER BY 1`)
  return rows
}

async function canExecute(db, role, sig) {
  const { rows } = await db.query(`SELECT has_function_privilege($1, $2, 'EXECUTE') AS ok`, [role, sig])
  return rows[0].ok
}

/** PUBLIC appears in an ACL as grantee 0. */
async function publicCanExecute(db, sig) {
  const { rows } = await db.query(`SELECT count(*)::int AS n FROM pg_proc p, aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) acl
    WHERE p.oid = $1::regprocedure AND acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'`, [sig])
  return rows[0].n > 0
}

async function snapshot(db) {
  const profile = (await db.query('SELECT tokens, swap_cooldown_until FROM public.profiles')).rows
  const ledger = (await db.query('SELECT user_id, amount, reason FROM public.token_ledger ORDER BY id')).rows
  const history = (await db.query('SELECT * FROM public.swap_history ORDER BY id')).rows
  return { profile, ledger, history }
}

test('before: an authenticated client could still pay 1,000 tokens to skip a cooldown that guards nothing', async () => {
  const db = await hostedLike()
  assert.equal(await canExecute(db, 'authenticated', 'public.skip_swap_cooldown()'), true)
  const { rows } = await asRole(db, 'authenticated', 'SELECT public.skip_swap_cooldown() AS r', [], A)
  assert.deepEqual(rows[0].r, { new_balance: 4000 })
  await db.close()
})

test('after: PUBLIC, anon and authenticated cannot execute it, and a call changes nothing', async () => {
  const db = await hostedLike()
  const before = await snapshot(db)
  await retire(db)

  for (const role of CLIENTS) assert.equal(await canExecute(db, role, 'public.skip_swap_cooldown()'), false, role)
  assert.equal(await publicCanExecute(db, 'public.skip_swap_cooldown()'), false)

  for (const role of CLIENTS) {
    await assert.rejects(asRole(db, role, 'SELECT public.skip_swap_cooldown()', [], A), /permission denied/, role)
  }
  assert.deepEqual(await snapshot(db), before)
  await db.close()
})

test('keeps the function, its body, the cooldown, the ledger and swap_history exactly as they were', async () => {
  const db = await hostedLike()
  const functionsBefore = await overloads(db)
  const dataBefore = await snapshot(db)
  await retire(db)

  const functionsAfter = await overloads(db)
  assert.deepEqual(functionsAfter.map(f => [f.sig, f.prosrc]), functionsBefore.map(f => [f.sig, f.prosrc]))
  assert.match(functionsAfter[0].note, /^RETIRED \(SWAP RETIRE-2\)/)
  assert.deepEqual(await snapshot(db), dataBefore)
  assert.equal(dataBefore.history.length, 2)
  assert.ok(dataBefore.profile[0].swap_cooldown_until, 'the cooldown column keeps its value')
  await db.close()
})

test('revokes every overload that actually exists, by its real signature', async () => {
  const db = await hostedLike()
  // An overload the repository never defined: hosted could have one.
  await db.exec(`CREATE FUNCTION public.skip_swap_cooldown(p_cost integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION public.skip_swap_cooldown(integer) TO PUBLIC, anon, authenticated;`)
  await retire(db)

  const sigs = (await overloads(db)).map(f => f.sig)
  assert.deepEqual(sigs, ['skip_swap_cooldown()', 'skip_swap_cooldown(integer)'])
  for (const sig of sigs) {
    for (const role of CLIENTS) assert.equal(await canExecute(db, role, `public.${sig}`), false, `${role} ${sig}`)
    assert.equal(await publicCanExecute(db, `public.${sig}`), false, sig)
  }
  await db.close()
})

test('leaves service_role as it was and can run twice', async () => {
  const db = await hostedLike()
  const before = await canExecute(db, 'service_role', 'public.skip_swap_cooldown()')
  await retire(db)
  await retire(db)
  assert.equal(await canExecute(db, 'service_role', 'public.skip_swap_cooldown()'), before)
  assert.equal(await canExecute(db, 'authenticated', 'public.skip_swap_cooldown()'), false)
  await db.close()
})

test('does nothing on a database without the function', async () => {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()
  await db.exec(await readFile(STUBS, 'utf8'))
  await retire(db)
  assert.deepEqual(await overloads(db), [])
  await db.close()
})

test('is additive: no drop, delete, update, insert, truncate, alter or grant', async () => {
  const sql = (await readFile(RETIRE, 'utf8')).replace(/--.*$/gm, '')
  // The statements it runs are format() templates; the COMMENT text is prose.
  const templates = [...sql.matchAll(/format\(\s*'([^']*)'/g)].map(match => match[1])
  assert.deepEqual(templates, ['REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated', 'COMMENT ON FUNCTION %s IS %L'])
  const statements = sql.replace(/'(?:[^']|'')*'/g, "''")
  assert.doesNotMatch(statements, /\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER|GRANT|CREATE)\b/i)
})
