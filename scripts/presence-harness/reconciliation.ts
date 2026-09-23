// Run with scripts/presence-harness/run.sh. See docs/wildlands/PERFORMANCE_STABILITY_WORKLOG.md.
/* eslint-disable @typescript-eslint/no-explicit-any -- test harness drives private engine/room state through untyped handles */
// Deterministic presence harness: REAL PresenceRoom (Colyseus base stubbed) + REAL
// WildlandsGame reconciliation (prototype instance, no DOM). Messages are queued in
// both directions to model latency while preserving socket order.
import { WildlandsGame } from '../../src/features/wildlands/engine/game'
import { Atlas } from '../../src/features/wildlands/areas/atlas'
import { createActor, createWalkerState } from '../../src/features/wildlands/engine/actors'
import { PresenceDiagnostics } from '../../src/features/wildlands/multiplayer/domain/presenceDiagnostics'
import { AreaTravel } from '../../src/features/wildlands/engine/travel'
// @ts-expect-error untyped JS module
import { PresenceRoom } from '../../services/realtime/src/rooms/PresenceRoom.js'
// @ts-expect-error untyped JS module
import { metrics } from '../../services/realtime/src/observability/metrics.js'

const DELTA: Record<string, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

export async function world(label: string) {
  const room = new PresenceRoom(); room.onCreate(); room.deltaBatching = false
  const up: Array<() => void> = []; const down: Array<() => void> = []
  const log: string[] = []
  const counters: any = { server: '', recoveries: 0, areaSent: 0, snapshots: 0, selfAcks: 0, rejected: 0, moves: 0 }
  const atlas = new Atlas()
  const g: any = Object.create(WildlandsGame.prototype)
  Object.assign(g, {
    atlas, area: atlas.get('ciudad-corazon'), spectator: false, localPresenceActorId: null, pendingPresenceArea: null,
    receivedAuthoritativeActor: false, nextMoveSequence: 0, walker: createWalkerState(),
    nav: { cancel() {} }, travel: new AreaTravel(), companion: { reset() {} }, camX: 0, camY: 0, seconds: 0, toast: null,
    placedObjects: { isSolid: () => false }, onTownPosition: null, presenceDiagnostics: new PresenceDiagnostics(),
    player: createActor({ id: 'player', kind: 'player', habitat: 'any', tx: 31, ty: 20 }),
  })
  const origSay = g.say
  g.say = function (t: string) { if (t.includes('punto seguro')) counters.recoveries++; log.push(`toast:${t}`); return origSay.call(this, t) }
  const sock: any = { sessionId: 'harness', userData: undefined, leave() {}, send(type: string, payload: any) {
    const a = type === 'presence:snapshot' ? payload.self : type === 'presence:self' ? payload : null
    if (a) counters.server = `${a.areaId}(${a.tx},${a.ty})`
    down.push(() => {
      if (type === 'presence:snapshot') { counters.snapshots++; g.setAuthoritativeActor(payload.self ?? null, 'snapshot') }
      else if (type === 'presence:self') { counters.selfAcks++; g.setAuthoritativeActor(payload, 'self') }
      else if (type === 'presence:error') { counters.rejected++; g.presenceRejected(payload.reason); log.push(`error:${payload.reason}`) }
    })
  } }
  g.presence = {
    move: (direction: string, running: boolean, sequence: number) => { counters.moves++; up.push(() => room.move(sock, { direction, running, sequence })) },
    changeArea: (areaId: string) => { counters.areaSent++; up.push(() => room.changeArea(sock, { areaId })) },
    observe() {}, sendChat() {},
  }
  await room.onJoin(sock, {}, { kind: 'player', userId: `h-${label}`, username: 'H', token: null })
  const flushUp = () => { while (up.length) up.shift()!() }
  const flushDown = (limit = Infinity) => { let n = 0; while (down.length && n++ < limit) down.shift()!() }
  const rtt = (times = 1) => { for (let i = 0; i < times; i++) { flushUp(); flushDown() } }
  up.push(() => room.ready(sock)); rtt()
  const step = (dir: string) => {
    const [dx, dy] = DELTA[dir]; const p = g.player
    p.dir = dir
    if (g.area.isSolid(p.tx + dx, p.ty + dy)) return false
    p.tx += dx; p.ty += dy; p.fromTx = p.tx; p.fromTy = p.ty; p.progress = 1
    g.presence.move(dir, false, ++g.nextMoveSequence) // game.ts onPlayerArrive
    g.presenceDiagnostics.moveSent(g.nextMoveSequence, performance.now())
    return true
  }
  // Mirrors game.ts travel callback (lines 816-823) minus population/lens setup.
  const travel = (to: string) => {
    g.area = atlas.get(to); const from = g.area.id === 'pradera' ? 'ciudad-corazon' : 'pradera'
    g.placePlayer(g.area.arrival(from))
    g.pendingPresenceArea = to
    g.awaitingAreaSnapshot = true // no-op on old client code
    g.presence.changeArea(to)
  }
  const server = () => { const a = [...(PresenceRoom as any)._actors?.values?.() ?? []][0]; return a }
  return { g, room, sock, rtt, flushUp, flushDown, step, travel, counters, log, metrics, up, down }
}

