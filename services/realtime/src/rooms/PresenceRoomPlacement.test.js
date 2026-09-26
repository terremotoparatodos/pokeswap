import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configureWorld } from './PresenceRoom.js'
import { MESSAGE } from '../protocol/messages.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { standableTile, workPlacement } from '../world/workPlacement.js'
import { WORLD_MESSAGE } from '../world/worldProtocol.js'
import { fakeClient, lastMessage, messagesOf, praderaNodesNearSpawn, settle } from '../world/testing.js'

// WORLD VISUAL-2 inside the presence room: the server's own move of a trainer
// is published like a step, with a sequence every viewer accepts, and the
// owner is told its new tile. The world's rules are tested in world/*.test.js.

/** A node with room for the trainer, reachable from the Pradera arrival within the move burst. */
function reachable() {
  const { tx, ty } = ARRIVALS.pradera
  const isOpen = standableTile('pradera')
  const [pick] = praderaNodesNearSpawn()
    .flatMap(({ node, stands }) => stands.map(stand => ({ node, stand, cost: Math.abs(stand.tx - tx) + Math.abs(stand.ty - ty) })))
    .filter(({ node, stand }) => workPlacement(node, stand, isOpen))
    .sort((a, b) => a.cost - b.cost)
  assert.ok(pick.cost <= 12)
  const moves = [
    ...Array(Math.abs(pick.stand.tx - tx)).fill(pick.stand.tx > tx ? 'right' : 'left'),
    ...Array(Math.abs(pick.stand.ty - ty)).fill(pick.stand.ty > ty ? 'down' : 'up'),
  ]
  return { ...pick, moves, placement: workPlacement(pick.node, pick.stand, isOpen) }
}

const deltasOf = (client, id) => messagesOf(client, MESSAGE.BATCH).flat().concat(messagesOf(client, MESSAGE.DELTA)).filter(delta => delta.actor?.id === id)

