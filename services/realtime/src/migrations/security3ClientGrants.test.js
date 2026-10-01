import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { asRole } from '../world/persistence/dev/localDatabase.js'

// SECURITY-3: the real migration that closes client DML on pokemon_xp and
// pokedex_entries and client EXECUTE on the market and latent RPCs, on an
// embedded Postgres. It lives here because this package holds the
// repository's only PGlite harness; it touches no WORLD code.
//
// Two starting points:
//   - hostedLike(): production as the repository knows it — the RC-0.3
//     schema/ACL mirror read from the production catalog, the migrations
//     production already ran, and pokemon_xp/pokedex_entries with the own-row
//     write access production shows;
//   - fromScratch(): a minimal pre-migration baseline plus EVERY file in
//     supabase/migrations, in version order. This is the guard: any migration,
//     present or future, that hands these objects back to clients fails it.

const repo = path => fileURLToPath(new URL(`../../../../${path}`, import.meta.url))
const MIGRATIONS_DIR = repo('supabase/migrations')
const STUBS = fileURLToPath(new URL('../world/persistence/dev/supabaseStubs.sql', import.meta.url))
const MIRROR = repo('scripts/integration/rc03-staging/01_prod_mirror.sql')
const MIRROR_FUNCTIONS = repo('scripts/integration/rc03-staging/02_prod_mirror_functions.sql')
const VIOLATIONS = repo('scripts/security-3/client-grants-violations.sql')
const SECURITY3_FILE = '20261001020637_security3_close_client_writes.sql'
const SECURITY3 = `${MIGRATIONS_DIR}/${SECURITY3_FILE}`
const migration = name => `${MIGRATIONS_DIR}/${name}`

const A = '11111111-1111-4111-8111-111111111111'
const B = '22222222-2222-4222-8222-222222222222'
const CLIENTS = ['anon', 'authenticated']
const KEEPERS = ['postgres', 'service_role']
const DML = ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
const TABLES = ['pokemon_xp', 'pokedex_entries']
const MARKET = ['buy_market_listing', 'publish_market_listing', 'cancel_market_listing']
const LATENT = ['grant_pokemon_xp', 'spend_tokens_learn_move', 'register_pokemon', 'record_pokemon_seen', 'bulk_record_pokemon_seen', 'collect_passive_tokens']
const CLOSED_FUNCTIONS = [...MARKET, ...LATENT]

// The migrations production ran after the catalog was mirrored (2026-09-25).
const HOSTED_SINCE_MIRROR = [
  '20260926001322_slots_client_write_revoke.sql',
  '20260926001502_market_require_session.sql',
  '20260926002154_world_skills_authority.sql',
  '20260926002207_world_skills_gate.sql',
]

// pokemon_xp and pokedex_entries as production shows them (BACKEND_INVENTORY §1.8-1.9, §2.1):
// RLS on, own-row SELECT/INSERT/UPDATE/DELETE policies, Supabase default grants (arwdDxtm).
const PROGRESSION_TABLES = `
  CREATE TABLE public.pokemon_xp (user_id uuid NOT NULL, pokemon_id integer NOT NULL, xp integer NOT NULL DEFAULT 0,
    level integer NOT NULL DEFAULT 1, moves jsonb, last_updated_at timestamptz, PRIMARY KEY (user_id, pokemon_id));
  CREATE TABLE public.pokedex_entries (user_id uuid NOT NULL, pokemon_id integer NOT NULL, registered_at timestamptz,
    PRIMARY KEY (user_id, pokemon_id));
  ALTER TABLE public.pokemon_xp ENABLE ROW LEVEL SECURITY;
  ALTER TABLE public.pokedex_entries ENABLE ROW LEVEL SECURITY;
  CREATE POLICY xp_own ON public.pokemon_xp FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  CREATE POLICY dex_own ON public.pokedex_entries FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
`

