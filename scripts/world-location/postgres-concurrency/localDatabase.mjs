// WORLD LOCATION-4 F2 — the LOCAL database a battery runs against, the migrations it needs, and the
// two negative controls (RV1, RV2) applied in memory to an isolated local database.
//
// Local only, by construction:
//   - the target is a container named `supabase_db_<project_id>` of a local Supabase stack;
//   - the Docker endpoint must be local (DOCKER_HOST unset, or a unix socket / Windows named pipe,
//     and the current context's endpoint likewise);
//   - nothing reads .env files, hosted URLs, keys or secrets; the connection is `psql -U postgres`
//     inside the container (local socket).

import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

export const ROOT = fileURLToPath(new URL('../../..', import.meta.url))
const MIGRATIONS = 'supabase/migrations/'
export const ORDERING_MIGRATION = '20261003120000_world_location_ordering'

/** What the staging stack needs on top of the prod mirror, in the order hosted applied them. */
export const MIGRATION_ORDER = [
  '20260926001322_slots_client_write_revoke', '20260926001502_market_require_session',
  '20260926002154_world_skills_authority', '20260926002207_world_skills_gate',
  '20260930230308_retire_skip_swap_cooldown', '20261001032040_security3_close_client_writes',
  '20261001051958_world_multi_yield', '20261001220000_world_player_locations', ORDERING_MIGRATION,
]

/**
 * The negative controls. Each one is a single exact replacement inside the ordering migration,
 * applied in memory only (the file keeps its bytes). `fn` names the SQL function whose stored body
 * (pg_proc.prosrc) proves which build a database runs.
 */
export const MUTANTS = {
  rv1: {
    title: 'activate without LOCK TABLE',
    fn: 'world_presence_activate',
    from: '  LOCK TABLE public.world_presence_hosts IN SHARE ROW EXCLUSIVE MODE;\n',
    to: '',
  },
  rv2: {
    title: 'keyed claim without FOR SHARE on its host row',
    fn: 'world_location_claim_keyed',
    from: "  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id FOR SHARE;\n  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;\n  IF h.state <> 'active'",
    to: "  SELECT * INTO h FROM public.world_presence_hosts WHERE generation = p_generation AND host_id = p_host_id;\n  IF NOT FOUND THEN RETURN jsonb_build_object('status', 'unknown_host'); END IF;\n  IF h.state <> 'active'",
  },
}
export const BUILDS = ['original', ...Object.keys(MUTANTS)]

/** A migration's text with LF line ends (a Windows checkout with core.autocrlf=true has CRLF). */
export function migrationText(name) {
  return readFileSync(`${ROOT}${MIGRATIONS}${name}.sql`, 'utf8').replace(/\r\n/g, '\n')
}
export const sha256 = text => createHash('sha256').update(text).digest('hex')

/** The SQL to apply for `name` in `build`: the file itself, or the file with one exact replacement. */
export function migrationFor(name, build = 'original') {
  const text = migrationText(name)
  if (build === 'original' || name !== ORDERING_MIGRATION) return text
  const mutant = MUTANTS[build]
  if (!mutant) throw new Error(`unknown build ${build}`)
  const matches = text.split(mutant.from).length - 1
  if (matches !== 1) throw new Error(`${build}: the replacement matches ${matches} times (expected exactly 1); the migration changed, update MUTANTS`)
  return text.replace(mutant.from, mutant.to)
}

export function assertLocalDocker() {
  const host = process.env.DOCKER_HOST
  if (host && !/^(unix|npipe):\/\//.test(host)) throw new BlockedError(`DOCKER_HOST=${host} is not a local socket: refusing`)
  const context = docker(['context', 'inspect', '--format', '{{.Endpoints.docker.Host}}'])
  if (context.status !== 0) throw new BlockedError(`Docker is not available: ${context.stderr.trim() || context.error?.message || 'docker context inspect failed'}`)
  const endpoint = context.stdout.trim()
  if (!/^(unix|npipe):\/\//.test(endpoint)) throw new BlockedError(`the Docker endpoint ${endpoint} is not local: refusing`)
}

/** The container exists, is a Supabase db container, runs, and answers SQL. */
export function assertLocalContainer(container) {
  if (!/^supabase_db_[A-Za-z0-9_-]+$/.test(container ?? '')) throw new BlockedError(`--container must name a local Supabase db container (supabase_db_<project_id>), got ${container ?? '(none)'}`)
  assertLocalDocker()
  const state = docker(['inspect', '--format', '{{.State.Running}}', container])
  if (state.status !== 0) throw new BlockedError(`container ${container} not found: start the local stack first (see the README)`)
  if (state.stdout.trim() !== 'true') throw new BlockedError(`container ${container} is not running`)
  const ping = psql(container, ['-tAc', 'SELECT 1'])
  if (ping.status !== 0 || ping.stdout.trim() !== '1') throw new BlockedError(`Postgres in ${container} does not answer: ${(ping.stderr || ping.stdout).trim()}`)
}

/** Which build the database runs, read from the stored function bodies. */
export function liveBuild(container) {
  const bodies = {}
  for (const fn of new Set(Object.values(MUTANTS).map(m => m.fn))) {
    const r = psql(container, ['-tAc', `SELECT prosrc FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname = '${fn}'`])
    if (r.status !== 0 || !r.stdout.trim()) throw new BlockedError(`${fn} is missing in ${container}: apply the migrations first (prepare.mjs migrate)`)
    bodies[fn] = r.stdout
  }
  const broken = Object.entries(MUTANTS).filter(([, m]) => !bodies[m.fn].includes(m.from)).map(([name]) => name)
  if (broken.length === 0) return 'original'
  if (broken.length === 1) return broken[0]
  return `unknown (${broken.join('+')} all missing)`
}

export function applyMigrations(container, build, log = console.log) {
  for (const name of MIGRATION_ORDER) {
    const text = migrationFor(name, build)
    const r = psql(container, ['-q', '-v', 'ON_ERROR_STOP=1', '--single-transaction', '-f', '-'], text)
    log(`${r.status === 0 ? 'applied' : 'FAILED '} ${name}  sha256=${sha256(text).slice(0, 16)}${name === ORDERING_MIGRATION && build !== 'original' ? `  (${build}: ${MUTANTS[build].title})` : ''}`)
    if (r.status !== 0) throw new Error(`${name}: ${(r.stderr || r.stdout).split('\n').filter(l => /ERROR/.test(l)).join(' | ')}`)
  }
}

export class BlockedError extends Error {}

function docker(args, input) {
  return spawnSync('docker', args, { encoding: 'utf8', input, maxBuffer: 64 * 1024 * 1024 })
}
function psql(container, args, input) {
  return docker(['exec', '-i', container, 'psql', '-U', 'postgres', '-d', 'postgres', '-X', ...args], input)
}
