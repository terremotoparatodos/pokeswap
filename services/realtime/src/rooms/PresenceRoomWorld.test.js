import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configureWorld } from './PresenceRoom.js'
import { MESSAGE } from '../protocol/messages.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { WORLD_MESSAGE } from '../world/worldProtocol.js'
import { fakeClient, lastMessage, praderaNodesNearSpawn, settle } from '../world/testing.js'

// WORLD-1 inside the presence room: routing, gating and the snapshot moments.
// The world's own behaviour is tested in world/*.test.js.

/**
 * The node whose worker tile is nearest the Pradera arrival, and the moves that
 * reach that tile (the service does not model walkability, so a straight
 * L-shaped path is enough), within the 15-move burst.
 */
function reachableNode() {
  const { tx, ty } = ARRIVALS.pradera
  const candidates = praderaNodesNearSpawn().flatMap(({ node, stands }) => stands.map(stand => ({ node, stand, cost: Math.abs(stand.tx - tx) + Math.abs(stand.ty - ty) })))
  const { node, stand, cost } = candidates.sort((a, b) => a.cost - b.cost)[0]
  assert.ok(cost <= 12)
  const moves = [
    ...Array(Math.abs(stand.tx - tx)).fill(stand.tx > tx ? 'right' : 'left'),
    ...Array(Math.abs(stand.ty - ty)).fill(stand.ty > ty ? 'down' : 'up'),
  ]
  const away = stand.tx > node.tx ? 'right' : stand.tx < node.tx ? 'left' : stand.ty > node.ty ? 'down' : 'up'
  return { node, moves, away }
}

test('world messages ride the presence socket only for clients that declare the protocol', async () => {
  const skills = createDemoSkillPolicy()
  const world = configureWorld({ skills, ownership: createStaticOwnership({ 'world-a': [25] }) })
  const room = new PresenceRoom()
  const player = fakeClient('world-a-session')
  const legacy = fakeClient('legacy-session')
  const guest = fakeClient('guest-session')
  await room.onJoin(player, { worldProtocol: 1 }, { kind: 'player', userId: 'world-a', username: 'A', token: null })
  await room.onJoin(legacy, {}, { kind: 'player', userId: 'legacy-b', username: 'B', token: null })
  await room.onJoin(guest, { worldProtocol: 1 }, { kind: 'guest', token: null })
  for (const client of [player, legacy, guest]) room.ready(client)
  assert.deepEqual(lastMessage(player, WORLD_MESSAGE.SNAPSHOT), { now: lastMessage(player, WORLD_MESSAGE.SNAPSHOT).now, areaId: 'ciudad-corazon', chunks: [], nodes: [] })
  assert.ok(lastMessage(guest, WORLD_MESSAGE.SNAPSHOT))
  assert.equal(lastMessage(legacy, WORLD_MESSAGE.SNAPSHOT), undefined)

  room.changeArea(player, { areaId: 'pradera' })
  const snapshot = lastMessage(player, WORLD_MESSAGE.SNAPSHOT)
  assert.equal(snapshot.areaId, 'pradera')
  assert.ok(snapshot.chunks.length > 0)

  const target = reachableNode()
  target.moves.forEach((direction, i) => room.move(player, { direction, running: false, sequence: i + 1 }))
  room.work(player, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  await settle()
  assert.equal(lastMessage(player, WORLD_MESSAGE.WORK_RESULT).ok, true)
  assert.equal(world.authority.store.get(target.node.id).state, 'working')

  // A guest has no actor to stand beside anything.
  room.work(guest, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  assert.equal(lastMessage(guest, MESSAGE.ERROR).reason, 'world denied')

  // Walking away cancels it for everyone.
  room.move(player, { direction: target.away, running: false, sequence: target.moves.length + 1 })
  assert.equal(world.authority.store.get(target.node.id), null)
  assert.equal(skills.cancelled.length, 1)

  for (const client of [player, legacy, guest]) room.onLeave(client)
})
