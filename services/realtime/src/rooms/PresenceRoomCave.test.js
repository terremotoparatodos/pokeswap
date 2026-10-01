import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configureWorld } from './PresenceRoom.js'
import { areaTransition, stepAllowed } from '../presence/areaTransition.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { MESSAGE, observeIntent } from '../protocol/messages.js'
import { cavesIn } from '../world/caves.js'
import { caveInterior } from '../world/caveLayouts.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from '../world/worldProtocol.js'
import { fakeClient, lastMessage, messagesOf, settle } from '../world/testing.js'

// CAVES-3 inside the presence room: one shared cave interior, entered only
// from the mouth and left only from the exit pad, with the walls enforced by
// the service. The layout itself is guarded in world/caveLayouts.test.js.

const CAVE = cavesIn('pradera')[0]
const INSIDE = caveInterior(CAVE.interiorAreaId)

// ── The rules, without a room ──────────────────────────────────────────────

test('areaTransition: into the cave only from the mouth tile of its own area', () => {
  const at = (areaId, tx, ty) => ({ areaId, tx, ty })
  const arrival = { ...INSIDE.arrival }
  assert.deepEqual({ ...areaTransition(at('pradera', CAVE.mouth.tx, CAVE.mouth.ty), INSIDE.id) }, arrival)
  // The approach, a rock tile, the arrival, anywhere else: refused.
  for (const t of [CAVE.approach, CAVE.anchor, ARRIVALS.pradera, { tx: 0, ty: 0 }]) {
    assert.equal(areaTransition(at('pradera', t.tx, t.ty), INSIDE.id), null, `${t.tx},${t.ty}`)
  }
  // Another area, even standing on the same coordinates: refused.
  assert.equal(areaTransition(at('ciudad-corazon', CAVE.mouth.tx, CAVE.mouth.ty), INSIDE.id), null)
})

test('areaTransition: out to the cave area only from the exit pad, landing on the approach', () => {
  const at = (tx, ty) => ({ areaId: INSIDE.id, tx, ty })
  const out = areaTransition(at(INSIDE.exit.tx, INSIDE.exit.ty), 'pradera')
  assert.deepEqual({ ...out }, { tx: CAVE.approach.tx, ty: CAVE.approach.ty, dir: 'down' })
  assert.equal(areaTransition(at(INSIDE.arrival.tx, INSIDE.arrival.ty), 'pradera'), null)
  assert.equal(areaTransition(at(INSIDE.exit.tx, INSIDE.exit.ty - 1), 'pradera'), null)
  // The "Ciudad" escape hatch still works from inside, and a same-area reset lands on the arrival.
  assert.deepEqual({ ...areaTransition(at(1, 1), 'ciudad-corazon') }, { ...ARRIVALS['ciudad-corazon'] })
  assert.deepEqual({ ...areaTransition(at(1, 1), INSIDE.id) }, { ...INSIDE.arrival })
})

test('areaTransition: Ciudad ↔ Pradera behaves exactly as before CAVES-3', () => {
  assert.deepEqual({ ...areaTransition({ areaId: 'ciudad-corazon', tx: 3, ty: 3 }, 'pradera') }, { ...ARRIVALS.pradera })
  assert.equal(areaTransition({ areaId: 'pradera', tx: 3, ty: 3 }, 'ciudad-corazon').tx, 8)
  assert.deepEqual({ ...areaTransition({ areaId: 'pradera', tx: 3, ty: 3 }, 'pradera') }, { ...ARRIVALS.pradera })
})

test('stepAllowed: walls and edges of a cave block; other areas are unchanged (client walkability)', () => {
  const inside = (tx, ty) => ({ areaId: INSIDE.id, tx, ty })
  assert.equal(stepAllowed(inside(INSIDE.arrival.tx, INSIDE.arrival.ty), 'up'), true)
  assert.equal(stepAllowed(inside(6, 11), 'left'), false, 'wall')
  assert.equal(stepAllowed(inside(INSIDE.exit.tx, INSIDE.exit.ty), 'down'), false, 'edge of the grid')
  assert.equal(stepAllowed({ areaId: 'pradera', tx: CAVE.mouth.tx - 1, ty: CAVE.mouth.ty + 1 }, 'up'), true)
})

test('a guest cannot observe the inside of a cave', () => {
  assert.equal(observeIntent({ areaId: INSIDE.id, tx: 10, ty: 10 }), null)
  assert.deepEqual(observeIntent({ areaId: 'pradera', tx: 1, ty: 2 }), { areaId: 'pradera', tx: 1, ty: 2 })
})

// ── In the room ────────────────────────────────────────────────────────────

const deltasOf = (client, id) => messagesOf(client, MESSAGE.BATCH).flat().concat(messagesOf(client, MESSAGE.DELTA)).filter(delta => delta.actor?.id === id)

