// Run with scripts/perf/remote-fidelity/run.sh. PERF-1 measurement tool, not product code.
/* eslint-disable @typescript-eslint/no-explicit-any -- the harness drives private engine/adapter/room state through untyped handles */
//
// Remote movement fidelity: what a second player sees of a first one.
//
// Everything that decides the picture is the real code:
//   - the mover's local walking and send cadence (actors.ts driveWalker, as game.ts drives it);
//   - the server (PresenceRoom with its 50 ms delta batching; Colyseus base stubbed);
//   - the observer's adapter and remote-actor queue (ColyseusPresence + WildlandsGame).
// Only the network is modelled: one-way latency, jitter, TCP ordering and, for
// scenario G, moves bunched on the uplink. Time is virtual, so runs are exact
// and repeatable; the JSON is meant to be diffed between commits.
import { WildlandsGame } from '../../../src/features/wildlands/engine/game'
import { Atlas } from '../../../src/features/wildlands/areas/atlas'
import {
  actorPosition, createActor, createWalkerState, driveWalker, isMoving, RUN_SPEED, WALK_SPEED,
  type Actor, type MoveRules,
} from '../../../src/features/wildlands/engine/actors'
import type { Dir } from '../../../src/features/wildlands/engine/characters'
import { RemoteStepPlayback } from '../../../src/features/wildlands/engine/remotePlayback'
import { ColyseusPresence } from '../../../src/features/wildlands/multiplayer/api/colyseusPresence'
// @ts-expect-error untyped JS module
import { PresenceRoom } from '../../../services/realtime/src/rooms/PresenceRoom.js'
// @ts-expect-error untyped JS module
import { metrics } from '../../../services/realtime/src/observability/metrics.js'

// Trainer sheets never load here: remote actors keep the fallback sprite, which
// does not change movement. Sprite lifecycle is measured in the browser probe.
;(globalThis as any).Image = class { set src(_value: string) {} }

const TILE = 16
const FLUSH_MS = 50
const EPOCH = 1_800_000_000_000

// ── virtual clock and a TCP-ordered link ─────────────────────────────────────

let now = 0
Date.now = () => EPOCH + now

