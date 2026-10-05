import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

// CLOUD ENV-1: Colyseus Cloud delivers the dashboard variables only in `.env.cloud`. Each case runs
// the REAL src/index.js in a fresh process, from a temporary app directory, with only the variables
// given here (nothing inherited from the terminal). cloudEnvironment.hooks.mjs swaps
// realtimeServer.js for a probe that imports the same environment-capturing modules at the same
// point of the graph and reports what PresenceRoom and the world adapters captured. Values are
// synthetic; the secret is random per run and must never appear in the output.

const INDEX = fileURLToPath(new URL('./index.js', import.meta.url))
const HOOKS = new URL('./cloudEnvironment.hooks.mjs', import.meta.url).href
const PRELOAD = `data:text/javascript,import { register } from 'node:module'; register(${JSON.stringify(HOOKS)});`
const SECRET = `synthetic-${randomBytes(16).toString('hex')}`
const SECRET_SHA = createHash('sha256').update(SECRET).digest('hex')
const AUTHORITY_URL = 'http://127.0.0.1:9/functions/v1/world-authority'

// On Cloud, @colyseus/tools always loads the machine's /etc/environment (with override): a
// non-empty one cannot be isolated, and on a Cloud machine (whose build runs `npm test`) it would
// mean reading the real platform environment. Those cases are skipped there, never faked.
const platformEnvironment = existsSync('/etc/environment') && statSync('/etc/environment').size > 0
const cloudMachine = process.env.COLYSEUS_CLOUD !== undefined || process.env.APP_ROOT_PATH !== undefined
const cloudSkip = platformEnvironment || cloudMachine ? 'a non-empty /etc/environment (or a Cloud machine) cannot be isolated from @colyseus/tools' : false

const cloudFile = [
  'NODE_ENV=production',
  'WORLD_LOCATION_PERSISTENCE=shadow',
  `WORLD_AUTHORITY_URL=${AUTHORITY_URL}`,
  `WORLD_AUTHORITY_SECRET=${SECRET}`,
  'SUPABASE_URL=http://127.0.0.1:9',
  'SUPABASE_PUBLISHABLE_KEY=synthetic-publishable',
  'ALLOWED_ORIGINS=http://127.0.0.1:5173',
].join('\n')

const dirs = []
test.after(() => { for (const dir of dirs) rmSync(dir, { recursive: true, force: true }) })

/** A temporary app directory (its parent has no .env files: @colyseus/tools also looks there). */
function app(files) {
  const root = mkdtempSync(join(tmpdir(), 'cloud-env-'))
  dirs.push(root)
  const dir = join(root, 'app')
  mkdirSync(dir)
  for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), `${content}\n`)
  return dir
}

/** Runs src/index.js in a fresh process with exactly `env` (plus what the OS needs to run node). */
function run(cwd, env) {
  const os = process.platform === 'win32' ? { SystemRoot: process.env.SystemRoot, TEMP: process.env.TEMP, TMP: process.env.TMP } : {}
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['--import', PRELOAD, INDEX], { cwd, env: { PATH: process.env.PATH, ...os, ...env }, stdio: ['ignore', 'pipe', 'pipe'] })
    let out = ''
    child.stdout.on('data', chunk => { out += chunk })
    child.stderr.on('data', chunk => { out += chunk })
    const timer = setTimeout(() => child.kill(), 30_000)
    child.on('exit', code => {
      clearTimeout(timer)
      const line = out.split(/\r?\n/).find(l => l.startsWith('CLOUD_ENV_PROBE '))
      resolve({ code, out, report: line ? JSON.parse(line.slice('CLOUD_ENV_PROBE '.length)) : null })
    })
  })
}

test('Cloud: variables only in .env.cloud reach PresenceRoom and the authority adapters at import', { skip: cloudSkip }, async () => {
  const { code, out, report } = await run(app({ '.env.cloud': cloudFile }), { COLYSEUS_CLOUD: '1', NODE_APP_INSTANCE: '0' })
  assert.ok(report, `the probe reported (exit ${code}): ${out.slice(-400)}`)
  assert.equal(report.captured.NODE_ENV, 'production')
  assert.equal(report.captured.WORLD_LOCATION_PERSISTENCE, 'shadow')
  assert.equal(report.captured.WORLD_AUTHORITY_URL, AUTHORITY_URL)
  assert.equal(report.captured.secretSha256, SECRET_SHA, 'the authority secret was loaded (compared by hash only)')
  assert.deepEqual(report.location, { mode: 'shadow', effective: 'shadow' }, 'not off: location runs on the authority store')
  assert.equal(report.worldAuthority, true, 'not unavailable: the world was built on the authority adapter')
  assert.equal(code, 0)
  assert.ok(!out.includes(SECRET), 'the secret never appears in the output')
})

test('Cloud: precedence is @colyseus/tools\' own — .env.cloud overrides the process, .env does not', { skip: cloudSkip }, async () => {
  const cwd = app({ '.env.cloud': cloudFile, '.env': 'CLOUD_ENV_TEST_MARKER=from-dotenv-file' })
  const { out, report } = await run(cwd, {
    COLYSEUS_CLOUD: '1',
    WORLD_LOCATION_PERSISTENCE: 'off',         // the dashboard value (.env.cloud: shadow) wins
    CLOUD_ENV_TEST_MARKER: 'from-process',     // .env never overrides the process
    ALLOWED_ORIGINS: 'http://127.0.0.1:5173',  // also in .env.cloud, same value
  })
  assert.ok(report, out.slice(-400))
  assert.equal(report.captured.WORLD_LOCATION_PERSISTENCE, 'shadow')
  assert.equal(report.location.mode, 'shadow')
  assert.equal(report.captured.CLOUD_ENV_TEST_MARKER, 'from-process')
  assert.ok(!out.includes(SECRET))
})

test('local/dev (no COLYSEUS_CLOUD): no env file is loaded, the process environment is used as before', async () => {
  const cwd = app({ '.env.cloud': cloudFile, '.env': 'CLOUD_ENV_TEST_MARKER=from-dotenv-file' })
  const bare = await run(cwd, {})
  assert.ok(bare.report, bare.out.slice(-400))
  assert.deepEqual(bare.report.captured, { NODE_ENV: null, WORLD_LOCATION_PERSISTENCE: null, WORLD_AUTHORITY_URL: null, ALLOWED_ORIGINS: null, CLOUD_ENV_TEST_MARKER: null, secretSha256: null })
  assert.equal(bare.report.location.mode, 'off')
  assert.equal(bare.report.worldAuthority, false)

  const configured = await run(cwd, { NODE_ENV: 'development', WORLD_LOCATION_PERSISTENCE: 'shadow', WORLD_PLAYERDATA: 'pglite', WORLD_WILD_CATALOG: 'synthetic' })
  assert.ok(configured.report, configured.out.slice(-400))
  assert.equal(configured.report.captured.NODE_ENV, 'development')
  assert.equal(configured.report.location.mode, 'shadow')
  assert.equal(configured.report.captured.CLOUD_ENV_TEST_MARKER, null, 'a local .env is still not loaded')
  for (const result of [bare, configured]) assert.ok(!result.out.includes(SECRET))
})