/** A room with the real move rate limit: steps are spaced on a fake clock so a long walk is not throttled. */
async function caveRoom(t) {
  configureWorld({ skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}) })
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
  const sequences = new Map()
  const join = async id => {
    const client = fakeClient(`${id}-session`)
    clients.push(client)
    await room.onJoin(client, { worldProtocol: WORLD_PROTOCOL, presenceProtocol: 2 }, { kind: 'player', userId: id, username: id.toUpperCase(), token: null })
    room.ready(client)
    return client
  }
  /** The newest authoritative view of a client's own actor: a step ack or a snapshot, whichever came last. */
  const self = client => {
    const entry = [...client.messages].reverse().find(e => e.type === MESSAGE.SELF || (e.type === MESSAGE.SNAPSHOT && e.payload.self))
    return entry.type === MESSAGE.SELF ? entry.payload : entry.payload.self
  }
  const step = (client, direction) => {
    now += 200
    const sequence = Math.max(sequences.get(client) ?? 0, self(client).moveSequence) + 1
    sequences.set(client, sequence)
    room.move(client, { direction, running: false, sequence })
  }
  const walk = (client, to) => {
    for (let guard = 0; guard < 200; guard++) {
      const at = self(client)
      if (at.tx === to.tx && at.ty === to.ty) return
      step(client, at.tx !== to.tx ? (to.tx > at.tx ? 'right' : 'left') : (to.ty > at.ty ? 'down' : 'up'))
    }
    const last = client.messages.slice(-3).map(m => `${m.type} ${JSON.stringify(m.payload).slice(0, 120)}`).join(' | ')
    throw new Error(`could not walk to ${to.tx},${to.ty}: ${last}`)
  }
  /** Joins, goes to Pradera and stands on the approach in front of the mouth. */
  const toApproach = async id => {
    const client = await join(id)
    room.changeArea(client, { areaId: 'pradera' })
    walk(client, CAVE.approach)
    return client
  }
  const enter = client => { step(client, 'up'); room.changeArea(client, { areaId: INSIDE.id }) }
  return { room, join, self, step, walk, toApproach, enter }
}

test('room: the cave is entered only from the mouth; a refusal answers with the real area and tile', async t => {
  const { room, self, step, toApproach } = await caveRoom(t)
  // Ids are unique per test: the reconnect cache is module state and would restore an actor left inside.
  const a = await toApproach('cave-enter')
  // From the approach: refused, and told where it really is (so a client waiting on the cave stops waiting).
  room.changeArea(a, { areaId: INSIDE.id })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  const refused = lastMessage(a, MESSAGE.SNAPSHOT).self
  assert.deepEqual({ areaId: refused.areaId, tx: refused.tx, ty: refused.ty }, { areaId: 'pradera', ...CAVE.approach })
  // One step up onto the mouth, then the same request: inside, on the arrival tile.
  step(a, 'up')
  assert.deepEqual({ tx: self(a).tx, ty: self(a).ty }, { ...CAVE.mouth })
  room.changeArea(a, { areaId: INSIDE.id })
  const inside = lastMessage(a, MESSAGE.SNAPSHOT).self
  assert.deepEqual({ areaId: inside.areaId, tx: inside.tx, ty: inside.ty, dir: inside.dir }, { areaId: INSIDE.id, ...INSIDE.arrival })
})

test('room: the client cannot pick the destination — not from Ciudad, not with its own coordinates', async t => {
  const { room, join } = await caveRoom(t)
  const a = await join('cave-pick')
  room.changeArea(a, { areaId: INSIDE.id, tx: 10, ty: 10 })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  assert.equal(lastMessage(a, MESSAGE.SNAPSHOT).self.areaId, 'ciudad-corazon')
  room.changeArea(a, { areaId: 'cueva-falsa' })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area denied')
})

test('room: two players share the interior and see each other; one outside sees neither', async t => {
  const { room, toApproach, enter } = await caveRoom(t)
  const a = await toApproach('cave-a')
  const b = await toApproach('cave-b')
  const c = await toApproach('cave-c')
  enter(a)
  room.flushDeltaBatches()
  enter(b)
  room.flushDeltaBatches()
  // B arrives and its snapshot already holds A; A gets B as an upsert.
  assert.deepEqual(lastMessage(b, MESSAGE.SNAPSHOT).actors.map(actor => actor.id), ['cave-a'])
  assert.equal(deltasOf(a, 'cave-b').at(-1).type, 'upsert')
  assert.equal(deltasOf(a, 'cave-b').at(-1).actor.areaId, INSIDE.id)
  // C, outside, saw both leave and nothing of them since.
  assert.equal(deltasOf(c, 'cave-a').at(-1).type, 'leave')
  assert.equal(deltasOf(c, 'cave-b').at(-1).type, 'leave')
  assert.ok(lastMessage(c, MESSAGE.SNAPSHOT).actors.every(actor => actor.areaId === 'pradera'))
})