function mulberry32(seed: number): () => number {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface NetworkProfile { name: string; baseMs: number; jitterMs: number; stallChance: number; stallMs: number }
const PROFILES: Record<string, NetworkProfile> = {
  lan: { name: 'lan', baseMs: 2, jitterMs: 1, stallChance: 0, stallMs: 0 },
  // Buenos Aires → Miami: movement RTT p50 155 / p99 181 ms measured in production (worklog, 2026-09-23).
  miami: { name: 'miami', baseMs: 78, jitterMs: 12, stallChance: 0, stallMs: 0 },
  rough: { name: 'rough', baseMs: 78, jitterMs: 35, stallChance: 0.02, stallMs: 250 },
  // PERF-2 model of the iPhone on home Wi-Fi: short path, noisy radio, rare
  // retransmission pauses. Modelled, not measured per packet.
  wifi: { name: 'wifi', baseMs: 8, jitterMs: 25, stallChance: 0.01, stallMs: 120 },
}

class Link {
  private readonly queue: { due: number; run: () => void }[] = []
  private lastDue = 0
  constructor(private readonly profile: NetworkProfile, private readonly random: () => number) {}
  send(run: () => void): void {
    const p = this.profile
    let delay = p.baseMs + (this.random() * 2 - 1) * p.jitterMs
    if (p.stallChance > 0 && this.random() < p.stallChance) delay += p.stallMs
    // TCP: a message never overtakes the one sent before it.
    const due = Math.max(now + Math.max(0, delay), this.lastDue)
    this.lastDue = due
    this.queue.push({ due, run })
  }
  deliver(): void {
    while (this.queue.length && this.queue[0].due <= now) this.queue.shift()!.run()
  }
}

// ── scripted movers ──────────────────────────────────────────────────────────

/** `pace` scales the local speed as water does (0.7); the gait sent stays the same. */
type Leg = { dir: Dir; run: boolean; tiles: number; pace?: number } | { stopMs: number }
interface Arrival { seq: number; tx: number; ty: number; at: number }

const FREE: MoveRules = { blocked: () => false, occupied: () => false }

class Mover {
  readonly actor: Actor
  readonly walker = createWalkerState()
  readonly arrivals: Arrival[] = []
  seq = 0
  private leg = 0
  private tilesInLeg = 0
  private stopUntil = -1
  /** Held odd moves when the uplink bunches (scenario G). */
  private held: (() => void) | null = null

  constructor(readonly id: string, readonly sock: any, private readonly legs: Leg[], private readonly uplink: Link,
    private readonly room: any, private readonly pairUp: boolean, start: { tx: number; ty: number }) {
    this.actor = createActor({ id, kind: 'player', habitat: 'any', tx: start.tx, ty: start.ty })
  }

  get done(): boolean { return this.leg >= this.legs.length && !isMoving(this.actor) }

  private intent(): Leg | null {
    while (this.leg < this.legs.length) {
      const leg = this.legs[this.leg]
      if ('stopMs' in leg) {
        if (this.stopUntil < 0) this.stopUntil = now + leg.stopMs
        if (now < this.stopUntil) return leg
        this.stopUntil = -1; this.leg++; continue
      }
      if (this.tilesInLeg < leg.tiles) return leg
      this.leg++; this.tilesInLeg = 0
    }
    return null
  }

  frame(dt: number): void {
    // Advances finished legs and stop timers before this frame's input is read.
    this.intent()
    // As game.ts update(): the gait is latched while standing and again at the
    // start of every chained step, so a Shift change applies from the next tile.
    const latch = (actor: Actor) => {
      const leg = this.intent()
      const moving = leg && !('stopMs' in leg) ? leg : null
      actor.running = !!moving?.run
      actor.speed = (actor.running ? RUN_SPEED : WALK_SPEED) * (moving?.pace ?? 1)
    }
    if (!isMoving(this.actor)) latch(this.actor)
    driveWalker(this.actor, () => {
      const next = this.intent()
      return next && !('stopMs' in next) ? next.dir : null
    }, dt, FREE, this.walker, (tx, ty) => {
      // game.ts onPlayerArrive: the intent is sent once the local step completes.
      this.tilesInLeg++
      const seq = ++this.seq
      this.arrivals.push({ seq, tx, ty, at: now })
      const payload = { direction: this.actor.dir, running: this.actor.running, sequence: seq }
      const send = () => this.room.move(this.sock, payload)
      if (!this.pairUp) this.uplink.send(send)
      else if (this.held) { const first = this.held; this.held = null; this.uplink.send(() => { first(); send() }) }
      else this.held = send
    }, false, latch)
    if (this.pairUp && this.held && this.done) { this.uplink.send(this.held); this.held = null }
  }
}

// ── scenarios ────────────────────────────────────────────────────────────────

const run = (dir: Dir, tiles: number): Leg => ({ dir, run: true, tiles })
const walk = (dir: Dir, tiles: number): Leg => ({ dir, run: false, tiles })
const zigzag = (count: number): Leg[] => Array.from({ length: count }, (_, i) => run(i % 2 ? 'down' : 'right', 1))

interface Scenario { id: string; name: string; movers: Leg[][]; pairUp?: boolean }
const SCENARIOS: Scenario[] = [
  { id: 'A', name: 'walk straight', movers: [[walk('right', 16)]] },
  { id: 'B', name: 'run straight', movers: [[run('right', 16)]] },
  { id: 'C', name: 'walk then run', movers: [[walk('right', 6), run('right', 10)]] },
  { id: 'D', name: 'run, stop, run', movers: [[run('right', 10), { stopMs: 1500 }, run('down', 6)]] },
  { id: 'E', name: 'run and reverse', movers: [[run('right', 8), run('left', 8)]] },
  { id: 'F', name: 'zig-zag running', movers: [zigzag(16)] },
  { id: 'G', name: 'run, two moves per uplink packet', movers: [[run('right', 16)]], pairUp: true },
  // Shift released mid-run (PERF-1: the walker kept running until it stopped).
  { id: 'I', name: 'run then walk without stopping', movers: [[run('right', 6), walk('right', 10)]] },
  // Running through water: the sender moves at 0.7× but reports the nominal gait.
  { id: 'K', name: 'run through water', movers: [[{ ...run('right', 12), pace: 0.7 }, { ...run('down', 12), pace: 0.7 }]] },
  // A long constant run: does the observer's lag grow, and does it ever catch up?
  { id: 'J', name: 'long run, 80 tiles', movers: [[run('right', 20), run('down', 20), run('left', 20), run('up', 20)]] },
  {
    id: 'H', name: 'ten players running at once',
    movers: Array.from({ length: 10 }, (_, i) => {
      const dirs: Dir[] = ['right', 'down', 'left', 'up']
      return [run(dirs[i % 4], 4 + (i % 3)), run(dirs[(i + 1) % 4], 5), walk(dirs[(i + 2) % 4], 3), run(dirs[(i + 3) % 4], 6)]
    }),
  },
]

// ── one run: movers → server → observer ──────────────────────────────────────

interface ObserverFrame {
  at: number; x: number; y: number; tx: number; ty: number; fx: number; fy: number; moving: boolean; applied: number
  /** Unrounded position in tiles along the route, and the gait speed of the step on screen. */
  px: number; py: number; speed: number
}

let socketSeq = 0
function socket(onSend: (type: string, payload: any) => void): any {
  return { sessionId: `fidelity-${++socketSeq}`, userData: undefined, leave() {}, send: onSend }
}

let runCounter = 0
async function runOnce(scenario: Scenario, profile: NetworkProfile, observerHz: number, seed: number) {
  // Unique per run: the room keeps a reconnect cache keyed by user id.
  const runId = ++runCounter
  now = 0
  const random = mulberry32(seed)
  const room = new PresenceRoom(); room.onCreate()
  const before = { ...metrics.batching }
  const flushPhase = Math.floor(random() * FLUSH_MS)

  // Observer: a real ColyseusPresence feeding a real WildlandsGame remote layer.
  const atlas = new Atlas()
  const g: any = Object.create(WildlandsGame.prototype)
  Object.assign(g, {
    area: atlas.get('ciudad-corazon'), pokedex: [], renderer: { playerSprites: {} },
    remoteActors: [], remoteCompanions: [], remoteActorsById: new Map(), remoteCompanionsByOwnerId: new Map(),
    remoteCharacterIds: new Map(), remoteMoveSequences: new Map(), remotePlayback: new RemoteStepPlayback(), remoteUpdatesSinceSample: 0,
  })
  const received = new Map<string, { at: number; tx: number; ty: number; seq: number }[]>()
  const port = {
    setPresenceAccess() {}, setAuthoritativeActor() {}, presenceRejected() {},
    replaceRemoteActors: (actors: any[]) => g.replaceRemoteActors(actors),
    removeRemoteActor: (id: string) => g.removeRemoteActor(id),
    upsertRemoteActor: (actor: any) => {
      const list = received.get(actor.id) ?? []
      list.push({ at: now, tx: actor.tx, ty: actor.ty, seq: actor.moveSequence })
      received.set(actor.id, list)
      g.upsertRemoteActor(actor)
    },
  }
  const adapter: any = new ColyseusPresence(port as any, null)
  const downlink = new Link(profile, random)
  const observerSock = socket((type, payload) => downlink.send(() => {
    if (type === 'presence:snapshot') adapter.replace(payload.actors)
    else if (type === 'presence:batch') adapter.applyBatch(payload)
    else if (type === 'presence:delta') adapter.apply(payload)
  }))
  await room.onJoin(observerSock, { presenceProtocol: 2 }, { kind: 'player', userId: `observer-${runId}`, username: 'Observer', token: null })
  room.ready(observerSock)

  const uplink = new Link(profile, random)
  const movers: Mover[] = []
  for (let i = 0; i < scenario.movers.length; i++) {
    const id = `mover-${runId}-${i}`
    const sock = socket(() => {})
    await room.onJoin(sock, { presenceProtocol: 2 }, { kind: 'player', userId: id, username: `M${i}`, token: null })
    room.ready(sock)
    movers.push(new Mover(id, sock, scenario.movers[i], uplink, room, scenario.pairUp ?? false, { tx: 31, ty: 20 }))
  }
  room.flushDeltaBatches()

  const frames = new Map<string, ObserverFrame[]>(movers.map(m => [m.id, []]))
  const localStep = 1000 / 60
  const observerStep = 1000 / observerHz
  let nextLocal = 0, nextObserver = 0, nextFlush = flushPhase, settle = -1
  for (let t = 0; t < 60_000; t++) {
    now = t
    uplink.deliver()
    if (t >= nextFlush) { room.flushDeltaBatches(); nextFlush += FLUSH_MS }
    downlink.deliver()
    if (t >= nextLocal) { for (const m of movers) m.frame(localStep / 1000); nextLocal += localStep }
    if (t >= nextObserver) {
      g.advanceRemoteActors(observerStep / 1000)
      for (const m of movers) {
        const actor: Actor | undefined = g.remoteActorsById.get(m.id)
        if (!actor) continue
        const { x, y } = actorPosition(actor)
        frames.get(m.id)!.push({
          at: t, x, y, tx: actor.tx, ty: actor.ty, fx: actor.fromTx, fy: actor.fromTy,
          moving: isMoving(actor), applied: g.remoteMoveSequences.get(m.id) ?? 0,
          px: actor.fromTx + (actor.tx - actor.fromTx) * actor.progress,
          py: actor.fromTy + (actor.ty - actor.fromTy) * actor.progress, speed: actor.speed,
        })
      }
      nextObserver += observerStep
    }
    if (settle < 0 && movers.every(m => m.done)) settle = t + 1500
    if (settle >= 0 && t >= settle) break
  }

  const batching = Object.fromEntries(Object.keys(metrics.batching).map(k => [k, k === 'maxBatch' ? metrics.batching[k] : metrics.batching[k] - before[k]]))
  const perMover = movers.map(m => analyse(m, received.get(m.id) ?? [], frames.get(m.id)!, observerStep))
  room.onLeave(observerSock); for (const m of movers) room.onLeave(m.sock)
  return { scenario: scenario.id, name: scenario.name, network: profile.name, observerHz, serverBatching: batching, resyncs: g.remotePlayback.resyncs, ...aggregate(perMover) }
}

// ── analysis ─────────────────────────────────────────────────────────────────

function pct(values: number[], p: number): number {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)]
}
const r1 = (v: number) => Math.round(v * 10) / 10
const r2 = (v: number) => Math.round(v * 100) / 100

