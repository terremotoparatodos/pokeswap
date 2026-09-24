// PERF-1 local measurement stack, one command:
//
//   node scripts/perf/local-stack.mjs [--host 192.168.1.6] [--no-build]
//
// 1. builds two production bundles with VITE_PERF=on (normal and playtest)
//    that join the local realtime server as synthetic benchmark players;
// 2. starts services/realtime in benchmark mode (never production: NODE_ENV=development);
// 3. serves the bundles with `vite preview` on the LAN (4173 normal, 4174 playtest),
//    with the capture collector that writes docs/performance/baselines/incoming.
// Stop with Ctrl+C. Nothing here touches production services.

import { spawn, spawnSync } from 'node:child_process'
import { networkInterfaces } from 'node:os'

const arg = name => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : undefined }
const lan = Object.values(networkInterfaces()).flat().find(a => a?.family === 'IPv4' && !a.internal && /^(192\.168|10\.)/.test(a.address))?.address
const host = arg('host') ?? lan ?? '127.0.0.1'
const realtimePort = 2568
const bundles = [
  { name: 'normal', port: 4173, env: {} },
  { name: 'playtest', port: 4174, env: { VITE_PLAYTEST: 'on' } },
]
const outDir = name => `node_modules/.cache/perf-dist/${name}`
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx'
const shell = process.platform === 'win32'

if (!process.argv.includes('--no-build')) {
  for (const bundle of bundles) {
    console.log(`[perf] building ${bundle.name} → ${outDir(bundle.name)}`)
    const result = spawnSync(npx, ['vite', 'build', '--outDir', `../${outDir(bundle.name)}`, '--emptyOutDir'], {
      stdio: 'inherit', shell,
      env: { ...process.env, ...bundle.env, VITE_PERF: 'on', VITE_PRESENCE_BENCHMARK: 'on', VITE_REALTIME_URL: `ws://${host}:${realtimePort}` },
    })
    if (result.status !== 0) process.exit(result.status ?? 1)
  }
}

const origins = bundles.flatMap(b => [`http://localhost:${b.port}`, `http://127.0.0.1:${b.port}`, `http://${host}:${b.port}`]).join(',')
const children = [
  spawn(process.execPath, ['services/realtime/src/index.js'], {
    stdio: 'inherit',
    env: { ...process.env, PORT: String(realtimePort), HEALTH_PORT: String(realtimePort + 1), NODE_ENV: 'development', PRESENCE_BENCHMARK: 'on', ALLOWED_ORIGINS: origins },
  }),
  ...bundles.map(b => spawn(npx, ['vite', 'preview', '--outDir', `../${outDir(b.name)}`, '--host', '0.0.0.0', '--port', String(b.port), '--strictPort'], {
    stdio: 'inherit', shell, env: { ...process.env, VITE_PERF: 'on' },
  })),
]
console.log(`\n[perf] realtime  ws://${host}:${realtimePort}   metrics http://127.0.0.1:${realtimePort + 1}/metrics`)
for (const b of bundles) console.log(`[perf] ${b.name.padEnd(9)} http://${host}:${b.port}/?benchmarkId=pc-a`)
const stop = () => { for (const child of children) child.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