async function scenario1() {
  const w = await world('s1')
  w.travel('pradera'); w.rtt(20)
  return { name: 'S1 enter Pradera, 20 RTT idle', ...w.counters, client: `${w.g.area.id}(${w.g.player.tx},${w.g.player.ty})` }
}
async function scenario2() {
  // Walk a bit, press "Ciudad" (same-area reset) and keep walking before the snapshot arrives.
  const w = await world('s2')
  for (let i = 0; i < 3; i++) w.step('right'); w.rtt()
  w.g.returnToLobby()
  for (let i = 0; i < 3; i++) w.step('down') // sent before the reset snapshot returns
  w.rtt(3)
  const self = w.g.player
  return { name: 'S2 Ciudad reset + keep walking', ...w.counters, client: `(${self.tx},${self.ty})` }
}
async function scenario3() {
  // Round trip Pradera and back, walking in each.
  const w = await world('s3')
  w.travel('pradera'); w.rtt(2)
  for (let i = 0; i < 2; i++) w.step('down'); w.rtt(2)
  w.travel('ciudad-corazon'); w.step('right'); w.rtt(3)
  const p = w.g.player
  return { name: 'S3 Pradera round trip', ...w.counters, client: `${w.g.area.id}(${p.tx},${p.ty})` }
}
async function scenario4() {
  // 12 legitimate running steps (~1.6 s at 7.5 tiles/s) held behind a stalled socket, then delivered at once.
  const w = await world('s4')
  let sent = 0
  for (let i = 0; sent < 12 && i < 60; i++) if (w.step(['right', 'down', 'left', 'down'][Math.floor(i / 3) % 4])) sent++
  w.rtt(2)
  w.g.player.progress = 1
  const p = w.g.player
  return { name: 'S4 1.6 s stall, 12 queued steps', ...w.counters, client: `(${p.tx},${p.ty})` }
}
async function scenario5() {
  // 24 running steps (~3.2 s) behind a stalled socket: more than any bucket absorbs.
  const w = await world('s5')
  let sent = 0
  for (let i = 0; sent < 24 && i < 120; i++) if (w.step(['right', 'down', 'left', 'down'][Math.floor(i / 3) % 4])) sent++
  w.rtt(3)
  const p = w.g.player
  const diag = w.g.presenceDiagnostics.snapshot()
  return { name: 'S5 3.2 s stall, 24 queued steps', ...w.counters, client: `(${p.tx},${p.ty})`, hud: { lastSent: diag.lastSent, lastAcked: diag.lastAcked, reconciliations: diag.reconciliations, rejections: diag.rejections } }
}
const out = []
for (const s of [scenario1, scenario2, scenario3, scenario4, scenario5]) out.push(await s())
console.log(JSON.stringify({ label: process.env.LABEL, results: out }, null, 1))
