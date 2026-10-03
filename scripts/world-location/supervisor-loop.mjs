// WORLD LOCATION-4, review F1 — a deploy under a supervisor that restarts ANY exit (LOCAL ONLY).
//
//   node scripts/world-location/supervisor-loop.mjs [--tree DIR] [--seconds 150] [--port 3100]
//        [--players 6] [--restart-delay 500] [--out results.json]
//
// Emulates PM2 with `autorestart: true` (services/realtime/ecosystem.config.js) without PM2:
// every exit of a supervised process, code 0 included, starts it again after `--restart-delay`.
// Nothing assumes `stop_exit_codes`. Two supervised apps share one local authority (`on`):
//   A  the running deployment, with players connected;
//   B  the new deployment, started 10 s later (the deploy overlap).
// Players reconnect like the browser client: with resume, to whichever app answers /readyz 200,
// with a bounded backoff that resets only after a stable connection.
//
// Stable means, after B activates and one renewal has passed: no supervised restart, no new
// generation (the displaced A never creates another), exactly one active host (B's), and no
// repeated mass reconnection (each player moves at most once, never with 4001).
// --tree runs another checkout: the negative control runs the build where a displaced host
// exits with code 0 (7b95e94), which must loop (alternating generations and restarts).
// Exit 0 only if stable. Prints a JSON summary. Generic: generated players, local secret.

import { randomBytes } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startLocalAuthority } from './localAuthority.mjs'
import { connect, delay, startRealtime } from './realtimeProcesses.mjs'

const normalize = dir => `${resolve(dir).replace(/\\/g, '/').replace(/\/?$/, '/')}`
const here = normalize(fileURLToPath(new URL('../..', import.meta.url)))
const argv = process.argv.slice(2)
const arg = (name, fallback) => { const i = argv.indexOf(`--${name}`); return i >= 0 ? argv[i + 1] : fallback }
const tree = normalize(arg('tree', here))
const seconds = Number(arg('seconds', 150))
const basePort = Number(arg('port', 3100))
const playerCount = Number(arg('players', 6))
const restartDelayMs = Number(arg('restart-delay', 500))
const out = arg('out', null)
const DEPLOY_AT_MS = 10_000
const SETTLE_MS = 15_000 // B's activation + one renewal (5 s) + the drain window, generously

const local = await startLocalAuthority({ secret: randomBytes(24).toString('hex'), tree })
const startedAt = performance.now()
const now = () => Math.round(performance.now() - startedAt)
const events = []

/** A supervised app: restarts every exit (code 0 included), like PM2 autorestart=true. */
function supervise(name, port) {
  const app = { name, port, current: null, starts: 0, exits: [], stopping: false }
  const run = async () => {
    if (app.stopping) return
    app.starts++
    const server = await startRealtime({ tree, name: `${name}${app.starts}`, port, env: local.env('on', name) })
    app.current = server
    if (app.stopping) { await server.kill(); return } // a restart that raced the teardown
    events.push({ t: now(), app: name, event: 'start', n: app.starts })
    server.exited.then(async code => {
      app.exits.push({ t: now(), code })
      events.push({ t: now(), app: name, event: 'exit', code })
      if (app.stopping) return
      await delay(restartDelayMs)
      void run()
    })
  }
  app.ready = async () => (app.current && app.current.child.exitCode === null ? app.current.ready() : 0)
  app.stop = async () => { app.stopping = true; await app.current?.kill() }
  app.start = run
  return app
}

const A = supervise('A', basePort)
const B = supervise('B', basePort + 10)
const apps = [B, A] // players prefer the new deployment once it is ready