const SEED = `
  INSERT INTO auth.users VALUES ('${A}'), ('${B}');
  INSERT INTO public.profiles (id, username, tokens) VALUES ('${A}', 'trainer_a', 5000), ('${B}', 'trainer_b', 300);
  INSERT INTO public.slots (pokemon_id, owner_id, owner_username) VALUES (1, '${A}', 'trainer_a'), (4, '${B}', 'trainer_b');
  INSERT INTO public.pokemon_xp (user_id, pokemon_id, xp, level, moves) VALUES ('${A}', 1, 120, 4, '["tackle"]'), ('${B}', 4, 8, 2, NULL);
  INSERT INTO public.pokedex_entries (user_id, pokemon_id, registered_at) VALUES ('${A}', 1, now()), ('${A}', 7, NULL), ('${B}', 4, now());
  INSERT INTO public.market_listings (pokemon_id, seller_id, seller_username, price_tokens, expires_at)
    VALUES (1, '${A}', 'trainer_a', 500, now() + interval '1 day');
  INSERT INTO public.token_ledger (user_id, amount, reason) VALUES ('${A}', 5000, 'seed');
`

/** Supabase roles, auth and worst-case default privileges; `slots` comes from the mirror instead. */
async function pglite() {
  const { PGlite } = await import('@electric-sql/pglite')
  const db = new PGlite()
  await db.exec(await readFile(STUBS, 'utf8'))
  await db.exec('DROP TABLE public.slots')
  return db
}

const run = async (db, file) => db.exec(await readFile(file, 'utf8'))
const security3 = db => run(db, SECURITY3)

async function hostedLike() {
  const db = await pglite()
  await run(db, MIRROR)
  await run(db, MIRROR_FUNCTIONS)
  for (const name of HOSTED_SINCE_MIRROR) await run(db, migration(name))
  await db.exec(PROGRESSION_TABLES)
  await db.exec(SEED)
  return db
}

/** A database production never had: the latent RPCs of 005/008/009 created as a fresh install would. */
async function hostedWithLatent() {
  const db = await hostedLike()
  for (const name of ['20260907_005_token_economy_rpcs.sql', '20260907_008_progression_xp_authority.sql', '20260908_009_pokedex_authority.sql']) {
    await run(db, migration(name))
  }
  return db
}

// Objects the repository's migrations expect but never create (they predate it).
const SCRATCH_BASELINE = `
  CREATE TABLE public.kofi_payments (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
  CREATE FUNCTION public.reset_daily_free_claim() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  CREATE FUNCTION public.check_rate_limit(uuid, text, integer, integer) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
  CREATE FUNCTION public.cleanup_rate_limits() RETURNS void LANGUAGE sql AS $$ SELECT $$;
  -- 007 adds this constraint; the mirror already has it because production ran 007.
  ALTER TABLE public.profiles DROP CONSTRAINT profiles_username_min_length;
  CREATE TABLE public.pokemon_xp (user_id uuid NOT NULL, pokemon_id integer NOT NULL, xp integer NOT NULL DEFAULT 0,
    moves jsonb, PRIMARY KEY (user_id, pokemon_id));
  CREATE TABLE public.pokedex_entries (user_id uuid NOT NULL, pokemon_id integer NOT NULL, registered_at timestamptz,
    PRIMARY KEY (user_id, pokemon_id));
`

async function migrationFiles() {
  return (await readdir(MIGRATIONS_DIR)).filter(f => f.endsWith('.sql')).sort()
}

/** Pre-migration baseline + every versioned migration, in order; `extra` SQL runs last. */
async function fromScratch(extra = null) {
  const db = await pglite()
  await run(db, MIRROR)
  await run(db, MIRROR_FUNCTIONS)
  await db.exec(SCRATCH_BASELINE)
  for (const name of await migrationFiles()) {
    try {
      await run(db, migration(name))
    } catch (err) {
      throw new Error(`${name} does not apply on the from-scratch baseline (extend SCRATCH_BASELINE if it needs a pre-existing object): ${err.message}`)
    }
  }
  if (extra) await db.exec(extra)
  return db
}

