// ECO-GAMEPLAY-1 — isolated local environment for the two-client human test (development only).
//
//   node scripts/ecosystem/eco-gameplay-local.mjs realtime              realtime on 127.0.0.1:2790 (health 2791)
//   node scripts/ecosystem/eco-gameplay-local.mjs client [--out <dir>]  dev build of the client, served on 127.0.0.1:5199
//
// Isolation, by construction:
//   - each process gets an EXPLICIT environment (PATH and the OS temp/system variables, plus the
//     values below). Nothing inherited reaches it: no Supabase URL/key, no world authority, no
//     Cloud variables, no production flag;
//   - realtime: NODE_ENV=development, PRESENCE_BENCHMARK=on (synthetic players, no accounts),
//     WORLD_ECO_EXPERIMENT=on (the ECO population instead of the hourly roster), world adapters in
//     mode `unavailable` (nothing is worked, owned or persisted);
//   - client: a DEVELOPMENT build (`vite build --mode development`) into a fresh folder outside the
//     repository (default: the OS temp dir), with a placeholder Supabase (http://127.0.0.1:1, which
//     refuses connections) and VITE_ECO_EXPERIMENT=on. No Vite dev server, so no dependency cache is
//     written into a shared node_modules;
//   - ports 2790/2791/5199 only; the script refuses to start if one is already taken. It never
//     touches other processes, the dark environment (2567/2568/5173), Cloud or a hosted database.
//
// Human test: open http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-a and, in another window,
// http://127.0.0.1:5199/?area=pradera&benchmarkId=eco-b (see docs/design/ECO_GAMEPLAY_1_REPORT.md).

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const HOST = '127.0.0.1'
export const PORTS = Object.freeze({ realtime: 2790, health: 2791, client: 5199 })
const CLIENT_ORIGIN = `http://${HOST}:${PORTS.client}`

/** Only what a process needs to run on this OS; everything else is set explicitly below. */
function baseEnv() {
  const keep = ['PATH', 'Path', 'SystemRoot', 'SYSTEMROOT', 'TEMP', 'TMP', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'ComSpec']
  return Object.fromEntries(keep.filter(name => process.env[name] !== undefined).map(name => [name, process.env[name]]))
}

export const REALTIME_ENV = Object.freeze({
  NODE_ENV: 'development', PRESENCE_BENCHMARK: 'on', WORLD_ECO_EXPERIMENT: 'on',
  PORT: String(PORTS.realtime), HEALTH_PORT: String(PORTS.health), ALLOWED_ORIGINS: CLIENT_ORIGIN,
})

export const CLIENT_ENV = Object.freeze({
  // `vite build --mode development` alone still builds with NODE_ENV=production (import.meta.env.DEV
  // false): the experiment and the synthetic identities would be compiled out. Hence NODE_ENV here.
  NODE_ENV: 'development',
  VITE_SUPABASE_URL: 'http://127.0.0.1:1', VITE_SUPABASE_ANON_KEY: 'eco-gameplay-local-placeholder',
  VITE_REALTIME_URL: `ws://${HOST}:${PORTS.realtime}`, VITE_PRESENCE_BENCHMARK: 'on', VITE_ECO_EXPERIMENT: 'on',
})

function portFree(port) {
  return new Promise(resolve => {
    const probe = createServer()
    probe.once('error', () => resolve(false))
    probe.listen(port, HOST, () => probe.close(() => resolve(true)))
  })
}

async function requireFree(...ports) {
  for (const port of ports) {
    if (!(await portFree(port))) {
      console.error(`[eco-local] port ${port} is in use: not starting (nothing else is touched)`)
      process.exit(3)
    }
  }
}

function run(args, env, { wait = true } = {}) {
  const child = spawn(process.execPath, args, { cwd: ROOT, env: { ...baseEnv(), ...env }, stdio: 'inherit' })
  if (!wait) return child
  return new Promise((resolve, reject) => child.on('exit', code => (code === 0 ? resolve() : reject(new Error(`${args[0]} exited ${code}`)))))
}

const VITE = join(ROOT, 'node_modules/vite/bin/vite.js')
const command = process.argv[2]

if (command === 'realtime') {
  await requireFree(PORTS.realtime, PORTS.health)
  console.log(`[eco-local] realtime on ws://${HOST}:${PORTS.realtime} (ECO experiment, synthetic players, no database)`)
  run([join(ROOT, 'services/realtime/src/index.js')], REALTIME_ENV, { wait: false })
} else if (command === 'client') {
  await requireFree(PORTS.client)
  const i = process.argv.indexOf('--out')
  const out = i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : join(tmpdir(), `pokeswap-eco-gameplay-1-client-${Date.now()}`)
  // Never empties anything that was already there: the build goes only into a new or empty folder.
  if (existsSync(out) && readdirSync(out).length > 0) {
    console.error(`[eco-local] ${out} is not empty: choose a new folder (nothing is deleted)`)
    process.exit(3)
  }
  mkdirSync(out, { recursive: true })
  console.log(`[eco-local] building a development client into ${out}`)
  await run([VITE, 'build', '--mode', 'development', '--outDir', out, '--emptyOutDir'], CLIENT_ENV)
  console.log(`[eco-local] client on ${CLIENT_ORIGIN}/?area=pradera&benchmarkId=eco-a (and benchmarkId=eco-b in a second window)`)
  run([VITE, 'preview', '--outDir', out, '--host', HOST, '--port', String(PORTS.client), '--strictPort'], CLIENT_ENV, { wait: false })
} else {
  console.error('usage: node scripts/ecosystem/eco-gameplay-local.mjs realtime|client [--out <dir>]')
  process.exit(3)
}
