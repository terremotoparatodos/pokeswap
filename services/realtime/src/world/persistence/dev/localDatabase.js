import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * LOCAL/TEST ONLY: an embedded Postgres (PGlite) with the Supabase stubs and
 * the real WORLD × SKILLS migrations (tables + feature gate) applied.
 *
 * Used by the realtime tests and by the LAN test stack, so settlement,
 * idempotency, RLS and restarts run against the same SQL production will run,
 * without touching any Supabase project. `dataDir` null = in memory; a path =
 * persisted on disk (what the restart tests and the LAN stack use).
 *
 * PGlite is a devDependency: this module is only ever imported dynamically,
 * outside production (see worldConfig.js).
 */
const STUBS = new URL('./supabaseStubs.sql', import.meta.url)
// In order: the WORLD x SKILLS tables and functions, then its feature gate.
const MIGRATIONS = [
  new URL('../../../../../../supabase/migrations/20260926002154_world_skills_authority.sql', import.meta.url),
  new URL('../../../../../../supabase/migrations/20260926002207_world_skills_gate.sql', import.meta.url),
]

export async function openLocalDatabase(dataDir = null) {
  const { PGlite } = await import('@electric-sql/pglite')
  if (dataDir) await mkdir(dirname(dataDir), { recursive: true })
  const db = dataDir ? new PGlite(dataDir) : new PGlite()
  await db.exec(await readFile(fileURLToPath(STUBS), 'utf8'))
  for (const migration of MIGRATIONS) await db.exec(await readFile(fileURLToPath(migration), 'utf8'))
  return db
}

/**
 * Runs `sql` as a given database role, the way Supabase would: `service_role`
 * for the Edge Function, `authenticated` (with a user id) or `anon` for a
 * browser talking to PostgREST directly.
 */
const ROLES = new Set(['anon', 'authenticated', 'service_role'])

export async function asRole(db, role, sql, params = [], userId = null) {
  if (!ROLES.has(role)) throw new Error(`unknown role ${role}`)
  return db.transaction(async tx => {
    await tx.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [userId ?? ''])
    await tx.exec(`SET LOCAL ROLE ${role}`)
    return tx.query(sql, params)
  })
}

/** What the Edge Function does: every call as service_role. */
export const serviceQuery = db => (sql, params) => asRole(db, 'service_role', sql, params)