async function violations(db) {
  return (await db.query(await readFile(VIOLATIONS, 'utf8'))).rows
}

async function signatures(db, names = CLOSED_FUNCTIONS) {
  const { rows } = await db.query(`SELECT p.oid::regprocedure::text AS sig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = ANY($1) ORDER BY 1`, [names])
  return rows.map(r => r.sig)
}

async function can(db, role, sig) {
  return (await db.query(`SELECT has_function_privilege($1, $2::regprocedure, 'EXECUTE') AS ok`, [role, `public.${sig}`])).rows[0].ok
}

async function tablePrivileges(db, role, table) {
  const privs = {}
  for (const p of ['SELECT', ...DML]) {
    privs[p] = (await db.query(`SELECT has_table_privilege($1, $2, $3) AS ok`, [role, `public.${table}`, p])).rows[0].ok
  }
  return privs
}

/** Every ACL in public: tables, columns, functions. Used to prove idempotency and keeper preservation. */
async function acls(db) {
  const { rows } = await db.query(`
    SELECT 'rel ' || c.relname AS obj, coalesce(c.relacl::text, 'default') AS acl FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'v', 'p')
    UNION ALL
    SELECT 'col ' || c.relname || '.' || a.attname, a.attacl::text FROM pg_attribute a JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND a.attacl IS NOT NULL
    UNION ALL
    SELECT 'fn ' || p.oid::regprocedure::text, coalesce(p.proacl::text, 'default') FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
    ORDER BY 1`)
  return rows
}

/** Every function definition, policy, column and row the migration must not change. */
async function definitionsAndData(db) {
  const q = async sql => (await db.query(sql)).rows
  return {
    functions: await q(`SELECT p.oid::regprocedure::text AS sig, p.prosrc, p.prosecdef, p.proconfig, p.proowner::regrole::text AS owner,
      obj_description(p.oid, 'pg_proc') AS note FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' ORDER BY 1`),
    policies: await q(`SELECT tablename, policyname, cmd, roles::text, qual, with_check FROM pg_policies WHERE schemaname = 'public' ORDER BY 1, 2`),
    columns: await q(`SELECT table_name, column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' ORDER BY 1, 2`),
    xp: await q('SELECT * FROM public.pokemon_xp ORDER BY user_id, pokemon_id'),
    dex: await q('SELECT * FROM public.pokedex_entries ORDER BY user_id, pokemon_id'),
    slots: await q('SELECT * FROM public.slots ORDER BY pokemon_id'),
    profiles: await q('SELECT * FROM public.profiles ORDER BY id'),
    listings: await q('SELECT * FROM public.market_listings ORDER BY id'),
    ledger: await q('SELECT * FROM public.token_ledger ORDER BY id'),
    transactions: await q('SELECT * FROM public.transactions ORDER BY id'),
  }
}

// ── Before: what production allows today ──────────────────────────────────────

test('before: a signed-in user can write their own XP and Pokédex, and call the market RPCs', async () => {
  const db = await hostedLike()
  await asRole(db, 'authenticated', `UPDATE public.pokemon_xp SET xp = 999999, level = 100 WHERE pokemon_id = 1`, [], A)
  await asRole(db, 'authenticated', `INSERT INTO public.pokedex_entries VALUES ($1, 150, now())`, [A], A)
  await asRole(db, 'authenticated', `DELETE FROM public.pokedex_entries WHERE pokemon_id = 7`, [], A)
  assert.equal((await db.query(`SELECT xp FROM public.pokemon_xp WHERE user_id = $1`, [A])).rows[0].xp, 999999)
  for (const fn of MARKET) for (const sig of await signatures(db, [fn])) assert.equal(await can(db, 'authenticated', sig), true, sig)
  assert.notDeepEqual(await violations(db), [])
  await db.close()
})

