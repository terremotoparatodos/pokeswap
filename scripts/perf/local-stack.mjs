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
// --realtime-port / --app-port run a second, isolated stack beside one already running.
const realtimePort = Number(arg('realtime-port') ?? 2568)
const appPort = Number(arg('app-port') ?? 4173)
const bundles = [
  { name: 'normal', port: appPort, env: {} },
  { name: 'playtest', port: appPort + 1, env: { VITE_PLAYTEST: 'on' } },
]
const outDir = name => `node_modules/.cache/perf-dist/${name}${appPort === 4173 ? '' : '-' + appPort}`
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
// --crowd N: N synthetic runners in town and N in Pradera, the same fixed
// square pattern every time (benchmark driver, running gait, protocol 2), for
// an hour. They run on the server only: the client's NPCs cannot touch them.
const crowd = Number(arg('crowd') ?? 0)
if (crowd > 0) {
  setTimeout(() => {
    for (const [area, prefix] of [['ciudad-corazon', 'crowd-town'], ['pradera', 'crowd-wild']]) {
      children.push(spawn(process.execPath, ['scripts/benchmark-presence.mjs', '--external-server', '--url', `ws://127.0.0.1:${realtimePort}`,
        '--players', String(crowd), '--duration', '3600', '--warmup', '1', '--protocol', '2', '--gait', 'run', '--area', area, '--prefix', prefix],
      { stdio: 'ignore' }))
    }
    console.log(`[perf] crowd     ${crowd} runners in town and ${crowd} in Pradera (1 h)`)
  }, 3000)
}
console.log(`\n[perf] realtime  ws://${host}:${realtimePort}   metrics http://127.0.0.1:${realtimePort + 1}/metrics`)
for (const b of bundles) console.log(`[perf] ${b.name.padEnd(9)} http://${host}:${b.port}/?benchmarkId=pc-a`)
const stop = () => { for (const child of children) child.kill(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
