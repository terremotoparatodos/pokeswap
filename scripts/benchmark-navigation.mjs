// CAVES-4 navigation benchmark: synthetic players spread over Ciudad, Pradera
// and the cave, walking real routes and crossing real portals, over real
// WebSockets against a real realtime process (benchmark mode, never production).
//
//   node scripts/benchmark-navigation.mjs --players 100 --duration 60 [--probes 0.05] [--seed 4]
//
// Every walker plans with the shared navigation (`routeBetween`), so a
// legitimate run expects zero refusals. `--probes p` makes each action a
// deliberate forgery with probability p (a step into a wall, a crossing from a
// wrong tile, a skipped sequence): those refusals are the generator's own and
// are reported apart from any refusal the walkers did not ask for, which
// would be a server defect.
//
// Output: JSON on stdout — distribution, moves and crossings accepted,
// refusals (expected vs unexpected, by reason), errors, presence leaks
// between areas, ack RTT, server counters, event loop delay and memory.

import { spawn } from 'node:child_process'
import net from 'node:net'
import { performance } from 'node:perf_hooks'
import { Client } from '@colyseus/sdk'
import { ARRIVALS } from '../services/realtime/src/protocol/arrival.js'
import { isWalkable, portalAt, portalTo } from '../services/realtime/src/world/navigation.js'
import { routeBetween } from '../services/realtime/src/world/testing.js'

const option = (name, fallback) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 ? process.argv[i + 1] : fallback }
const players = Math.max(1, Math.min(100, Number(option('players', 100))))
const durationMs = Math.max(5, Number(option('duration', 60))) * 1000
const port = Number(option('port', 2600))
const probes = Math.max(0, Math.min(1, Number(option('probes', 0))))
let seed = Number(option('seed', 4)) >>> 0
const delay = ms => new Promise(resolve => setTimeout(resolve, ms))
const percentile = (values, p) => { if (!values.length) return 0; const s = [...values].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(s.length * p) - 1)] }
const round = value => Math.round(value * 100) / 100
// Deterministic PRNG (mulberry32): the same seed walks the same itineraries.
const random = () => { seed = (seed + 0x6d2b79f5) >>> 0; let t = seed; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296 }
const pick = list => list[Math.floor(random() * list.length)]

const AREAS = ['ciudad-corazon', 'pradera', 'cueva-inicial']
const NEIGHBOURS = { 'ciudad-corazon': ['pradera'], pradera: ['ciudad-corazon', 'cueva-inicial'], 'cueva-inicial': ['pradera'] }
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }
const STEP_MS = 1000 / 7.5

/** Walkable, non-portal tiles of an area within `radius` of its arrival: where a walker may wander. */
function wanderTiles(areaId, radius) {
  const { tx: cx, ty: cy } = ARRIVALS[areaId]
  const out = []
  for (let ty = cy - radius; ty <= cy + radius; ty++) {
    for (let tx = cx - radius; tx <= cx + radius; tx++) if (isWalkable(areaId, tx, ty) && portalAt(areaId, tx, ty) === null) out.push({ tx, ty })
  }
  return out
}
const WANDER = { 'ciudad-corazon': wanderTiles('ciudad-corazon', 30), pradera: wanderTiles('pradera', 24), 'cueva-inicial': wanderTiles('cueva-inicial', 20) }

async function waitForPort(target) {
  for (let i = 0; i < 100; i++) {
    const open = await new Promise(resolve => { const s = net.createConnection({ host: '127.0.0.1', port: target }); s.once('connect', () => { s.destroy(); resolve(true) }); s.once('error', () => resolve(false)) })
    if (open) return
    await delay(100)
  }
  throw new Error('server did not start')
}

const server = spawn(process.execPath, ['services/realtime/src/index.js'], {
  env: {
    ...process.env, PORT: String(port), HEALTH_PORT: String(port + 1), NODE_ENV: 'development', PRESENCE_BENCHMARK: 'on',
    WORLD_DEMO_SKILLS: 'on', WORLD_WILD_CATALOG: 'synthetic', ALLOWED_ORIGINS: 'http://localhost:5173',
  },
  stdio: ['ignore', 'ignore', 'inherit'],
})
const metrics = async () => (await fetch(`http://127.0.0.1:${port + 1}/metrics`)).json()