// ── After: tables ────────────────────────────────────────────────────────────

test('after: anon and authenticated cannot INSERT, UPDATE, DELETE or TRUNCATE either table', async () => {
  const db = await hostedLike()
  const before = await definitionsAndData(db)
  await security3(db)

  const attempts = {
    pokemon_xp: [
      `INSERT INTO public.pokemon_xp (user_id, pokemon_id, xp) VALUES ('${A}', 25, 1)`,
      `UPDATE public.pokemon_xp SET xp = 999999 WHERE pokemon_id = 1`,
      `UPDATE public.pokemon_xp SET moves = '["hyper-beam"]' WHERE pokemon_id = 1`,
      `DELETE FROM public.pokemon_xp WHERE pokemon_id = 1`,
      `TRUNCATE public.pokemon_xp`,
    ],
    pokedex_entries: [
      `INSERT INTO public.pokedex_entries VALUES ('${A}', 150, now())`,
      `UPDATE public.pokedex_entries SET registered_at = now() WHERE pokemon_id = 7`,
      `DELETE FROM public.pokedex_entries WHERE pokemon_id = 7`,
      `TRUNCATE public.pokedex_entries`,
    ],
  }
  for (const role of CLIENTS) {
    for (const [table, sqls] of Object.entries(attempts)) {
      for (const sql of sqls) await assert.rejects(asRole(db, role, sql, [], A), /permission denied/, `${role}: ${sql}`)
      const privs = await tablePrivileges(db, role, table)
      for (const p of DML) assert.equal(privs[p], false, `${role} ${p} ${table}`)
    }
  }
  assert.deepEqual(await violations(db), [])
  assert.deepEqual(await definitionsAndData(db), before)
  await db.close()
})

test('after: SELECT is exactly as before for every role, and own rows still read', async () => {
  const db = await hostedLike()
  const before = {}
  for (const role of [...CLIENTS, ...KEEPERS]) for (const t of TABLES) before[`${role} ${t}`] = (await tablePrivileges(db, role, t)).SELECT
  await security3(db)
  for (const role of [...CLIENTS, ...KEEPERS]) for (const t of TABLES) {
    assert.equal((await tablePrivileges(db, role, t)).SELECT, before[`${role} ${t}`], `${role} SELECT ${t}`)
  }
  assert.equal(before['authenticated pokemon_xp'], true)
  const xp = await asRole(db, 'authenticated', 'SELECT pokemon_id, xp FROM public.pokemon_xp', [], A)
  assert.deepEqual(xp.rows, [{ pokemon_id: 1, xp: 120 }])
  const dex = await asRole(db, 'authenticated', 'SELECT pokemon_id FROM public.pokedex_entries ORDER BY 1', [], A)
  assert.deepEqual(dex.rows.map(r => r.pokemon_id), [1, 7])
  await db.close()
})

test('after: column-level INSERT/UPDATE grants to clients are revoked as well', async () => {
  const db = await hostedLike()
  await db.exec(`REVOKE ALL ON public.pokemon_xp FROM anon, authenticated;
    GRANT SELECT ON public.pokemon_xp TO anon, authenticated;
    GRANT UPDATE (xp, moves) ON public.pokemon_xp TO authenticated;
    GRANT INSERT (user_id, pokemon_id, registered_at) ON public.pokedex_entries TO PUBLIC;`)
  assert.ok((await violations(db)).some(v => v.kind === 'column'))
  await security3(db)
  await assert.rejects(asRole(db, 'authenticated', `UPDATE public.pokemon_xp SET xp = 1 WHERE pokemon_id = 1`, [], A), /permission denied/)
  assert.deepEqual(await violations(db), [])
  await db.close()
})