test('room: presence is isolated by area even at the same coordinates (a Ciudad player next to the interior tiles)', async t => {
  const { room, join, walk, toApproach, enter } = await caveRoom(t)
  // Interior tiles are small numbers; so are Ciudad's. Distance alone would not hide them.
  const town = await join('cave-iso-town')
  walk(town, { tx: INSIDE.arrival.tx, ty: INSIDE.arrival.ty + 1 })
  const a = await toApproach('cave-iso-a')
  room.flushDeltaBatches()
  enter(a)
  room.flushDeltaBatches()
  assert.deepEqual(deltasOf(town, 'cave-iso-a').filter(delta => delta.actor.areaId === INSIDE.id), [])
  assert.deepEqual(lastMessage(a, MESSAGE.SNAPSHOT).actors.map(actor => actor.id), [])
})

test('room: walls are enforced by the service; a blocked step is answered with the real tile', async t => {
  const { room, self, step, toApproach, enter } = await caveRoom(t)
  const a = await toApproach('cave-wall')
  enter(a)
  for (let i = 0; i < 4; i++) step(a, 'left') // (10,11) → (6,11): floor all the way
  assert.deepEqual({ tx: self(a).tx, ty: self(a).ty }, { tx: 6, ty: 11 })
  step(a, 'left') // (5,11) is rock
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement blocked')
  assert.deepEqual({ tx: self(a).tx, ty: self(a).ty }, { tx: 6, ty: 11 })
  // Nowhere out of the grid either: down from the exit pad is the edge.
  room.changeArea(a, { areaId: INSIDE.id })
  step(a, 'down'); step(a, 'down')
  assert.deepEqual({ tx: self(a).tx, ty: self(a).ty }, { ...INSIDE.exit })
  step(a, 'down')
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'movement blocked')
  assert.deepEqual({ tx: self(a).tx, ty: self(a).ty }, { ...INSIDE.exit })
})

test('room: leaving takes only the player on the exit pad, to the approach, and does not loop', async t => {
  const { room, self, walk, toApproach, enter } = await caveRoom(t)
  const a = await toApproach('cave-out-a')
  const b = await toApproach('cave-out-b')
  enter(a); enter(b)
  room.flushDeltaBatches()
  // Not on the pad: refused.
  room.changeArea(a, { areaId: 'pradera' })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  assert.equal(lastMessage(a, MESSAGE.SNAPSHOT).self.areaId, INSIDE.id)
  walk(a, INSIDE.exit)
  room.changeArea(a, { areaId: 'pradera' })
  room.flushDeltaBatches()
  const out = lastMessage(a, MESSAGE.SNAPSHOT).self
  assert.deepEqual({ areaId: out.areaId, tx: out.tx, ty: out.ty, dir: out.dir }, { areaId: 'pradera', ...CAVE.approach, dir: 'down' })
  // Landing on the approach is not the mouth: asking for the cave again from there is refused.
  room.changeArea(a, { areaId: INSIDE.id })
  assert.equal(lastMessage(a, MESSAGE.ERROR).reason, 'area transition denied')
  // B is still inside and saw A leave.
  assert.equal(self(b).areaId, INSIDE.id)
  assert.equal(deltasOf(b, 'cave-out-a').at(-1).type, 'leave')
})

test('room: a reconnect inside the cave restores the player there, and the exit still works', async t => {
  const { room, join, self, walk, toApproach, enter } = await caveRoom(t)
  const first = await toApproach('cave-back')
  enter(first)
  walk(first, { tx: 12, ty: 8 })
  room.onLeave(first)
  const again = await join('cave-back')
  const restored = lastMessage(again, MESSAGE.SNAPSHOT).self
  assert.deepEqual({ areaId: restored.areaId, tx: restored.tx, ty: restored.ty }, { areaId: INSIDE.id, tx: 12, ty: 8 })
  walk(again, INSIDE.exit)
  room.changeArea(again, { areaId: 'pradera' })
  assert.deepEqual({ areaId: self(again).areaId, tx: self(again).tx, ty: self(again).ty }, { areaId: 'pradera', ...CAVE.approach })
})

test('room: the cave has no world — no nodes, no wild Pokémon, and work there is refused', async t => {
  const { room, toApproach, enter } = await caveRoom(t)
  const a = await toApproach('cave-world')
  enter(a)
  await settle()
  const snapshot = lastMessage(a, WORLD_MESSAGE.SNAPSHOT)
  assert.equal(snapshot.areaId, INSIDE.id)
  assert.deepEqual(snapshot.nodes, [])
  assert.deepEqual(snapshot.chunks, [])
  assert.equal(snapshot.wild, undefined)
  room.work(a, { nodeId: 'pradera:3:-64:rock', pokemonInstanceId: 25, requestId: 7 })
  await settle()
  assert.equal(lastMessage(a, WORLD_MESSAGE.WORK_RESULT)?.ok, false)
})