try {
  await waitForPort(port)
  const clients = []
  const joinStarted = performance.now()
  for (let i = 0; i < players; i++) {
    const startArea = AREAS[i % AREAS.length]
    const room = await new Client(`ws://127.0.0.1:${port}`).joinOrCreate('presence', {
      benchmark: { id: `nav-${i}`, username: `Ruta ${i}`, area: startArea }, presenceProtocol: 2,
    })
    room.reconnection.enabled = false
    const state = {
      room, i, startArea, areaId: null, tx: 0, ty: 0, sequence: 0, ready: false,
      route: [], goal: null, crossing: null, waitingArea: null,
      sentAt: new Map(), rtt: [], acceptedMoves: 0, acceptedCrossings: 0,
      expect: [], refusals: { expected: {}, unexpected: {} }, leaks: 0, known: new Map(), errors: 0, probesSent: 0,
    }
    const adopt = self => { state.areaId = self.areaId; state.tx = self.tx; state.ty = self.ty; state.sequence = Math.max(state.sequence, self.moveSequence) }
    room.onMessage('presence:snapshot', snapshot => {
      if (!snapshot.self) return
      const previous = state.areaId
      adopt(snapshot.self)
      state.ready = true
      if (state.waitingArea && snapshot.self.areaId === state.waitingArea && previous !== state.waitingArea) state.acceptedCrossings++
      state.waitingArea = null
      state.route = []
      state.known = new Map()
      for (const actor of snapshot.actors) { if (actor.areaId !== state.areaId) state.leaks++; state.known.set(actor.id, actor.areaId) }
    })
    room.onMessage('presence:self', self => {
      const sent = state.sentAt.get(self.moveSequence)
      const moved = self.areaId === state.areaId && (self.tx !== state.tx || self.ty !== state.ty)
      // Only the acknowledgement of one of this walker's own steps counts as an accepted move.
      if (sent !== undefined) { state.rtt.push(performance.now() - sent); state.sentAt.delete(self.moveSequence); if (moved) state.acceptedMoves++ }
      adopt(self)
    })
    const seeDelta = delta => {
      if (delta.type === 'leave') { state.known.delete(delta.actor.id); return }
      const areaId = delta.type === 'upsert' ? delta.actor.areaId : state.known.get(delta.actor.id)
      if (areaId !== undefined && areaId !== state.areaId) state.leaks++
      if (delta.type === 'upsert') state.known.set(delta.actor.id, delta.actor.areaId)
    }
    room.onMessage('presence:delta', seeDelta)
    room.onMessage('presence:batch', batch => { for (const delta of batch) seeDelta(delta) })
    room.onMessage('presence:error', error => {
      const expected = state.expect.indexOf(error.reason)
      const bucket = expected >= 0 ? 'expected' : 'unexpected'
      if (expected >= 0) state.expect.splice(expected, 1)
      state.refusals[bucket][error.reason] = (state.refusals[bucket][error.reason] ?? 0) + 1
      // A refused crossing is followed by the real snapshot; stop waiting.
      if (error.reason === 'area transition denied') state.waitingArea = null
      state.route = []
    })
    for (const type of ['chat:history', 'chat:line', 'world:snapshot', 'world:batch', 'world:wild', 'player:state']) room.onMessage(type, () => {})
    room.onError(() => { state.errors++ })
    room.onLeave(code => { if (code !== 1000 && code !== 4000) state.errors++ })
    room.send('presence:ready')
    clients.push(state)
  }
  const joinMs = performance.now() - joinStarted
  await delay(500)
  const distribution = Object.fromEntries(AREAS.map(a => [a, clients.filter(c => c.areaId === a).length]))
  const before = await metrics()
  const started = performance.now()

  const sendMove = (state, direction) => {
    state.sequence++
    state.sentAt.set(state.sequence, performance.now())
    state.room.send('move', { direction, running: true, sequence: state.sequence })
  }
  /** One deliberate forgery the service must refuse; its reason is expected. */
  const probe = state => {
    state.probesSent++
    const kind = Math.floor(random() * 3)
    const wall = Object.keys(DELTA).find(d => !isWalkable(state.areaId, state.tx + DELTA[d][0], state.ty + DELTA[d][1]))
    if (kind === 0 && wall) { state.expect.push('movement blocked'); sendMove(state, wall); return }
    if (kind === 1) {
      // A crossing off its portal: to a neighbour, or the old "Ciudad" teleport from anywhere.
      const target = state.areaId === 'ciudad-corazon' ? 'pradera' : pick([...NEIGHBOURS[state.areaId], 'ciudad-corazon'])
      if (portalAt(state.areaId, state.tx, state.ty) !== target) { state.expect.push('area transition denied'); state.room.send('area', { areaId: target, tx: 0, ty: 0 }); return }
    }
    state.expect.push('movement sequence denied')
    state.sequence += 5
    state.room.send('move', { direction: 'up', running: true, sequence: state.sequence })
  }
  const plan = state => {
    if (random() < probes) { probe(state); return }
    if (random() < 0.35) {
      const to = pick(NEIGHBOURS[state.areaId])
      const portal = portalTo(state.areaId, to)
      state.goal = portal; state.crossing = to
      state.route = routeBetween(state.areaId, state, portal, 90) ?? []
    } else {
      const goal = pick(WANDER[state.areaId])
      state.goal = goal; state.crossing = null
      state.route = routeBetween(state.areaId, state, goal, 90) ?? []
    }
  }
  const tick = state => {
    if (!state.ready || state.waitingArea) return
    if (state.route.length) { sendMove(state, state.route.shift()); return }
    if (state.crossing && state.goal && state.tx === state.goal.tx && state.ty === state.goal.ty && state.areaId === state.goal.areaId) {
      state.waitingArea = state.crossing
      state.crossing = null
      state.room.send('area', { areaId: state.waitingArea })
      return
    }
    plan(state)
  }
  const timer = setInterval(() => { for (const state of clients) tick(state) }, STEP_MS)
  const samples = []
  const sampler = setInterval(async () => { try { const m = await metrics(); samples.push({ rss: m.memoryMb?.rss, heap: m.memoryMb?.heapUsed, loopP99: m.eventLoopDelayMs?.p99 }) } catch { /* sampling only */ } }, 1000)
  await delay(durationMs)
  clearInterval(timer)
  clearInterval(sampler)
  await delay(300)
  const seconds = (performance.now() - started) / 1000
  const after = await metrics()
  const finalDistribution = Object.fromEntries(AREAS.map(a => [a, clients.filter(c => c.areaId === a).length]))
  for (const state of clients) await state.room.leave()

  const sum = key => clients.reduce((a, c) => a + c[key], 0)
  const merge = bucket => clients.reduce((acc, c) => { for (const [k, v] of Object.entries(c.refusals[bucket])) acc[k] = (acc[k] ?? 0) + v; return acc }, {})
  const rtt = clients.flatMap(c => c.rtt)
  const diff = (key, sub) => (after[key]?.[sub] ?? 0) - (before[key]?.[sub] ?? 0)
  console.log(JSON.stringify({
    benchmark: 'caves-4-navigation', players, seconds: round(seconds), seed: Number(option('seed', 4)), probes, joinMs: round(joinMs),
    distribution: { start: distribution, end: finalDistribution },
    client: {
      movesSent: clients.reduce((a, c) => a + c.sequence, 0), movesAccepted: sum('acceptedMoves'), crossingsAccepted: sum('acceptedCrossings'),
      probesSent: sum('probesSent'), refusals: { expected: merge('expected'), unexpected: merge('unexpected') },
      leaks: sum('leaks'), errors: sum('errors'), pendingExpected: clients.reduce((a, c) => a + c.expect.length, 0),
      ackRttMs: { p50: round(percentile(rtt, 0.5)), p95: round(percentile(rtt, 0.95)), p99: round(percentile(rtt, 0.99)), max: round(Math.max(0, ...rtt)) },
    },
    server: {
      moves: (after.moves ?? 0) - (before.moves ?? 0), areaChanges: (after.areaChanges ?? 0) - (before.areaChanges ?? 0),
      transitions: { portal: diff('transitions', 'portal'), resync: diff('transitions', 'resync') },
      rejections: Object.fromEntries(Object.keys(after.rejections ?? {}).map(k => [k, (after.rejections[k] ?? 0) - (before.rejections?.[k] ?? 0)])),
      eventLoopDelayMs: after.eventLoopDelayMs, memoryMb: after.memoryMb,
      memoryPeakMb: { rss: Math.max(0, ...samples.map(s => s.rss ?? 0)), heapUsed: Math.max(0, ...samples.map(s => s.heap ?? 0)) },
      loopP99MaxSampleMs: Math.max(0, ...samples.map(s => s.loopP99 ?? 0)),
    },
  }, null, 2))
} finally {
  server.kill()
}
