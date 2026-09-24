// Run with scripts/perf/transition-trace/run.sh. TRANS-1 measurement tool, not product code.
/* eslint-disable @typescript-eslint/no-explicit-any -- the harness drives private engine/adapter/room state through untyped handles */
//
// Transition fidelity: what observer B sees of player A across building doors
// and area changes, with every decision made by the real code:
//   - A's local presence logic (WildlandsGame: step announcement, ack
//     reconciliation, safe point, placeAtDoor, area travel and placement);
//   - the server (PresenceRoom, interest, 50 ms batching; Colyseus base stubbed);
//   - B's adapter and remote playback (ColyseusPresence + WildlandsGame).
// A's walking uses the same driveWalker and collision as the game. Only the
// network is modelled (fixed one-way latency, TCP order). Output: one timeline
// per scenario, and counters of safe-point corrections and wrong placements.
import { WildlandsGame } from '../../../src/features/wildlands/engine/game'
import { Atlas } from '../../../src/features/wildlands/areas/atlas'
import { actorPosition, createActor, createWalkerState, driveWalker, isMoving, type Actor, type MoveRules } from '../../../src/features/wildlands/engine/actors'
import type { Dir } from '../../../src/features/wildlands/engine/characters'
import { Entrances } from '../../../src/features/wildlands/engine/doors'
import { findPath } from '../../../src/features/wildlands/engine/pathfinding'
import { AreaTravel } from '../../../src/features/wildlands/engine/travel'
import { RemoteStepPlayback } from '../../../src/features/wildlands/engine/remotePlayback'
import { PresenceDiagnostics } from '../../../src/features/wildlands/multiplayer/domain/presenceDiagnostics'
import { ColyseusPresence } from '../../../src/features/wildlands/multiplayer/api/colyseusPresence'
// @ts-expect-error untyped JS module
import { PresenceRoom } from '../../../services/realtime/src/rooms/PresenceRoom.js'

;(globalThis as any).Image = class { set src(_value: string) {} }

const TILE = 16
const FLUSH_MS = 50
const LATENCY_MS = 30
const EPOCH = 1_800_000_000_000
let now = 0
Date.now = () => EPOCH + now

class Link {
  private readonly queue: { due: number; run: () => void }[] = []
  send(run: () => void): void { this.queue.push({ due: now + LATENCY_MS, run }) }
  deliver(): void { while (this.queue.length && this.queue[0].due <= now) this.queue.shift()!.run() }
}

type Event = { t: number; who: 'A' | 'server' | 'B'; what: string }
const pos = (a: { tx: number; ty: number }) => `(${a.tx},${a.ty})`

// ── A: the real local presence logic around a scripted walker ────────────────

type Step =
  | { walk: Dir; tiles: number }
  | { panelMs: number }
  | { waitMs: number }

function localGame(atlas: Atlas, log: (what: string) => void, room: any, sock: any, uplink: Link) {
  const g: any = Object.create(WildlandsGame.prototype)
  const area = atlas.get('ciudad-corazon')
  Object.assign(g, {
    atlas, area, spectator: false, localPresenceActorId: null, pendingPresenceArea: null,
    awaitingAreaSnapshot: false, receivedAuthoritativeActor: false, nextMoveSequence: 0, walker: createWalkerState(),
    nav: { cancel() {}, active: false }, travel: new AreaTravel(), companion: { reset() {}, playerArrived() {} },
    camX: 0, camY: 0, seconds: 0, toast: null, keys: { sprinting: false }, pokedex: [], owned: [], wildPokemonIds: [],
    renderer: { npcSprites: {}, playerSprites: {} }, placedObjects: { isSolid: () => false, clearArea() {}, register() {} },
    onTownPosition: null, presenceDiagnostics: new PresenceDiagnostics(),
    player: createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 0, ty: 0 }),
    presence: {
      move: (direction: Dir, running: boolean, sequence: number) => {
        log(`send move #${sequence} ${direction} (local step ${pos(g.player)} → server applies it to its own tile)`)
        uplink.send(() => room.move(sock, { direction, running, sequence }))
      },
      changeArea: (areaId: string) => {
        log(`send area ${areaId} (local ${g.area.id} ${pos(g.player)})`)
        uplink.send(() => room.changeArea(sock, { areaId }))
      },
      observe() {},
    },
  })
  g.entrances = new Entrances(door => { g.enteredDoor = door })
  // Reasons are read from the game's own diagnostics around each authoritative message.
  const authoritative = (actor: any, source: 'snapshot' | 'self') => {
    const before = g.presenceDiagnostics.snapshot()
    const at = `${g.area.id} ${pos(g.player)}`
    g.setAuthoritativeActor(actor, source)
    const after = g.presenceDiagnostics.snapshot()
    const moved = `${g.area.id} ${pos(g.player)}`
    if (after.solidRecoveries > before.solidRecoveries) log(`SAFE POINT: ${source} #${actor.moveSequence} says ${actor.areaId} ${pos(actor)}, solid/unreachable locally → player ${at} → ${moved}, placement requested`)
    else if (after.reconciliations > before.reconciliations) log(`RECONCILE: ${source} #${actor.moveSequence} ${pos(actor)} → player ${at} → ${moved}`)
    else if (after.staleAcksIgnored > before.staleAcksIgnored) log(`ack #${actor.moveSequence} ignored (waiting for area snapshot)`)
    else if (at !== moved) log(`placed by ${source} #${actor.moveSequence}: ${at} → ${moved}`)
  }
  return { g, authoritative }
}

