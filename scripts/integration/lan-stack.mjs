// INTEGRATION-1 physical test stack (LAN). Nothing here touches production:
// the realtime server runs locally in benchmark mode (synthetic players, no
// accounts) and settles into an embedded Postgres running the real migration.
//
//   node scripts/integration/lan-stack.mjs            playtest build on :4174 (asks for the usual access code)
//   node scripts/integration/lan-stack.mjs --dev      Vite dev server on :5190 (no gate, for quick checks)
//   options: --host 192.168.1.6  --reset-db  --farm-scale 0.05  --no-build
//
// Open on each device with its own identity, e.g.
//   PC      http://<host>:4174/?benchmarkId=pc&area=pradera
//   iPhone  http://<host>:4174/?benchmarkId=iphone&area=pradera
// Each identity gets a small real roster the first time (a specialist per
// skill, a poor worker, an early Pokémon). XP, materials, depleted nodes and
// crops live in node_modules/.cache/integration-1/world-db and survive
// restarts of this script (use --reset-db for a clean world).
//
// Crop growth is multiplied by --farm-scale (default 0.05: Baya Aranja grows
// in ~5 s instead of 90 s) — for this test stack only; production balance is
// untouched. Stop with Ctrl+C.

import { spawn, spawnSync } from 'node:child_process'
import { rmSync } from 'node:fs'
import { networkInterfaces } from 'node:os'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../..', import.meta.url))
const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const has = name => process.argv.includes(`--${name}`)
const lan = Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal && /^(192\.168|10\.)/.test(a.address))?.address
const host = arg('host') ?? lan ?? '127.0.0.1'
const dev = has('dev')
const realtimePort = 2568
const appPort = dev ? 5190 : 4174
const dbDir = `${root}node_modules/.cache/integration-1/world-db`
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const shell = process.platform === 'win32'

if (has('reset-db')) rmSync(dbDir, { recursive: true, force: true })

const viteEnv = { ...process.env, VITE_PRESENCE_BENCHMARK: 'on', VITE_REALTIME_URL: `ws://${host}:${realtimePort}` }
const outDir = 'node_modules/.cache/integration-1/playtest-dist'
if (!dev && !has('no-build')) {
  console.log('[int-1] building the playtest bundle')
  const result = spawnSync(npx, ['vite', 'build', '--outDir', `../${outDir}`, '--emptyOutDir'], {
    cwd: root, stdio: 'inherit', shell, env: { ...viteEnv, VITE_PLAYTEST: 'on', VITE_PERF: 'on' },
  })
  if (result.status !== 0) process.exit(result.status ?? 1)
}

const origins = [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`, `http://${host}:${appPort}`].join(',')
const children = [
  spawn(process.execPath, ['services/realtime/src/index.js'], {
    cwd: root, stdio: 'inherit',
    env: {
      ...process.env, PORT: String(realtimePort), HEALTH_PORT: String(realtimePort + 1), NODE_ENV: 'development',
      PRESENCE_BENCHMARK: 'on', ALLOWED_ORIGINS: origins,
      WORLD_PLAYERDATA: 'pglite', WORLD_DB_DIR: dbDir, WORLD_WILD_CATALOG: 'synthetic',
      WORLD_FARM_TIME_SCALE: arg('farm-scale') ?? '0.05',
    },
  }),
  dev
    ? spawn(npx, ['vite', '--host', '0.0.0.0', '--port', String(appPort), '--strictPort'], { cwd: root, stdio: 'inherit', shell, env: viteEnv })
    : spawn(npx, ['vite', 'preview', '--outDir', `../${outDir}`, '--host', '0.0.0.0', '--port', String(appPort), '--strictPort'], { cwd: root, stdio: 'inherit', shell, env: viteEnv }),
]

setTimeout(() => {
  console.log(`\n[int-1] ${dev ? 'dev' : 'playtest'} stack ready (local database: ${dbDir})`)
  console.log(`[int-1] PC      http://${host}:${appPort}/?benchmarkId=pc&area=pradera`)
  console.log(`[int-1] iPhone  http://${host}:${appPort}/?benchmarkId=iphone&area=pradera`)
  console.log(`[int-1] metrics http://127.0.0.1:${realtimePort + 1}/metrics\n`)
}, dev ? 3_000 : 1_500)

const stop = () => { for (const child of children) child.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
