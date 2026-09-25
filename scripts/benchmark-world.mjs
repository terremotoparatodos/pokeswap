// WORLD-1 load benchmark: synthetic players in Pradera that walk to resource
// nodes and work them, with real contention, over real WebSockets against a
// real realtime process (benchmark mode + demo SKILLS policy, never production).
//
//   node scripts/benchmark-world.mjs --players 30 --duration 60 [--world off]
//
// `--world off` runs the same walkers without declaring the world protocol, so
// the difference between the two runs is what the shared world costs.
// Output: JSON on stdout (per-client bytes by message family, world message
// rates, snapshot sizes, work outcomes and latency, server world counters,
// event loop delay and memory).

import { spawn } from 'node:child_process'
import net from 'node:net'
import { performance } from 'node:perf_hooks'
import { Client } from '@colyseus/sdk'
import { praderaNodesNearSpawn } from '../services/realtime/src/world/testing.js'
import { ARRIVALS } from '../services/realtime/src/protocol/arrival.js'

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const players = Math.max(1, Math.min(100, Number(option('players', 30))))
const durationMs = Math.max(5, Number(option('duration', 60))) * 1000
const port = Number(option('port', 2590))
const worldOn = option('world', 'on') !== 'off'
const actionMs = Number(option('action-ms', 3000))
// --url ws://…: drive an already running stack (e.g. local-stack.mjs, for a
// browser to watch); server counters are then not collected.
const externalUrl = option('url', null)
const prefix = option('prefix', 'world')
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const percentile = (values, p) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] }
const round = value => Math.round(value * 100) / 100

async function waitForPort(target) {
  for (let i = 0; i < 100; i++) {
    const open = await new Promise(resolve => { const s = net.createConnection({ host: '127.0.0.1', port: target }); s.once('connect', () => { s.destroy(); resolve(true) }); s.once('error', () => resolve(false)) })
    if (open) return
    await delay(100)
  }
  throw new Error('server did not start')
}

