import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configureWorld, liveActorForTesting } from './PresenceRoom.js'
import { metrics } from '../observability/metrics.js'
import { ARRIVALS, TOWN_FROM_PRADERA } from '../protocol/arrival.js'
import { MESSAGE } from '../protocol/messages.js'
import { cavesIn } from '../world/caves.js'
import { caveInterior } from '../world/caveLayouts.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { AREA_BOUNDS, PRADERA_RETURN_PAD, isWalkable, portalTo } from '../world/navigation.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { fakeClient, lastMessage, messagesOf, openDirection, praderaNodesNearSpawn, routeBetween, settle } from '../world/testing.js'
import { standableTile, workPlacement } from '../world/workPlacement.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from '../world/worldProtocol.js'
import { RECONNECT_GRACE_MS } from '../presence/reconnectCache.js'

// CAVES-4 inside the presence room: navigation between Ciudad, Pradera and
// the cave is the service's. Every crossing here is walked for real, through
// the portal tile, with the real move rate limit on a fake clock.

const CAVE = cavesIn('pradera')[0]
const INSIDE = caveInterior(CAVE.interiorAreaId)
const GATE = portalTo('ciudad-corazon', 'pradera')
const DELTA = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }

/** The first direction from `at` whose step is solid or past the edge (it must exist for the tests that use it). */
function blockedDirection(areaId, at) {
  const direction = Object.keys(DELTA).find(d => !isWalkable(areaId, at.tx + DELTA[d][0], at.ty + DELTA[d][1]))
  assert.ok(direction, `no wall next to ${areaId} ${at.tx},${at.ty}`)
  return direction
}

async function navRoom(t, ownership = {}) {
  configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership(ownership) })
  const room = new PresenceRoom()
  room.onCreate()
  let now = Date.now()
  const realNow = Date.now
  Date.now = () => now
  const clients = []
  t.after(() => {
    Date.now = realNow
    for (const client of clients) room.onLeave(client)
    room.setSimulationInterval(null)
    room.clock.clear()
  })
  const join = async (id, options = {}) => {
    const client = fakeClient(`${id}-session`)
    clients.push(client)
    await room.onJoin(client, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 2, ...options }, { kind: 'player', userId: id, username: id.toUpperCase(), token: null })
    room.ready(client)
    return client
  }
  const guest = async (id, area) => {
    const client = fakeClient(`${id}-session`)
    clients.push(client)
    await room.onJoin(client, { presenceProtocol: 2 }, { kind: 'guest', token: null })
    room.ready(client)
    if (area) room.observe(client, area)
    return client
  }
  const self = client => {
    const entry = [...client.messages].reverse().find(e => e.type === MESSAGE.SELF || (e.type === MESSAGE.SNAPSHOT && e.payload.self))
    return entry.type === MESSAGE.SELF ? entry.payload : entry.payload.self
  }
  const where = client => { const s = self(client); return { areaId: s.areaId, tx: s.tx, ty: s.ty } }
  const next = client => self(client).moveSequence + 1
  const step = (client, direction, extra = {}) => {
    now += 200
    room.move(client, { direction, running: false, sequence: next(client), ...extra })
  }
  const walk = (client, to) => {
    const at = self(client)
    const route = routeBetween(at.areaId, at, to)
    assert.ok(route, `no route in ${at.areaId} to ${to.tx},${to.ty}`)
    for (const direction of route) step(client, direction)
    assert.deepEqual({ tx: self(client).tx, ty: self(client).ty }, { tx: to.tx, ty: to.ty }, `walked to ${to.tx},${to.ty}`)
  }
  /** Walks onto the portal of its area that leads to `to` and asks for `to`, like the client does. */
  const travel = (client, to) => {
    walk(client, portalTo(self(client).areaId, to))
    now += 600
    room.changeArea(client, { areaId: to })
  }
  const advance = ms => { now += ms }
  return { room, join, guest, self, where, step, walk, travel, advance }
}