function analyse(m: Mover, received: { at: number; tx: number; ty: number; seq: number }[], frames: ObserverFrame[], observerStep: number) {
  const arrivals = m.arrivals
  // Continuous local segments: a gap longer than 1.5 walking steps is a real stop.
  const segmentOf = new Map<number, number>()
  const segmentEnd: Arrival[] = []
  let segment = 0
  arrivals.forEach((a, i) => {
    if (i > 0 && a.at - arrivals[i - 1].at > 1.5 * 1000 / WALK_SPEED) segment++
    segmentOf.set(a.seq, segment)
    segmentEnd[segment] = a
  })

  // Receive side.
  const intervals: number[] = []; const distance = { one: 0, two: 0, threeOrMore: 0, same: 0 }; let seqGaps = 0
  for (let i = 1; i < received.length; i++) {
    intervals.push(received[i].at - received[i - 1].at)
    const d = Math.abs(received[i].tx - received[i - 1].tx) + Math.abs(received[i].ty - received[i - 1].ty)
    if (d === 0) distance.same++; else if (d === 1) distance.one++; else if (d === 2) distance.two++; else distance.threeOrMore++
    if (received[i].seq - received[i - 1].seq > 1) seqGaps++
  }

  // Visual side: snaps, stop-and-go stalls, representation delay, observed pace.
  let snaps = 0, maxSnapTiles = 0, stallFrames = 0, stallEpisodes = 0, longestStallMs = 0, run = 0
  for (let i = 0; i < frames.length; i++) {
    const f = frames[i]
    if (i > 0) {
      const jump = Math.abs(f.x - frames[i - 1].x) + Math.abs(f.y - frames[i - 1].y)
      if (jump > TILE / 2) { snaps++; maxSnapTiles = Math.max(maxSnapTiles, Math.round(jump / TILE)) }
    }
    const seg = segmentOf.get(f.applied)
    const last = seg === undefined ? undefined : segmentEnd[seg]
    const stalled = !f.moving && last !== undefined && (f.tx !== last.tx || f.ty !== last.ty)
    if (stalled) { stallFrames++; run++ } else if (run) { stallEpisodes++; longestStallMs = Math.max(longestStallMs, run * observerStep); run = 0 }
  }
  if (run) { stallEpisodes++; longestStallMs = Math.max(longestStallMs, run * observerStep) }

  // Pace: on-screen speed over nominal gait speed, between consecutive moving
  // frames that did not snap. 1 is the sender's pace; the spread is how much
  // the playback rate varies to absorb jitter and catch up.
  const paceRatios: number[] = []
  for (let i = 1; i < frames.length; i++) {
    const a = frames[i - 1], b = frames[i]
    if (!a.moving || !b.moving || b.speed !== a.speed) continue
    const d = Math.abs(b.px - a.px) + Math.abs(b.py - a.py)
    if (d > 0.5) continue
    paceRatios.push(d / (observerStep / 1000) / b.speed)
  }

  // Representation delay per step, in sequence order (tiles repeat in E and F):
  // the first frame at rest on that tile once its step has been applied. A tile
  // the observer never rests on before a later step was applied was snapped past.
  const delays: number[] = []; let skipped = 0; let p = 0
  for (const a of arrivals) {
    while (p < frames.length && frames[p].applied < a.seq) p++
    let q = p, seen = -1
    // Reached: resting on it, or already walking out of it (it is the step's origin).
    for (; q < frames.length && frames[q].applied <= a.seq + 4; q++) {
      const f = frames[q]
      const resting = !f.moving && f.tx === a.tx && f.ty === a.ty
      const leaving = f.moving && f.fx === a.tx && f.fy === a.ty && (f.tx !== a.tx || f.ty !== a.ty)
      if (resting || leaving) { seen = f.at; break }
    }
    if (seen < 0) skipped++
    else { delays.push(seen - a.at); p = q }
  }
  const movingMs = arrivals.length > 1 ? arrivals[arrivals.length - 1].at - arrivals[0].at : 0
  const localSteps = arrivals.slice(1).map((a, i) => a.at - arrivals[i].at)
  return {
    localSteps,
    tiles: arrivals.length, received: received.length, intervals, distance, seqGaps, snaps, maxSnapTiles,
    stallFrames, stallEpisodes, longestStallMs, stallMs: stallFrames * observerStep, delays, skipped, movingMs, paceRatios,
  }
}