// ── one scenario ─────────────────────────────────────────────────────────────

interface Scenario {
  id: string; name: string; start: 'door' | 'west-gate'; script: Step[]; panelMs?: number
  /** B is a guest observing this spot (a guest sees without being seen or moving). */
  observer: { areaId: 'ciudad-corazon' | 'pradera'; tx: number; ty: number }
}

let runs = 0
async function run(scenario: Scenario) {
  now = 0
  const runId = ++runs
  const events: Event[] = []
  const log = (who: Event['who']) => (what: string) => events.push({ t: now, who, what })
  const atlas = new Atlas()
  const room = new PresenceRoom(); room.onCreate(); room.deltaBatching = true
  const uplink = new Link(); const downA = new Link(); const downB = new Link()

  // B: observer, a real adapter feeding a real remote layer.
  const b: any = Object.create(WildlandsGame.prototype)
  Object.assign(b, {
    area: atlas.get(scenario.observer.areaId), pokedex: [], renderer: { playerSprites: {} },
    remoteActors: [], remoteCompanions: [], remoteActorsById: new Map(), remoteCompanionsByOwnerId: new Map(),
    remoteCharacterIds: new Map(), remoteMoveSequences: new Map(), remotePlayback: new RemoteStepPlayback(), remoteUpdatesSinceSample: 0,
  })
  const bLog = log('B')
  const adapter: any = new ColyseusPresence({
    setPresenceAccess() {}, setAuthoritativeActor() {}, presenceRejected() {},
    replaceRemoteActors: (actors: any[]) => b.replaceRemoteActors(actors),
    removeRemoteActor: (id: string) => b.removeRemoteActor(id),
    upsertRemoteActor: (actor: any) => b.upsertRemoteActor(actor),
  } as any, null)
  const describe = (d: any) => `${d.type} ${d.actor.areaId ?? ''} ${pos(d.actor)} #${d.actor.moveSequence}${d.via ? ` via ${d.via.map(pos).join(' ')}` : ''}`
  const serverLog = log('server')
  const bSock = { sessionId: `b-${runId}`, userData: undefined, leave() {}, send: (type: string, payload: any) => {
    if (type === 'presence:batch') for (const d of payload) if (d.actor.id === aId) serverLog(`→ B ${describe(d)}`)
    if (type === 'presence:delta' && payload.actor.id === aId) serverLog(`→ B ${describe(payload)}`)
    downB.send(() => {
      if (type === 'presence:snapshot') adapter.replace(payload.actors)
      else if (type === 'presence:batch') adapter.applyBatch(payload)
      else if (type === 'presence:delta') adapter.apply(payload)
    })
  } }
  await room.onJoin(bSock, { presenceProtocol: 2 }, { kind: 'guest', token: null })
  room.observe(bSock, scenario.observer)

  // A.
  const aId = `mover-${runId}`
  const aLog = log('A')
  const holder: { local?: ReturnType<typeof localGame> } = {}
  const aSock = { sessionId: `a-${runId}`, userData: undefined, leave() {}, send: (type: string, payload: any) => downA.send(() => {
    if (type === 'presence:snapshot' && payload.self) holder.local!.authoritative(payload.self, 'snapshot')
    if (type === 'presence:self') holder.local!.authoritative(payload, 'self')
  }) }
  const local = holder.local = localGame(atlas, aLog, room, aSock, uplink)
  const g = local.g
  await room.onJoin(aSock, { presenceProtocol: 2 }, { kind: 'player', userId: aId, username: 'A', token: null })
  room.ready(aSock)
  const tick = () => { uplink.deliver(); downA.deliver(); downB.deliver() }
  for (let i = 0; i < 200; i++) { now++; tick(); if (i % FLUSH_MS === 0) room.flushDeltaBatches() }

  // Where the scenario starts: request a server placement there through ordinary moves.
  const town = atlas.get('ciudad-corazon') as any
  const door = town.doors[0]
  const walkTo = (target: { tx: number; ty: number }): Dir[] => findPath({
    start: { tx: g.player.tx, ty: g.player.ty }, target, radius: 60, maxNodes: 20000,
    isGoal: (tx, ty) => tx === target.tx && ty === target.ty,
    blocked: (tx, ty) => g.solidAt(tx, ty) || !!g.travel.destinationAt(g.area, tx, ty) || g.entrances.isDoor(g.area, tx, ty),
  }) ?? []
  const rules: MoveRules = { blocked: (_a, tx, ty) => g.solidAt(tx, ty), occupied: () => false }

  // Script runner.
  let queue: Dir[] = []
  const pendingScript = [...scenario.script]
  let holdUntil = 0
  let inPanel = false
  const setup: Dir[] = scenario.start === 'door' ? walkTo(door.exit) : scenario.start === 'west-gate' ? walkTo({ tx: 8, ty: 41 }) : []
  queue = [...setup]
  const bRendered = { present: false, x: 0, y: 0, tx: 0, ty: 0 }
  let setupDone = setup.length === 0
  const frames = 60_000
  for (let f = 0; f < frames; f++) {
    now += 1
    tick()
    if (now % FLUSH_MS === 0) room.flushDeltaBatches()
    if (now % 16 !== 0) continue
    const dt = 1 / 60
    // A's frame, as game.update: travel fade, walker, arrivals.
    g.travel.update(dt, (to: any, from: any) => {
      g.enterArea(to, from, null)
      aLog(`area swap ${from} → ${to}, placed at ${pos(g.player)}`)
      const presenceArea = to === 'ciudad-corazon' ? 'ciudad-corazon' : to === 'pradera' ? 'pradera' : null
      if (presenceArea) g.requestPresencePlacement(presenceArea)
    })
    if (!isMoving(g.player)) g.latchGait(g.player, g.player.tx, g.player.ty)
    if (!g.travel.active && !inPanel && now >= holdUntil && queue.length === 0 && setupDone && pendingScript.length) {
      const next = pendingScript.shift()!
      if ('walk' in next) queue = Array(next.tiles).fill(next.walk)
      else if ('waitMs' in next) holdUntil = now + next.waitMs
      else if ('panelMs' in next) { holdUntil = now + next.panelMs; inPanel = true; aLog(`panel open (${next.panelMs} ms), player ${pos(g.player)}`) }
    }
    if (inPanel && now >= holdUntil) {
      inPanel = false
      const feature = g.enteredDoor?.feature ?? door.feature
      const before = pos(g.player)
      const sequence = g.nextMoveSequence
      g.placeAtDoor(feature)
      const how = g.nextMoveSequence > sequence ? `announced as move #${g.nextMoveSequence}` : 'local only, nothing sent'
      aLog(`panel closed → placeAtDoor ${before} → ${pos(g.player)} (${how})`)
    }
    // Read at every tile boundary, like the game's tap routes.
    const want = () => (!inPanel && !g.travel.active ? queue[0] ?? null : null)
    driveWalker(g.player, want, dt, rules, g.walker, (tx, ty) => {
      queue.shift()
      if (!setupDone && queue.length === 0) { setupDone = true; aLog(`--- scenario starts at ${g.area.id} ${pos(g.player)} ---`) }
      if (g.entrances.arrive(g.area, tx, ty)) { aLog(`entered building door ${pos({ tx, ty })}`); queue = []; pendingScript.unshift({ panelMs: scenario.panelMs ?? 800 }) }
      const to = g.travel.destinationAt(g.area, tx, ty)
      if (to) { aLog(`on portal ${pos({ tx, ty })} → travel to ${to}`); queue = []; g.travelTo(to) }
    }, false, (p: Actor) => g.startStep(p))

    // B's frame.
    b.advanceRemoteActors(dt)
    const actor = b.remoteActorsById.get(aId)
    if (!actor && bRendered.present) { bRendered.present = false; bLog(`A disappears (was ${pos(bRendered)})`) }
    if (actor) {
      const p = actorPosition(actor)
      const jump = bRendered.present ? Math.abs(p.x - bRendered.x) + Math.abs(p.y - bRendered.y) : 0
      if (!bRendered.present) bLog(`A appears at ${pos(actor)}`)
      else if (jump > TILE / 2) bLog(`A JUMPS ${Math.round(jump / TILE)} tiles to ${pos(actor)}`)
      bRendered.present = true; bRendered.x = p.x; bRendered.y = p.y; bRendered.tx = actor.tx; bRendered.ty = actor.ty
    }
    if (setupDone && !pendingScript.length && !queue.length && !inPanel && !g.travel.active && now > holdUntil + 1500) break
  }
  const d = g.presenceDiagnostics.snapshot()
  const setupEnd = events.findIndex(e => e.what.startsWith('--- scenario starts'))
  const timeline = setupEnd >= 0 ? events.slice(setupEnd) : events
  const jumps = timeline.filter(e => e.who === 'B' && e.what.includes('JUMPS')).length
  // Where B finally draws A against where A really is (same area only).
  const seen = b.remoteActorsById.get(aId)
  const sameArea = b.area.id === g.area.id
  const finalOffset = sameArea && seen ? Math.abs(seen.tx - g.player.tx) + Math.abs(seen.ty - g.player.ty) : 0
  return {
    id: scenario.id, name: scenario.name, finalOffset,
    finalSeen: seen ? pos(seen) : 'absent', finalReal: `${g.area.id} ${pos(g.player)}`,
    safePoint: d.solidRecoveries, reconciliations: d.reconciliations, placements: d.placements,
    observerJumps: jumps, timeline: timeline.map(e => `${String(e.t).padStart(6)} ms  ${e.who.padEnd(6)} ${e.what}`),
  }
}

