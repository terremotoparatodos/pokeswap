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