test('after: service_role and postgres keep their table privileges', async () => {
  const db = await hostedLike()
  const before = {}
  for (const role of KEEPERS) for (const t of TABLES) before[`${role} ${t}`] = await tablePrivileges(db, role, t)
  await security3(db)
  for (const role of KEEPERS) for (const t of TABLES) assert.deepEqual(await tablePrivileges(db, role, t), before[`${role} ${t}`], `${role} ${t}`)
  assert.equal(before['service_role pokemon_xp'].UPDATE, true)
  await asRole(db, 'service_role', `UPDATE public.pokemon_xp SET xp = xp WHERE pokemon_id = 1`)
  await db.close()
})

test('after: a keeper that only held table DML through PUBLIC keeps it', async () => {
  const db = await hostedLike()
  await db.exec(`REVOKE ALL ON public.pokedex_entries FROM service_role; GRANT SELECT ON public.pokedex_entries TO service_role;
    GRANT INSERT, UPDATE ON public.pokedex_entries TO PUBLIC;`)
  assert.equal((await tablePrivileges(db, 'service_role', 'pokedex_entries')).UPDATE, true, 'through PUBLIC only')
  await security3(db)
  const privs = await tablePrivileges(db, 'service_role', 'pokedex_entries')
  assert.equal(privs.INSERT, true)
  assert.equal(privs.UPDATE, true)
  assert.equal(privs.DELETE, false, 'nothing is added that the keeper did not have')
  assert.deepEqual(await violations(db), [])
  await db.close()
})

// ── After: market RPCs ──────────────────────────────────────────────────────

test('after: clients cannot execute any market RPC overload; a call is refused before it runs', async () => {
  const db = await hostedLike()
  // An overload the repository never defined, open to PUBLIC: hosted could have one.
  await db.exec(`CREATE FUNCTION public.buy_market_listing(p_listing_id uuid, p_max_price integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION public.buy_market_listing(uuid, integer) TO PUBLIC;`)
  const before = await definitionsAndData(db)
  await security3(db)

  const sigs = await signatures(db, MARKET)
  assert.deepEqual(sigs, ['buy_market_listing(uuid)', 'buy_market_listing(uuid,integer)', 'cancel_market_listing(uuid)', 'publish_market_listing(integer,integer)'])
  for (const sig of sigs) for (const role of CLIENTS) assert.equal(await can(db, role, sig), false, `${role} ${sig}`)

  const listing = before.listings[0].id
  for (const role of CLIENTS) {
    await assert.rejects(asRole(db, role, 'SELECT public.buy_market_listing($1::uuid)', [listing], B), /permission denied/)
    await assert.rejects(asRole(db, role, 'SELECT public.cancel_market_listing($1::uuid)', [listing], A), /permission denied/)
    await assert.rejects(asRole(db, role, 'SELECT public.publish_market_listing(1, 10)', [], A), /permission denied/)
  }
  assert.deepEqual(await definitionsAndData(db), before)
  assert.deepEqual(await violations(db), [])
  await db.close()
})

test('after: service_role and postgres keep EXECUTE, even where it only came through PUBLIC', async () => {
  const db = await hostedLike()
  await db.exec(`CREATE FUNCTION public.cancel_market_listing(p_listing_id uuid, p_reason text) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    REVOKE ALL ON FUNCTION public.cancel_market_listing(uuid, text) FROM PUBLIC, anon, authenticated, service_role;
    GRANT EXECUTE ON FUNCTION public.cancel_market_listing(uuid, text) TO PUBLIC;`)
  const before = {}
  for (const sig of await signatures(db, MARKET)) for (const role of KEEPERS) before[`${role} ${sig}`] = await can(db, role, sig)
  assert.equal(before['service_role cancel_market_listing(uuid,text)'], true, 'through PUBLIC only')
  await security3(db)
  for (const sig of await signatures(db, MARKET)) for (const role of KEEPERS) {
    assert.equal(await can(db, role, sig), before[`${role} ${sig}`], `${role} ${sig}`)
  }
  for (const sig of await signatures(db, MARKET)) assert.equal(await can(db, 'service_role', sig), true, sig)
  await db.close()
})