// ── scenarios ────────────────────────────────────────────────────────────────

const AT_SPAWN = { areaId: 'ciudad-corazon' as const, tx: 31, ty: 20 }
const NEAR_WEST_GATE = { areaId: 'ciudad-corazon' as const, tx: 12, ty: 40 }
const PRADERA_ARRIVAL = { areaId: 'pradera' as const, tx: -3, ty: -66 }
const SCENARIOS: Scenario[] = [
  { id: 'D1', name: 'enter a building, leave, walk left', start: 'door', observer: AT_SPAWN, script: [{ walk: 'up', tiles: 1 }, { walk: 'left', tiles: 3 }] },
  { id: 'D2', name: 'enter, leave, walk right', start: 'door', observer: AT_SPAWN, script: [{ walk: 'up', tiles: 1 }, { walk: 'right', tiles: 3 }] },
  { id: 'D3', name: 'enter, leave, walk down', start: 'door', observer: AT_SPAWN, script: [{ walk: 'up', tiles: 1 }, { walk: 'down', tiles: 3 }] },
  { id: 'D4', name: 'enter and leave three times', start: 'door', observer: AT_SPAWN, script: [
    // Leaving a building steps out of the doorway (automatically after the fix).
    { walk: 'up', tiles: 1 }, { waitMs: 400 }, { walk: 'up', tiles: 1 }, { waitMs: 400 }, { walk: 'left', tiles: 2 },
    { walk: 'right', tiles: 2 }, { walk: 'up', tiles: 1 }, { waitMs: 400 }, { walk: 'right', tiles: 2 },
  ] },
  { id: 'D5', name: 'enter, leave at once, walk left', start: 'door', panelMs: 50, observer: AT_SPAWN, script: [{ walk: 'up', tiles: 1 }, { walk: 'left', tiles: 2 }] },
  { id: 'A1', name: 'town → Pradera → town by the west gate, observed near the gate', start: 'west-gate', observer: NEAR_WEST_GATE,
    script: [{ walk: 'left', tiles: 2 }, { waitMs: 1500 }, { walk: 'down', tiles: 2 }, { walk: 'up', tiles: 3 }, { waitMs: 1500 }, { walk: 'right', tiles: 3 }] },
  { id: 'A2', name: 'town → Pradera → town, observed in Pradera', start: 'west-gate', observer: PRADERA_ARRIVAL,
    script: [{ walk: 'left', tiles: 2 }, { waitMs: 1500 }, { walk: 'down', tiles: 2 }, { walk: 'up', tiles: 3 }, { waitMs: 1500 }, { walk: 'right', tiles: 3 }] },
]

const results = []
for (const scenario of SCENARIOS) results.push(await run(scenario))
const wanted = process.argv.includes('--timeline')
for (const r of results) {
  console.log(`\n## ${r.id} ${r.name}: safe point ${r.safePoint}, reconciliations ${r.reconciliations}, placements ${r.placements}, observer jumps ${r.observerJumps}, B sees A at ${r.finalSeen} while A is at ${r.finalReal} (off by ${r.finalOffset})`)
  if (wanted) console.log(r.timeline.join('\n'))
}
if (process.argv.includes('--json')) console.log(JSON.stringify(results, null, 2))