function aggregate(list: ReturnType<typeof analyse>[]) {
  const sum = (f: (x: ReturnType<typeof analyse>) => number) => list.reduce((s, x) => s + f(x), 0)
  const intervals = list.flatMap(x => x.intervals)
  const delays = list.flatMap(x => x.delays)
  const movingMs = sum(x => x.movingMs)
  return {
    movers: list.length,
    localTiles: sum(x => x.tiles),
    /** The mover's own step cadence: 267 ms walking, 133 ms running. */
    localStepMs: (() => { const s = list.flatMap(x => x.localSteps).filter(v => v < 1000); return { min: r1(Math.min(...s)), p50: r1(pct(s, 0.5)), max: r1(Math.max(...s)) } })(),
    receive: {
      updates: sum(x => x.received),
      intervalMs: { p50: r1(pct(intervals, 0.5)), p95: r1(pct(intervals, 0.95)), max: r1(Math.max(0, ...intervals)) },
      tileDistance: {
        one: sum(x => x.distance.one), two: sum(x => x.distance.two),
        threeOrMore: sum(x => x.distance.threeOrMore), same: sum(x => x.distance.same),
      },
      sequenceGaps: sum(x => x.seqGaps),
    },
    visual: {
      snaps: sum(x => x.snaps),
      maxSnapTiles: Math.max(0, ...list.map(x => x.maxSnapTiles)),
      tilesNeverShown: sum(x => x.skipped),
      stallEpisodes: sum(x => x.stallEpisodes),
      stallMsPerMovingSecond: movingMs ? r1(sum(x => x.stallMs) / (movingMs / 1000)) : 0,
      longestStallMs: r1(Math.max(0, ...list.map(x => x.longestStallMs))),
      representationDelayMs: { p50: r1(pct(delays, 0.5)), p95: r1(pct(delays, 0.95)), max: r1(Math.max(0, ...delays)) },
      /** On-screen pace over the sender's gait speed, per frame (1 = exact). */
      pace: (() => { const r = list.flatMap(x => x.paceRatios); return { p5: r2(pct(r, 0.05)), p50: r2(pct(r, 0.5)), p95: r2(pct(r, 0.95)) } })(),
    },
  }
}

// ── CLI ──────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2)
const pick = (name: string, fallback: string) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback }
const scenarioIds = pick('scenarios', 'A,B,C,D,E,F,G,H').split(',')
const networks = pick('networks', 'lan,miami,rough').split(',')
const rates = pick('hz', '60,144').split(',').map(Number)
const seeds = Number(pick('seeds', '3'))

const results = []
for (const id of scenarioIds) {
  const scenario = SCENARIOS.find(s => s.id === id)
  if (!scenario) throw new Error(`unknown scenario ${id}`)
  for (const network of networks) for (const hz of rates) for (let s = 1; s <= seeds; s++) {
    results.push({ seed: s, ...(await runOnce(scenario, PROFILES[network], hz, s)) })
  }
}
console.log(JSON.stringify({ tool: 'remote-fidelity-v1', label: process.env.LABEL ?? null, results }, null, 2))
