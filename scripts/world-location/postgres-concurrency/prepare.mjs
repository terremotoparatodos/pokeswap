// WORLD LOCATION-4 F2 — prepares an isolated LOCAL Supabase stack for the battery (README.md).
//
//   node scripts/world-location/postgres-concurrency/prepare.mjs init --dir <folder outside the repo>
//        --project-id <id> --port-prefix <3 digits, e.g. 561> [--db-only]
//   node scripts/world-location/postgres-concurrency/prepare.mjs migrate --container supabase_db_<id>
//        --build original|rv1|rv2
//
// init: `supabase init` in a new folder, its own project_id and ports (so it never collides with
// another local stack), and the prod-mirror files of scripts/integration/rc03-staging as its only
// migrations (`supabase start` applies them). Without --db-only it also copies world-authority, for
// the full staging gate. It prints the `supabase start` command; it does not start anything.
//
// migrate: applies the staging migrations in hosted order (localDatabase.mjs MIGRATION_ORDER) to a
// FRESH local database. With --build rv1|rv2 the ordering migration is mutated in memory (one exact
// replacement); the file in the repository keeps its bytes.

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { BUILDS, BlockedError, ROOT, applyMigrations, assertLocalContainer, liveBuild } from './localDatabase.mjs'

function flags(argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) throw new BlockedError(`unexpected ${argv[i]}`)
    const [key, inline] = argv[i].slice(2).split('=')
    out[key] = inline ?? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true)
  }
  return out
}

function init(f) {
  const dir = resolve(String(f.dir ?? ''))
  const inside = relative(ROOT, dir)
  if (!f.dir || !inside.startsWith('..') && !isAbsolute(inside)) throw new BlockedError('--dir must be a folder OUTSIDE the repository')
  if (!/^[a-z][a-z0-9-]{2,30}$/.test(String(f['project-id'] ?? ''))) throw new BlockedError('--project-id: lowercase letters, digits and dashes')
  if (!/^[1-6][0-9]{2}$/.test(String(f['port-prefix'] ?? '')) || f['port-prefix'] === '543') throw new BlockedError('--port-prefix: 3 digits, not 543 (the default stack)')
  if (existsSync(join(dir, 'supabase', 'config.toml'))) throw new BlockedError(`${dir} already has a Supabase project`)
  mkdirSync(dir, { recursive: true })
  // A fixed command line (no argument comes from the user); a shell resolves supabase(.cmd) on Windows.
  const r = spawnSync('supabase init --force', { cwd: dir, encoding: 'utf8', shell: true })
  if (r.status !== 0) throw new BlockedError(`supabase init failed: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`)
  const config = join(dir, 'supabase', 'config.toml')
  const prefix = String(f['port-prefix'])
  const text = readFileSync(config, 'utf8')
    .replace(/^project_id = ".*"$/m, `project_id = "${f['project-id']}"`)
    .replace(/= 543(\d\d)$/gm, `= ${prefix}$1`)
    .replace(/^inspector_port = \d+$/m, `inspector_port = ${8000 + Number(prefix)}`)
  writeFileSync(config, text)
  const migrations = join(dir, 'supabase', 'migrations')
  mkdirSync(migrations, { recursive: true })
  const mirror = join(ROOT, 'scripts', 'integration', 'rc03-staging')
  for (const [from, to] of [['01_prod_mirror.sql', '20260101000000_prod_mirror.sql'], ['02_prod_mirror_functions.sql', '20260101000001_prod_mirror_functions.sql']])
    writeFileSync(join(migrations, to), readFileSync(join(mirror, from), 'utf8').replace(/\r\n/g, '\n'))
  const exclude = ['studio', 'imgproxy', 'vector', 'logflare', 'mailpit', 'realtime', 'storage-api', 'postgres-meta', 'supavisor']
  if (f['db-only']) exclude.push('gotrue', 'kong', 'postgrest', 'edge-runtime')
  else cpSync(join(ROOT, 'supabase', 'functions', 'world-authority'), join(dir, 'supabase', 'functions', 'world-authority'), { recursive: true })
  console.log(`prepared ${dir} (project_id ${f['project-id']}, ports ${prefix}xx${f['db-only'] ? ', database only' : ''})`)
  console.log(`next:\n  cd ${dir} && supabase start -x ${exclude.join(',')}\n  node ${relative(process.cwd(), join(ROOT, 'scripts/world-location/postgres-concurrency/prepare.mjs'))} migrate --container supabase_db_${f['project-id']} --build <original|rv1|rv2>`)
}

function migrate(f) {
  if (!BUILDS.includes(f.build)) throw new BlockedError(`--build must be one of ${BUILDS.join(', ')}`)
  assertLocalContainer(f.container)
  let present = true
  try { liveBuild(f.container) } catch (e) { if (e instanceof BlockedError) present = false; else throw e }
  if (present) throw new BlockedError(`${f.container} already has the ordering functions: use a fresh stack (supabase db reset on THAT local project, or a new one)`)
  applyMigrations(f.container, f.build)
  const found = liveBuild(f.container)
  if (found !== f.build) throw new Error(`after migrating, ${f.container} runs ${found}, not ${f.build}`)
  console.log(`${f.container} now runs ${found}`)
}

try {
  const [command, ...rest] = process.argv.slice(2)
  const f = flags(rest)
  if (command === 'init') init(f)
  else if (command === 'migrate') migrate(f)
  else throw new BlockedError('usage: prepare.mjs init|migrate … (see the header)')
} catch (error) {
  console.error(`${error instanceof BlockedError ? 'BLOCKED' : 'FAILED'}: ${error.message}`)
  process.exitCode = 2
}