// ── Latent RPCs ─────────────────────────────────────────────────────────────

test('latent RPCs present (fresh-install shape): every overload is revoked from clients, keepers preserved', async () => {
  const db = await hostedWithLatent()
  await db.exec(`CREATE FUNCTION public.grant_pokemon_xp(p_pokemon_id integer, p_xp_amount integer) RETURNS jsonb LANGUAGE sql AS $$ SELECT '{}'::jsonb $$;
    GRANT EXECUTE ON FUNCTION public.grant_pokemon_xp(integer, integer) TO anon;`)
  const sigs = await signatures(db, LATENT)
  assert.equal(sigs.length, 7)
  for (const sig of sigs) assert.equal(await can(db, 'authenticated', sig) || await can(db, 'anon', sig), true, `${sig} open before`)
  const keepersBefore = {}
  for (const sig of sigs) for (const role of KEEPERS) keepersBefore[`${role} ${sig}`] = await can(db, role, sig)
  const before = await definitionsAndData(db)

  await security3(db)

  for (const sig of sigs) {
    for (const role of CLIENTS) assert.equal(await can(db, role, sig), false, `${role} ${sig}`)
    for (const role of KEEPERS) assert.equal(await can(db, role, sig), keepersBefore[`${role} ${sig}`], `${role} ${sig}`)
  }
  await assert.rejects(asRole(db, 'authenticated', 'SELECT public.grant_pokemon_xp(1, 999999, $$dungeon$$)', [], A), /permission denied/)
  await assert.rejects(asRole(db, 'authenticated', 'SELECT public.collect_passive_tokens()', [], A), /permission denied/)
  await assert.rejects(asRole(db, 'authenticated', 'SELECT public.register_pokemon(150)', [], A), /permission denied/)
  assert.deepEqual(await definitionsAndData(db), before)
  assert.deepEqual(await violations(db), [])
  await db.close()
})

test('latent RPCs absent (hosted today): the migration passes and creates none of them', async () => {
  const db = await hostedLike()
  assert.deepEqual(await signatures(db, LATENT), [])
  await security3(db)
  assert.deepEqual(await signatures(db, LATENT), [])
  await db.close()
})

test('everything absent: no tables, no functions — the migration still passes and creates nothing', async () => {
  const db = await pglite()
  const before = await acls(db)
  await security3(db)
  assert.deepEqual(await acls(db), before)
  assert.deepEqual(await signatures(db), [])
  assert.equal((await db.query(`SELECT count(*)::int AS n FROM pg_class WHERE relname = ANY($1)`, [TABLES])).rows[0].n, 0)
  await db.close()
})

// ── Idempotency and non-destruction ─────────────────────────────────────────

test('running it twice gives the same ACLs, definitions and data as running it once', async () => {
  const db = await hostedWithLatent()
  await security3(db)
  const once = { acls: await acls(db), state: await definitionsAndData(db) }
  await security3(db)
  assert.deepEqual({ acls: await acls(db), state: await definitionsAndData(db) }, once)
  await db.close()
})

test('only client ACLs change: every other ACL entry in public is untouched', async () => {
  const db = await hostedWithLatent()
  // ACL items without anon, authenticated and PUBLIC (the empty grantee).
  const strip = rows => rows.map(r => ({
    obj: r.obj,
    acl: r.acl.replace(/^\{|\}$/g, '').split(',').filter(item => !/^(anon|authenticated)?=/.test(item)).sort(),
  }))
  const before = await acls(db)
  await security3(db)
  const after = await acls(db)
  // Objects outside the closed set: identical ACLs.
  const touched = o => TABLES.some(t => o === `rel ${t}` || o.startsWith(`col ${t}.`)) || CLOSED_FUNCTIONS.some(f => o.startsWith(`fn ${f}(`))
  assert.deepEqual(after.filter(r => !touched(r.obj)), before.filter(r => !touched(r.obj)))
  // Closed objects: identical once client and PUBLIC entries are removed.
  assert.deepEqual(strip(after.filter(r => touched(r.obj) && r.acl !== 'default')), strip(before.filter(r => touched(r.obj) && r.acl !== 'default')))
  await db.close()
})