const server = externalUrl ? null : spawn(process.execPath, ['services/realtime/src/index.js'], {
  env: {
    ...process.env, PORT: String(port), HEALTH_PORT: String(port + 1), NODE_ENV: 'development', PRESENCE_BENCHMARK: 'on',
    WORLD_DEMO_SKILLS: 'on', WORLD_DEMO_ACTION_MS: String(actionMs), WORLD_WILD_CATALOG: 'synthetic', ALLOWED_ORIGINS: 'http://localhost:5173',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const metrics = async () => externalUrl ? {} : (await fetch(`http://127.0.0.1:${port + 1}/metrics`)).json()

// Work targets: every workable node near the spawn, each with its stand tile.
const targets = praderaNodesNearSpawn(Number(option('radius', 60))).map(({ node, stands }) => ({ node, stand: stands[0] }))

try {
  if (!externalUrl) await waitForPort(port)
  const clients = []
  for (let i = 0; i < players; i++) {
    const room = await new Client(externalUrl ?? `ws://127.0.0.1:${port}`).joinOrCreate('presence', {
      benchmark: { id: `${prefix}-${i}`, username: `Carga ${i}`, area: 'pradera' }, presenceProtocol: 2, ...(worldOn ? { worldProtocol: 1 } : {}),
    })
    room.reconnection.enabled = false
    const state = { room, i, tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty, sequence: 0, bytes: { presence: 0, world: 0, chat: 0 }, messages: { presence: 0, world: 0 },
      worldTypes: {}, snapshotBytes: [], batchBytes: [], results: {}, latency: [], done: 0, pending: null, requestId: 0, target: i % targets.length,
      /** Nodes this client was told are not available: a player would not walk to them. */
      busy: new Set() }
    const learn = nodes => { for (const node of nodes ?? []) { if (node.base) state.busy.delete(node.id); else state.busy.add(node.id) } }
    const count = (type, payload) => {
      const size = JSON.stringify(payload ?? null).length + type.length
      const family = type.startsWith('world:') ? 'world' : type.startsWith('chat:') ? 'chat' : 'presence'
      state.bytes[family] += size
      if (family !== 'chat') state.messages[family]++
      if (family === 'world') {
        state.worldTypes[type] = (state.worldTypes[type] ?? 0) + 1
        if (type === 'world:snapshot') state.snapshotBytes.push(size)
        if (type === 'world:batch') state.batchBytes.push(size)
      }
      return size
    }
    for (const type of ['presence:snapshot', 'presence:self', 'presence:delta', 'presence:batch', 'presence:error', 'chat:history', 'chat:line', 'world:snapshot', 'world:batch', 'world:wild', 'world:work:done']) {
      room.onMessage(type, payload => {
        count(type, payload)
        if (type === 'world:work:done' && state.pending?.actionId === payload.actionId) { state.done++; state.pending = null }
        if (type === 'world:snapshot') { state.busy.clear(); learn(payload.nodes) }
        if (type === 'world:batch') { for (const entry of payload.enter ?? []) learn(entry.nodes); learn(payload.nodes) }
      })
    }
    room.onMessage('world:work:result', payload => {
      count('world:work:result', payload)
      state.results[payload.ok ? 'ok' : payload.reason] = (state.results[payload.ok ? 'ok' : payload.reason] ?? 0) + 1
      if (state.pending?.requestId === payload.requestId) {
        state.latency.push(performance.now() - state.pending.sentAt)
        state.pending = payload.ok ? { actionId: payload.actionId } : null
      }
    })
    room.send('presence:ready')
    clients.push(state)
  }
  const before = await metrics()
  const started = performance.now()

  // Each client: walk (running pace) to its target's stand tile, work it, wait
  // for the result and completion, then take the next target. Contended nodes
  // are refused and skipped, as a player would.
  const step = state => {
    if (state.pending) return
    for (let skip = 0; skip < targets.length && state.busy.has(targets[state.target].node.id); skip++) state.target = (state.target + 1) % targets.length
    const target = targets[state.target]
    const dx = target.stand.tx - state.tx
    const dy = target.stand.ty - state.ty
    if (dx === 0 && dy === 0) {
      if (!worldOn) { state.target = (state.target + players) % targets.length; return }
      state.pending = { requestId: ++state.requestId, sentAt: performance.now() }
      state.room.send('world:work', { nodeId: target.node.id, pokemonInstanceId: state.i + 1, requestId: state.requestId })
      state.target = (state.target + players + 1) % targets.length
      return
    }
    const direction = dx !== 0 ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up')
    if (direction === 'right') state.tx++; else if (direction === 'left') state.tx--; else if (direction === 'down') state.ty++; else state.ty--
    state.room.send('move', { direction, running: true, sequence: ++state.sequence })
  }
  const timer = setInterval(() => { for (const state of clients) step(state) }, 1000 / 7.5)
  const samples = []
  const sampler = setInterval(async () => { try { samples.push((await metrics()).world) } catch { /* sampling only */ } }, 1000)
  await delay(durationMs)
  clearInterval(timer)
  clearInterval(sampler)
  const seconds = (performance.now() - started) / 1000
  const after = await metrics()
  for (const state of clients) await state.room.leave()

  const per = key => clients.map(state => state.bytes[key] / seconds / 1024)
  const worldMsgs = clients.map(state => state.messages.world / seconds)
  const snapshotBytes = clients.flatMap(state => state.snapshotBytes)
  const batchBytes = clients.flatMap(state => state.batchBytes)
  const results = {}
  for (const state of clients) for (const [key, value] of Object.entries(state.results)) results[key] = (results[key] ?? 0) + value
  console.log(JSON.stringify({
    benchmark: 'world-1', players, worldProtocol: worldOn, seconds: round(seconds), actionMs, targets: targets.length,
    perClientKiBps: {
      presence: { mean: round(per('presence').reduce((a, b) => a + b, 0) / players), p95: round(percentile(per('presence'), 0.95)) },
      world: { mean: round(per('world').reduce((a, b) => a + b, 0) / players), p95: round(percentile(per('world'), 0.95)) },
    },
    worldMessagesPerClientPerSecond: { mean: round(worldMsgs.reduce((a, b) => a + b, 0) / players), p95: round(percentile(worldMsgs, 0.95)) },
    worldSnapshotBytes: { p50: percentile(snapshotBytes, 0.5), max: Math.max(0, ...snapshotBytes) },
    worldBatchBytes: { p50: percentile(batchBytes, 0.5), p95: percentile(batchBytes, 0.95), max: Math.max(0, ...batchBytes) },
    work: { results, completions: clients.reduce((a, s) => a + s.done, 0), requestToReplyMs: { p50: round(percentile(clients.flatMap(s => s.latency), 0.5)), p95: round(percentile(clients.flatMap(s => s.latency), 0.95)) } },
    concurrentActions: { max: Math.max(0, ...samples.map(s => s?.runningActions ?? 0)), mean: round(samples.reduce((a, s) => a + (s?.runningActions ?? 0), 0) / Math.max(1, samples.length)) },
    storedNodes: { max: Math.max(0, ...samples.map(s => s?.storedNodes ?? 0)) },
    subscribedChunks: { max: Math.max(0, ...samples.map(s => s?.subscribedChunks ?? 0)) },
    server: {
      world: after.world, eventLoopDelayMs: after.eventLoopDelayMs, memoryMb: after.memoryMb,
      moves: after.moves - before.moves,
    },
  }, null, 2))
} finally {
  server?.kill()
}