/** A player tab: resume reconnections to a ready app, bounded backoff reset only when stable. */
function player(identity, i) {
  const tab = { i, tabId: `tab-supervised-${i}-harness`, socket: null, closes: [], joins: 0, attempt: 0, stop: false }
  const backoff = () => Math.min(10_000, 500 * 2 ** tab.attempt++)
  const loop = async (first) => {
    while (!tab.stop) {
      let target = null
      for (const app of apps) if ((await app.ready()) === 200) { target = app.current; break }
      if (target) {
        const socket = await connect(target, identity.token, { tabId: tab.tabId, resume: !first, waitSelf: false }).catch(() => ({ refused: -1 }))
        first = false
        if (socket.refused === null) {
          tab.joins++
          tab.socket = socket
          const joinedAt = performance.now()
          while (socket.left === null && !tab.stop) {
            await delay(100)
            if (performance.now() - joinedAt > 10_000) tab.attempt = 0 // stable: the backoff resets
          }
          if (tab.stop) return
          tab.closes.push({ t: now(), code: socket.left })
        }
      }
      await delay(backoff())
    }
  }
  tab.run = first => loop(first)
  return tab
}

const samples = []
let tabs = []
let connectedAtEnd = []
let finalHosts = []
const bounded = (promise, ms = 5_000) => Promise.race([Promise.resolve(promise).catch(() => {}), delay(ms)])
try {
  await A.start()
  for (let i = 0; i < 100 && (await A.ready()) !== 200; i++) await delay(100)
  const identities = []
  for (let i = 0; i < playerCount; i++) identities.push(await local.player())
  tabs = identities.map((identity, i) => player(identity, i))
  for (const tab of tabs) void tab.run(true)
  while (now() < DEPLOY_AT_MS) await delay(200)
  await B.start()
  while (now() < seconds * 1000) {
    const hosts = (await local.hosts()) ?? []
    samples.push({ t: now(), generations: hosts.length, active: hosts.filter(h => h.state === 'active').map(h => h.generation) })
    await delay(1_000)
  }
  // The verdict is taken here, before any teardown, so a stuck teardown can never hide it.
  connectedAtEnd = tabs.map(tab => Boolean(tab.socket && tab.socket.left === null))
  finalHosts = (await local.hosts()) ?? []
} finally {
  for (const tab of tabs) tab.stop = true
  A.stopping = true
  B.stopping = true
}

const settledFrom = DEPLOY_AT_MS + SETTLE_MS
const after = samples.filter(s => s.t >= settledFrom)
const restarts = A.starts - 1 + B.starts - 1
const result = {
  tree: tree === here ? 'this checkout' : 'other (--tree)',
  seconds, players: playerCount, restartDelayMs,
  generations: finalHosts.length,
  hosts: finalHosts.map(h => [h.generation, h.state]),
  supervisedStarts: { A: A.starts, B: B.starts },
  exits: { A: A.exits.length, B: B.exits.length },
  restarts,
  activeAfterSettling: [...new Set(after.map(s => JSON.stringify(s.active)))],
  generationsOverTime: [...new Set(samples.map(s => s.generations))],
  closesPerPlayer: tabs.map(tab => tab.closes.map(c => c.code)),
  joinsPerPlayer: tabs.map(tab => tab.joins),
  events: events.slice(0, 80),
}
const checks = [
  { name: 'no supervised process ever exits on its own (no restart)', ok: restarts === 0 },
  { name: 'no new generation after the deploy: exactly two (A, B)', ok: finalHosts.length === 2 },
  { name: 'after settling: always exactly one active host, the newest', ok: after.length > 0 && after.every(s => s.active.length === 1 && s.active[0] === Math.max(...finalHosts.map(h => h.generation))) },
  { name: 'no repeated mass reconnection: each player is closed at most once, never with 4001', ok: tabs.every(tab => tab.closes.length <= 1 && tab.closes.every(c => c.code !== 4001)) },
  { name: 'every player is connected at the end', ok: connectedAtEnd.length === tabs.length && connectedAtEnd.every(Boolean) },
]
result.checks = checks
result.passed = checks.every(c => c.ok)
const text = JSON.stringify(result, null, 2)
if (out) writeFileSync(out, text)
console.log(text)

// Teardown, every step bounded: a supervised restart loop must never keep this run alive.
for (const tab of tabs) await bounded(tab.socket?.room?.leave(), 2_000)
await bounded(A.stop(), 10_000)
await bounded(B.stop(), 10_000)
await bounded(local.close(), 5_000)
process.exit(result.passed ? 0 : 1)