test('the migration is additive: only catalog-driven REVOKEs and keeper re-GRANTs', async () => {
  const sql = (await readFile(SECURITY3, 'utf8')).replace(/--.*$/gm, '')
  const templates = [...sql.matchAll(/format\(\s*'([^']*)'/g)].map(m => m[1])
  assert.deepEqual(templates, [
    'public.%I',
    'REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON TABLE %s FROM PUBLIC, anon, authenticated',
    'GRANT %s ON TABLE %s TO %I',
    'REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated',
    'GRANT EXECUTE ON FUNCTION %s TO %I',
  ])
  // Re-GRANTs only ever target a keeper role.
  assert.match(sql, /keepers\s+constant text\[\] := ARRAY\['postgres', 'service_role'\]/)
  const statements = sql.replace(/'(?:[^']|'')*'/g, "''")
  assert.doesNotMatch(statements, /\b(DROP|DELETE|UPDATE|INSERT|TRUNCATE|ALTER|CREATE|COMMENT|SECURITY DEFINER)\b/i)
})

// ── Guard: the final state of a fresh install, and every other migration ───

test('guard: a fresh install from every versioned migration ends with no client writes or EXECUTE', async () => {
  const db = await fromScratch()
  // The latent RPCs exist in a fresh install, so this exercises them for real.
  assert.equal((await signatures(db, LATENT)).length, 6)
  assert.equal((await signatures(db, MARKET)).length, 3)
  assert.deepEqual(await violations(db), [])
  for (const sig of await signatures(db)) assert.equal(await can(db, 'service_role', sig), true, `service_role ${sig}`)
  await db.close()
})

test('guard: the fresh-install check notices a later migration that re-grants', async () => {
  const regrants = [
    'GRANT EXECUTE ON FUNCTION public.buy_market_listing(uuid) TO authenticated;',
    'GRANT EXECUTE ON FUNCTION public.grant_pokemon_xp(integer, integer, text) TO PUBLIC;',
    'GRANT UPDATE ON public.pokemon_xp TO authenticated;',
    'GRANT INSERT (pokemon_id) ON public.pokedex_entries TO anon;',
    'GRANT TRUNCATE ON public.pokedex_entries TO PUBLIC;',
    'GRANT ALL ON ALL FUNCTIONS IN SCHEMA public TO anon;',
  ]
  for (const sql of regrants) {
    const db = await fromScratch(sql)
    assert.notDeepEqual(await violations(db), [], sql)
    await db.close()
  }
})

/** Statements that would hand a closed object back to clients if a migration other than SECURITY-3 ran them after it. */
const CLIENT = String.raw`(?:PUBLIC|anon|authenticated)`
const CLOSED_NAME = String.raw`(?:${[...TABLES, ...CLOSED_FUNCTIONS].join('|')})`
const REGRANT_RULES = [
  new RegExp(String.raw`\bGRANT\b[^;]*\b${CLOSED_NAME}\b[^;]*\bTO\b[^;]*\b${CLIENT}\b`, 'i'),
  new RegExp(String.raw`\bGRANT\b[^;]*\bON\s+ALL\s+(?:TABLES|FUNCTIONS|ROUTINES)\s+IN\s+SCHEMA\b[^;]*\bTO\b[^;]*\b${CLIENT}\b`, 'i'),
  new RegExp(String.raw`\bALTER\s+DEFAULT\s+PRIVILEGES\b[^;]*\bGRANT\b[^;]*\bTO\b[^;]*\b${CLIENT}\b`, 'i'),
  // Re-creating a closed object picks up Supabase's default grants to clients.
  new RegExp(String.raw`\b(?:CREATE|DROP)\s+(?:OR\s+REPLACE\s+)?(?:FUNCTION|TABLE)\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:public\.)?${CLOSED_NAME}\b`, 'i'),
]
const stripSqlComments = sql => sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--.*$/gm, '')