test('the server moves the trainer: observers get a newer step, the owner its tile, and the action keeps running', async () => {
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const world = configureWorld({ skills, ownership: createStaticOwnership({ 'place-a': [25] }) })
  const room = new PresenceRoom()
  room.onCreate()
  const owner = fakeClient('place-a-session')
  const viewer = fakeClient('place-b-session')
  try {
    await room.onJoin(owner, { worldProtocol: 1, presenceProtocol: 2 }, { kind: 'player', userId: 'place-a', username: 'A', token: null })
    await room.onJoin(viewer, { worldProtocol: 1, presenceProtocol: 2 }, { kind: 'player', userId: 'place-b', username: 'B', token: null })
    for (const client of [owner, viewer]) { room.ready(client); room.changeArea(client, { areaId: 'pradera' }) }
    const target = reachable()
    target.moves.forEach((direction, i) => room.move(owner, { direction, running: false, sequence: i + 1 }))
    room.flushDeltaBatches()
    const before = lastMessage(owner, MESSAGE.SELF)
    assert.deepEqual({ tx: before.tx, ty: before.ty }, { tx: target.stand.tx, ty: target.stand.ty })

    room.work(owner, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
    await settle()
    room.flushDeltaBatches()
    assert.equal(lastMessage(owner, WORLD_MESSAGE.WORK_RESULT).ok, true)
    // Owner: told its new tile, with the next sequence number.
    const self = lastMessage(owner, MESSAGE.SELF)
    assert.deepEqual({ tx: self.tx, ty: self.ty, dir: self.dir }, target.placement.wait)
    assert.equal(self.moveSequence, before.moveSequence + 1)
    // Observer: the same tile, as a step newer than anything it saw.
    const seen = deltasOf(viewer, 'place-a').at(-1)
    assert.deepEqual({ tx: seen.actor.tx, ty: seen.actor.ty, seq: seen.actor.moveSequence }, { tx: self.tx, ty: self.ty, seq: self.moveSequence })
    // The move did not cancel: the node is still worked.
    assert.equal(world.authority.store.get(target.node.id).state, 'working')

    // An older client numbers its next step with the sequence the server just used: refused as a replay,
    // but answered with its authoritative tile so it resyncs instead of drifting.
    room.move(owner, { direction: 'up', running: false, sequence: self.moveSequence })
    assert.equal(lastMessage(owner, MESSAGE.ERROR).reason, 'movement replay denied')
    assert.deepEqual(lastMessage(owner, MESSAGE.SELF), self)
    assert.equal(world.authority.store.get(target.node.id).state, 'working', 'a refused step moved nothing')

    // A real step off the waiting tile cancels, as before.
    room.move(owner, { direction: 'up', running: false, sequence: self.moveSequence + 1 })
    assert.equal(world.authority.store.get(target.node.id), null)
    assert.equal(skills.cancelled.length, 1)
  } finally {
    for (const client of [owner, viewer]) room.onLeave(client)
    room.setSimulationInterval(null)
    room.clock.clear()
  }
})

test('an older 0.3 client that does not adopt the new sequence: one replay, one authoritative self, then S+2 is a normal step', async () => {
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const world = configureWorld({ skills, ownership: createStaticOwnership({ 'legacy-a': [25] }) })
  const room = new PresenceRoom()
  room.onCreate()
  const owner = fakeClient('legacy-a-session')
  const viewer = fakeClient('legacy-b-session')
  try {
    await room.onJoin(owner, { worldProtocol: 1, presenceProtocol: 2 }, { kind: 'player', userId: 'legacy-a', username: 'A', token: null })
    await room.onJoin(viewer, { worldProtocol: 1, presenceProtocol: 2 }, { kind: 'player', userId: 'legacy-b', username: 'B', token: null })
    for (const client of [owner, viewer]) { room.ready(client); room.changeArea(client, { areaId: 'pradera' }) }
    const target = reachable()
    target.moves.forEach((direction, i) => room.move(owner, { direction, running: false, sequence: i + 1 }))
    const S = lastMessage(owner, MESSAGE.SELF).moveSequence

    // 2 · The server starts the work, moves the trainer to its anchor and advances to S+1.
    room.work(owner, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
    await settle()
    room.flushDeltaBatches()
    const anchor = target.placement.wait
    assert.equal(lastMessage(owner, MESSAGE.SELF).moveSequence, S + 1)
    const selves = () => messagesOf(owner, MESSAGE.SELF).length
    const viewerSteps = () => deltasOf(viewer, 'legacy-a').length
    const [selvesBefore, stepsBefore] = [selves(), viewerSteps()]
    // The old client predicts a step away from where it thinks it stands.
    const away = target.stand.tx > target.node.tx ? 'right' : target.stand.tx < target.node.tx ? 'left' : target.stand.ty > target.node.ty ? 'down' : 'up'

    // 3–4 · It numbers that step S+1: a replay. Nothing moves, nothing cancels, and the answer is the truth.
    room.move(owner, { direction: away, running: false, sequence: S + 1 })
    room.flushDeltaBatches()
    assert.equal(lastMessage(owner, MESSAGE.ERROR).reason, 'movement replay denied')
    const self = lastMessage(owner, MESSAGE.SELF)
    assert.deepEqual({ tx: self.tx, ty: self.ty, dir: self.dir, seq: self.moveSequence }, { ...anchor, seq: S + 1 })
    assert.equal(selves(), selvesBefore + 1, 'exactly one resync answer')
    assert.equal(viewerSteps(), stepsBefore, 'observers saw no movement')
    assert.equal(world.authority.store.get(target.node.id).state, 'working', 'not cancelled by the refused step')

    // No loop: ticks and flushes with no new input send nothing more to the owner.
    const answers = () => owner.messages.filter(m => m.type === MESSAGE.SELF || m.type === MESSAGE.ERROR).length
    const settled = answers()
    for (let i = 0; i < 3; i++) { world.tick(); room.flushDeltaBatches(); world.flush() }
    assert.equal(answers(), settled)

    // 5–6 · After the resync it sends S+2: accepted as one normal step from the anchor, not two.
    const [dx, dy] = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] }[away]
    room.move(owner, { direction: away, running: false, sequence: S + 2 })
    room.flushDeltaBatches()
    const after = lastMessage(owner, MESSAGE.SELF)
    assert.deepEqual({ tx: after.tx, ty: after.ty, seq: after.moveSequence }, { tx: anchor.tx + dx, ty: anchor.ty + dy, seq: S + 2 })
    const seen = deltasOf(viewer, 'legacy-a').at(-1)
    assert.deepEqual({ tx: seen.actor.tx, ty: seen.actor.ty, seq: seen.actor.moveSequence }, { tx: after.tx, ty: after.ty, seq: S + 2 })
    assert.equal(viewerSteps(), stepsBefore + 1, 'one step for observers')
    // A real step off the anchor is the player walking away: that cancels, as the rules say.
    assert.equal(world.authority.store.get(target.node.id), null)
    assert.equal(lastMessage(owner, WORLD_MESSAGE.WORK_DONE).reason, 'moved')
    assert.equal(skills.cancelled.length, 1)
  } finally {
    for (const client of [owner, viewer]) room.onLeave(client)
    room.setSimulationInterval(null)
    room.clock.clear()
  }
})