const deltasOf = (client, id) => messagesOf(client, MESSAGE.BATCH).flat().concat(messagesOf(client, MESSAGE.DELTA)).filter(delta => delta.actor?.id === id)
const errors = client => messagesOf(client, MESSAGE.ERROR).map(e => e.reason)

// ── Movement in the three areas ────────────────────────────────────────────

test('nav: valid walks are accepted in Ciudad, Pradera and the cave, tile by tile', async t => {
  const { join, where, walk, travel } = await navRoom(t)
  const a = await join('nav-walk')
  walk(a, { tx: 31, ty: 30 })
  travel(a, 'pradera')
  assert.deepEqual(where(a), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  travel(a, INSIDE.id)
  walk(a, { tx: 12, ty: 3 })
  assert.deepEqual(where(a), { areaId: INSIDE.id, tx: 12, ty: 3 })
  assert.deepEqual(errors(a), [])
})

// ── The four transitions, both ways ────────────────────────────────────────

test('nav: Ciudad → Pradera → cueva → Pradera → Ciudad, each only from its portal and landing where the client lands', async t => {
  const { room, join, where, travel } = await navRoom(t)
  const before = { ...metrics.transitions }
  const a = await join('nav-loop')
  travel(a, 'pradera')
  assert.deepEqual(where(a), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  travel(a, INSIDE.id)
  assert.deepEqual(where(a), { areaId: INSIDE.id, tx: INSIDE.arrival.tx, ty: INSIDE.arrival.ty })
  travel(a, 'pradera')
  assert.deepEqual(where(a), { areaId: 'pradera', ...CAVE.approach })
  travel(a, 'ciudad-corazon')
  assert.deepEqual(where(a), { areaId: 'ciudad-corazon', tx: TOWN_FROM_PRADERA.tx, ty: TOWN_FROM_PRADERA.ty })
  assert.deepEqual(errors(a), [])
  assert.equal(metrics.transitions.portal - before.portal, 4)
  // Arrivals are never portals: asking to go on from the landing tile is refused.
  room.changeArea(a, { areaId: 'pradera' })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  assert.equal(where(a).areaId, 'ciudad-corazon')
})

test('nav: a crossing from the wrong tile is refused with one authoritative snapshot, for every portal', async t => {
  const { room, join, self, walk, travel, where } = await navRoom(t)
  const a = await join('nav-wrong')
  // Ciudad → Pradera from the tile beside the gate, and from the spawn.
  for (const tile of [{ tx: GATE.tx + 1, ty: GATE.ty }, { tx: ARRIVALS['ciudad-corazon'].tx, ty: ARRIVALS['ciudad-corazon'].ty }]) {
    walk(a, tile)
    const snapshots = messagesOf(a, MESSAGE.SNAPSHOT).length
    room.changeArea(a, { areaId: 'pradera' })
    assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
    assert.equal(messagesOf(a, MESSAGE.SNAPSHOT).length, snapshots + 1, 'exactly one snapshot')
    assert.deepEqual(where(a), { areaId: 'ciudad-corazon', ...tile })
  }
  // Pradera → cave from the approach.
  travel(a, 'pradera')
  walk(a, CAVE.approach)
  room.changeArea(a, { areaId: INSIDE.id })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  assert.deepEqual(where(a), { areaId: 'pradera', ...CAVE.approach })
  // Cave → Pradera from the arrival.
  travel(a, INSIDE.id)
  room.changeArea(a, { areaId: 'pradera' })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  assert.equal(self(a).areaId, INSIDE.id)
  // Areas that are not shared (a town gate to the tundra leads nowhere on the service).
  room.changeArea(a, { areaId: 'tundra' })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area denied')
})

test('nav: the client names an area and nothing else — coordinates, origins and destinations it sends are ignored', async t => {
  const { room, join, where, step } = await navRoom(t)
  const a = await join('nav-forge')
  const start = where(a)
  room.changeArea(a, { areaId: 'pradera', from: 'pradera', tx: GATE.tx, ty: GATE.ty, arrival: { tx: 0, ty: 0 } })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  assert.deepEqual(where(a), start)
  room.changeArea(a, { areaId: INSIDE.id, tx: INSIDE.arrival.tx, ty: INSIDE.arrival.ty })
  assert.deepEqual(where(a), start)
  // A move carries a direction: extra fields do not teleport and do not multiply the step.
  step(a, 'down', { tx: 0, ty: 0, areaId: 'pradera', steps: 9 })
  assert.deepEqual(where(a), { ...start, ty: start.ty + 1 })
})

test('nav: the "Ciudad" recall is the only trip without a portal, to a landing the service picks', async t => {
  const { room, join, where, walk, travel } = await navRoom(t)
  const before = { ...metrics.transitions }
  const a = await join('nav-recall')
  travel(a, 'pradera')
  walk(a, CAVE.approach)
  room.changeArea(a, { areaId: 'ciudad-corazon' })
  assert.deepEqual(where(a), { areaId: 'ciudad-corazon', tx: TOWN_FROM_PRADERA.tx, ty: TOWN_FROM_PRADERA.ty }, 'from Pradera: where the client lands too')
  travel(a, 'pradera'); travel(a, INSIDE.id)
  walk(a, { tx: 12, ty: 3 })
  room.changeArea(a, { areaId: 'ciudad-corazon' })
  assert.deepEqual(where(a), { areaId: 'ciudad-corazon', tx: ARRIVALS['ciudad-corazon'].tx, ty: ARRIVALS['ciudad-corazon'].ty }, 'from the cave: the spawn')
  walk(a, { tx: 31, ty: 30 })
  room.changeArea(a, { areaId: 'ciudad-corazon' })
  assert.deepEqual(where(a), { areaId: 'ciudad-corazon', tx: 31, ty: 20 }, 'inside the town: the spawn')
  assert.equal(metrics.transitions.recall - before.recall, 3)
})

test('nav: a same-area request outside the town is a resync — no move, no news for anyone', async t => {
  const { room, join, where, walk, travel, step } = await navRoom(t)
  const a = await join('nav-resync')
  const b = await join('nav-resync-watch')
  travel(a, 'pradera'); travel(b, 'pradera')
  step(a, 'down')
  room.flushDeltaBatches()
  const at = where(a)
  const seenBefore = deltasOf(b, 'nav-resync').length
  room.changeArea(a, { areaId: 'pradera' })
  room.flushDeltaBatches()
  assert.deepEqual(where(a), at)
  assert.equal(lastMessage(a, MESSAGE.SNAPSHOT).self.tx, at.tx)
  assert.equal(deltasOf(b, 'nav-resync').length, seenBefore, 'observers hear nothing')
  travel(a, INSIDE.id)
  walk(a, { tx: 12, ty: 3 })
  room.changeArea(a, { areaId: INSIDE.id })
  assert.deepEqual(where(a), { areaId: INSIDE.id, tx: 12, ty: 3 })
})

// ── Walls, edges, jumps ────────────────────────────────────────────────────

test('nav: walls and edges block in every area; a blocked step is answered once, to its sender only', async t => {
  const { room, join, where, walk, travel, step } = await navRoom(t)
  const a = await join('nav-wall')
  const b = await join('nav-wall-watch')
  room.flushDeltaBatches()
  // Ciudad: the west gate's own building is solid to its left.
  walk(a, GATE)
  room.flushDeltaBatches()
  const blockedTown = blockedDirection('ciudad-corazon', GATE)
  const answers = () => a.messages.filter(m => m.type === MESSAGE.SELF).length
  const [selfs, seen] = [answers(), deltasOf(b, 'nav-wall').length]
  step(a, blockedTown)
  room.flushDeltaBatches()
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement blocked')
  assert.equal(answers(), selfs + 1, 'one authoritative self')
  assert.equal(deltasOf(b, 'nav-wall').length, seen, 'the observer is not moved or told')
  assert.deepEqual(where(a), { areaId: 'ciudad-corazon', tx: GATE.tx, ty: GATE.ty })
  // No loop: nothing more arrives without input.
  const settled = a.messages.length
  for (let i = 0; i < 3; i++) room.flushDeltaBatches()
  assert.equal(a.messages.length, settled)
  // Pradera: the cave rock beside the mouth.
  travel(a, 'pradera')
  walk(a, { tx: CAVE.mouth.tx - 1, ty: CAVE.approach.ty })
  step(a, 'up')
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement blocked')
  assert.deepEqual(where(a), { areaId: 'pradera', tx: CAVE.mouth.tx - 1, ty: CAVE.approach.ty })
  // Pradera's hard edge: a trainer the service itself stood on the last column cannot step past it.
  const edge = { tx: AREA_BOUNDS.pradera.maxTx, ty: 0 }
  for (; !isWalkable('pradera', edge.tx, edge.ty) || !isWalkable('pradera', edge.tx - 1, edge.ty); edge.ty++);
  room.placeActor(liveActorForTesting('nav-wall'), { ...edge, dir: 'right' })
  step(a, 'right')
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement blocked')
  assert.deepEqual(where(a), { areaId: 'pradera', ...edge })
  step(a, 'left')
  assert.deepEqual(where(a), { areaId: 'pradera', tx: edge.tx - 1, ty: edge.ty })
})

test('nav: malformed steps are refused without moving — non-finite, fractional, huge or unknown', async t => {
  const { room, join, where, self } = await navRoom(t)
  const a = await join('nav-malformed')
  const start = where(a)
  const s = self(a).moveSequence
  for (const payload of [
    { direction: 'right', running: false, sequence: Number.NaN },
    { direction: 'right', running: false, sequence: Infinity },
    { direction: 'right', running: false, sequence: s + 1.5 },
    { direction: 'right', running: false, sequence: 2 ** 60 },
    { direction: 'right', running: false, sequence: -1 },
    { direction: 'up-right', running: false, sequence: s + 1 },
    { direction: 'right', running: 'yes', sequence: s + 1 },
    null, 'right', 42,
  ]) {
    room.move(a, payload)
    assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement denied', JSON.stringify(payload))
  }
  assert.deepEqual(where(a), start)
  assert.equal(self(a).moveSequence, s, 'a malformed step consumes nothing')
})

test('nav: one step is one tile — a burst of steps cannot outrun the token bucket, and there is no jump', async t => {
  const { room, join, where, self } = await navRoom(t)
  const a = await join('nav-burst')
  const start = where(a)
  // 40 steps in the same instant: at most the burst capacity is applied, one tile each.
  let s = self(a).moveSequence
  for (let i = 0; i < 40; i++) room.move(a, { direction: i % 2 ? 'left' : 'right', running: true, sequence: ++s })
  const end = where(a)
  assert.ok(Math.abs(end.tx - start.tx) <= 1 && end.ty === start.ty)
  assert.ok(errors(a).includes('movement rate denied'))
})

// ── Sequences ──────────────────────────────────────────────────────────────

test('nav: replays and skipped sequences are refused once, consumed deterministically, and do not loop', async t => {
  const { room, join, where, self, step, advance } = await navRoom(t)
  const a = await join('nav-seq')
  const b = await join('nav-seq-watch')
  step(a, 'down')
  room.flushDeltaBatches()
  const at = where(a)
  const S = self(a).moveSequence
  const seen = deltasOf(b, 'nav-seq').length
  const answers = () => a.messages.filter(m => m.type === MESSAGE.SELF).length
  // Replay: the same number again.
  let before = answers()
  advance(200)
  room.move(a, { direction: 'down', running: false, sequence: S })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement replay denied')
  assert.equal(answers(), before + 1)
  assert.deepEqual(where(a), at)
  // Skipped ahead: refused without moving, but consumed, so the answer acknowledges exactly what was sent.
  before = answers()
  advance(200)
  room.move(a, { direction: 'down', running: false, sequence: S + 5 })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement sequence denied')
  assert.equal(answers(), before + 1)
  assert.deepEqual({ ...where(a), seq: self(a).moveSequence }, { ...at, seq: S + 5 })
  room.flushDeltaBatches()
  assert.equal(deltasOf(b, 'nav-seq').length, seen, 'observers saw no movement')
  // No loop: nothing more without input, and the very next number walks normally.
  const settled = a.messages.length
  for (let i = 0; i < 3; i++) room.flushDeltaBatches()
  assert.equal(a.messages.length, settled)
  advance(200)
  room.move(a, { direction: 'down', running: false, sequence: S + 6 })
  assert.deepEqual(where(a), { ...at, ty: at.ty + 1 })
})

// ── Presence isolation ─────────────────────────────────────────────────────

test('nav: presence is isolated by area at the same coordinates, Ciudad and the cave', async t => {
  const { room, join, walk, travel, where } = await navRoom(t)
  const spot = { tx: 12, ty: 10 }
  assert.ok(isWalkable('ciudad-corazon', spot.tx, spot.ty) && isWalkable(INSIDE.id, spot.tx, spot.ty))
  const town = await join('nav-iso-town')
  const cave = await join('nav-iso-cave')
  travel(cave, 'pradera'); travel(cave, INSIDE.id)
  walk(cave, spot)
  walk(town, spot)
  room.flushDeltaBatches()
  assert.deepEqual([where(town), where(cave)], [{ areaId: 'ciudad-corazon', ...spot }, { areaId: INSIDE.id, ...spot }])
  const leaked = (viewer, id, areaId) => deltasOf(viewer, id).filter(d => d.type !== 'leave' && d.actor.areaId === areaId)
  assert.deepEqual(leaked(town, 'nav-iso-cave', INSIDE.id), [])
  assert.deepEqual(leaked(cave, 'nav-iso-town', 'ciudad-corazon'), [])
  room.changeArea(town, { areaId: 'ciudad-corazon' })
  room.changeArea(cave, { areaId: INSIDE.id })
  assert.deepEqual(lastMessage(town, MESSAGE.SNAPSHOT).actors.map(a => a.id), [])
  assert.deepEqual(lastMessage(cave, MESSAGE.SNAPSHOT).actors.map(a => a.id), [])
})

test('nav: a guest cannot look into the cave, and a player cannot observe at all', async t => {
  const { room, join, guest, travel } = await navRoom(t)
  const a = await join('nav-observe')
  travel(a, 'pradera'); travel(a, INSIDE.id)
  const g = await guest('nav-observe-guest')
  room.observe(g, { areaId: INSIDE.id, tx: INSIDE.arrival.tx, ty: INSIDE.arrival.ty })
  assert.equal(lastMessage(g, MESSAGE.ERROR).reason, 'observer denied')
  assert.ok(lastMessage(g, MESSAGE.SNAPSHOT).actors.every(actor => actor.areaId !== INSIDE.id))
  room.observe(a, { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'observer-only')
})

test('nav: two players crossing the same gate in opposite directions each end up where they walked', async t => {
  const { room, join, where, walk, travel, advance } = await navRoom(t)
  const a = await join('nav-cross-a')
  const b = await join('nav-cross-b')
  const w = await join('nav-cross-watch-town')
  // The watcher waits in sight of the gate (the town interest radius is 20 tiles).
  walk(w, { tx: TOWN_FROM_PRADERA.tx + 2, ty: TOWN_FROM_PRADERA.ty })
  travel(b, 'pradera')
  // A walks onto the town gate while B walks onto the Pradera pad; both ask at the same instant.
  walk(a, GATE)
  walk(b, PRADERA_RETURN_PAD)
  advance(600)
  room.changeArea(a, { areaId: 'pradera' })
  room.changeArea(b, { areaId: 'ciudad-corazon' })
  room.flushDeltaBatches()
  assert.deepEqual(where(a), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  assert.deepEqual(where(b), { areaId: 'ciudad-corazon', tx: TOWN_FROM_PRADERA.tx, ty: TOWN_FROM_PRADERA.ty })
  // A arrived first, while B still stood on the pad: its snapshot holds B, then B's leave follows.
  assert.deepEqual(lastMessage(a, MESSAGE.SNAPSHOT).actors.map(x => x.id), ['nav-cross-b'])
  assert.equal(deltasOf(a, 'nav-cross-b').at(-1).type, 'leave')
  // B arrived after A had left: the town holds only the watcher.
  assert.deepEqual(lastMessage(b, MESSAGE.SNAPSHOT).actors.map(x => x.id), ['nav-cross-watch-town'])
  // The town watcher saw A leave and B arrive, in town coordinates.
  assert.equal(deltasOf(w, 'nav-cross-a').at(-1).type, 'leave')
  assert.deepEqual(deltasOf(w, 'nav-cross-b').filter(d => d.type !== 'leave').at(-1).actor.areaId, 'ciudad-corazon')
  // And they keep walking from there.
  walk(a, { tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty + 1 })
  walk(b, { tx: TOWN_FROM_PRADERA.tx + 1, ty: TOWN_FROM_PRADERA.ty })
})

// ── Reload and reconnection ────────────────────────────────────────────────

test('nav: a reload restores the area and tile; past the grace period the player starts in Ciudad (no persistence)', async t => {
  const { room, join, where, walk, travel, advance } = await navRoom(t)
  const first = await join('nav-reload')
  travel(first, 'pradera')
  walk(first, CAVE.approach)
  room.onLeave(first)
  const again = await join('nav-reload')
  assert.deepEqual(where(again), { areaId: 'pradera', ...CAVE.approach })
  // The restored player is still bound by its real tile: it can enter the cave only from the mouth.
  room.changeArea(again, { areaId: INSIDE.id })
  assert.equal(lastMessage(again, MESSAGE.ERROR).reason, 'area transition denied')
  room.onLeave(again)
  advance(RECONNECT_GRACE_MS + 1)
  const later = await join('nav-reload')
  assert.deepEqual(where(later), { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
})

test('nav: a remembered tile that is no longer a safe landing falls back to its area arrival', async t => {
  const { room, join, where, walk, travel } = await navRoom(t)
  const before = metrics.reconnectRepairs
  const a = await join('nav-repair')
  travel(a, 'pradera')
  // On a portal (it disconnected mid-crossing): restored to the area's arrival, not onto the portal.
  walk(a, PRADERA_RETURN_PAD)
  room.onLeave(a)
  const back = await join('nav-repair')
  assert.deepEqual(where(back), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  // A tile that became solid (the map changed under a remembered actor): the same.
  const tree = praderaNodesNearSpawn()[0].node
  Object.assign(liveActorForTesting('nav-repair'), { tx: tree.tx, ty: tree.ty })
  room.onLeave(back)
  const again = await join('nav-repair')
  assert.deepEqual(where(again), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  assert.equal(metrics.reconnectRepairs - before, 2)
})

// ── WORLD × SKILLS: work and walking ───────────────────────────────────────

test('nav: a blocked step does not cancel work; a real step does', async t => {
  const { room, join, self, walk, travel, step } = await navRoom(t, { 'nav-work': [25] })
  const a = await join('nav-work')
  travel(a, 'pradera')
  const isOpen = standableTile('pradera')
  const target = praderaNodesNearSpawn()
    .flatMap(({ node, stands }) => stands.map(stand => ({ node, stand, placement: workPlacement(node, stand, isOpen) })))
    .find(({ stand, placement }) => placement && routeBetween('pradera', ARRIVALS.pradera, stand, 20))
  walk(a, target.stand)
  room.work(a, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  await settle()
  assert.equal(lastMessage(a, WORLD_MESSAGE.WORK_RESULT).ok, true)
  const wait = self(a)
  // Towards the node (solid) or any wall: refused, the work keeps running.
  const blocked = blockedDirection('pradera', wait)
  step(a, blocked)
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement blocked')
  assert.equal(lastMessage(a, WORLD_MESSAGE.WORK_DONE), undefined)
  // A real step away: cancelled.
  step(a, openDirection('pradera', wait))
  assert.equal(lastMessage(a, WORLD_MESSAGE.WORK_DONE).reason, 'moved')
})