/** Historical migrations that granted these objects before SECURITY-3 (left untouched on purpose). */
const HISTORICAL_GRANTORS = [
  '20260907_001_publish_market_listing.sql',
  '20260907_002_cancel_market_listing.sql',
  '20260907_003_buy_market_listing.sql',
  '20260907_005_token_economy_rpcs.sql',
  '20260907_008_progression_xp_authority.sql',
  '20260908_009_pokedex_authority.sql',
  '20260926001502_market_require_session.sql',
]

function regrantFindings(files) {
  const findings = []
  for (const { name, sql } of files) {
    if (name === SECURITY3_FILE) continue
    const code = stripSqlComments(sql)
    const hit = REGRANT_RULES.filter(r => r.test(code))
    if (hit.length === 0) continue
    if (HISTORICAL_GRANTORS.includes(name) && name < SECURITY3_FILE) continue
    findings.push(`${name}: ${hit.map(String).join(', ')}`)
  }
  return findings
}

test('guard: no migration other than the historical ones grants, re-creates or re-opens a closed object', async () => {
  const files = await Promise.all((await migrationFiles()).map(async name => ({ name, sql: await readFile(migration(name), 'utf8') })))
  assert.deepEqual(regrantFindings(files), [])
  // SECURITY-3 runs after every migration that touches a closed object.
  const touching = files.filter(f => new RegExp(String.raw`\b${CLOSED_NAME}\b`).test(stripSqlComments(f.sql))).map(f => f.name)
  assert.equal(touching.sort().at(-1), SECURITY3_FILE)
  // The historical grantors are exactly what is on disk: none renamed past SECURITY-3.
  for (const name of HISTORICAL_GRANTORS) assert.ok(files.some(f => f.name === name), name)
})

test('guard: the static rules catch re-grants, schema-wide grants and re-created objects', () => {
  const mutants = [
    'GRANT EXECUTE ON FUNCTION public.publish_market_listing(integer, integer) TO authenticated;',
    'grant execute on function collect_passive_tokens() to anon, service_role;',
    'GRANT INSERT, UPDATE ON TABLE public.pokemon_xp TO authenticated;',
    'GRANT ALL ON ALL TABLES IN SCHEMA public TO anon;',
    'ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;',
    'DROP FUNCTION IF EXISTS public.register_pokemon(integer);',
    'CREATE OR REPLACE FUNCTION public.bulk_record_pokemon_seen(p integer[]) RETURNS void LANGUAGE sql AS $$ SELECT $$;',
    'CREATE TABLE IF NOT EXISTS public.pokedex_entries (user_id uuid);',
  ]
  for (const sql of mutants) {
    assert.equal(regrantFindings([{ name: '20991231000000_future.sql', sql }]).length, 1, sql)
    // An old-versioned file added later (out of order) is not excused either.
    assert.equal(regrantFindings([{ name: '20260101000000_backfilled.sql', sql }]).length, 1, sql)
  }
  // Allowed: service_role grants, revokes, comments.
  for (const sql of [
    'GRANT EXECUTE ON FUNCTION public.buy_market_listing(uuid) TO service_role;',
    'REVOKE EXECUTE ON FUNCTION public.grant_pokemon_xp(integer, integer, text) FROM authenticated;',
    '-- GRANT EXECUTE ON FUNCTION public.buy_market_listing(uuid) TO authenticated;',
  ]) assert.deepEqual(regrantFindings([{ name: '20991231000000_future.sql', sql }]), [], sql)
})
