import test from 'node:test'
import assert from 'node:assert/strict'
import { PresenceRoom, configureWorld, liveActorForTesting } from './PresenceRoom.js'
import { MESSAGE } from '../protocol/messages.js'
import { ARRIVALS } from '../protocol/arrival.js'
import { createDemoSkillPolicy } from '../world/demoSkillPolicy.js'
import { createStaticOwnership } from '../world/pokemonOwnership.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from '../world/worldProtocol.js'
import { crossTo, fakeClient, lastMessage, openDirection, praderaNodesNearSpawn, routeBetween, settle } from '../world/testing.js'

// WORLD-1 inside the presence room: routing, gating and the snapshot moments.
// The world's own behaviour is tested in world/*.test.js.

/**
 * The node whose worker tile is nearest the Pradera arrival, and the real walk
 * that reaches it over the shared collision (CAVES-4), within the 15-move burst.
 */
function reachableNode() {
  const candidates = praderaNodesNearSpawn().flatMap(({ node, stands }) => stands.map(stand => ({ node, stand, moves: routeBetween('pradera', ARRIVALS.pradera, stand, 20) })))
  const { node, stand, moves } = candidates.filter(c => c.moves).sort((a, b) => a.moves.length - b.moves.length)[0]
  assert.ok(moves.length <= 12)
  const away = openDirection('pradera', stand)
  return { node, moves, away }
}

test('world messages ride the presence socket only for clients that declare the protocol', async () => {
  const skills = createDemoSkillPolicy()
  const world = configureWorld({ skills, ownership: createStaticOwnership({ 'world-a': [25] }) })
  const room = new PresenceRoom()
  const player = fakeClient('world-a-session')
  const legacy = fakeClient('legacy-session')
  const guest = fakeClient('guest-session')
  await room.onJoin(player, { worldProtocol: WORLD_PROTOCOL }, { kind: 'player', userId: 'world-a', username: 'A', token: null })
  await room.onJoin(legacy, {}, { kind: 'player', userId: 'legacy-b', username: 'B', token: null })
  await room.onJoin(guest, { worldProtocol: WORLD_PROTOCOL }, { kind: 'guest', token: null })
  for (const client of [player, legacy, guest]) room.ready(client)
  assert.deepEqual(lastMessage(player, WORLD_MESSAGE.SNAPSHOT), { now: lastMessage(player, WORLD_MESSAGE.SNAPSHOT).now, areaId: 'ciudad-corazon', chunks: [], nodes: [] })
  assert.ok(lastMessage(guest, WORLD_MESSAGE.SNAPSHOT))
  assert.equal(lastMessage(legacy, WORLD_MESSAGE.SNAPSHOT), undefined)

  crossTo(room, player, liveActorForTesting('world-a'), 'pradera')
  const first = liveActorForTesting('world-a').moveSequence + 1
  const snapshot = lastMessage(player, WORLD_MESSAGE.SNAPSHOT)
  assert.equal(snapshot.areaId, 'pradera')
  assert.ok(snapshot.chunks.length > 0)

  const target = reachableNode()
  target.moves.forEach((direction, i) => room.move(player, { direction, running: false, sequence: first + i }))
  room.work(player, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  await settle()
  assert.equal(lastMessage(player, WORLD_MESSAGE.WORK_RESULT).ok, true)
  assert.equal(world.authority.store.get(target.node.id).state, 'working')

  // SKILLS PROB-2: a socket without the current world protocol cannot start work, whatever it sends.
  room.work(legacy, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 9 })
  await settle()
  assert.deepEqual(lastMessage(legacy, WORLD_MESSAGE.WORK_RESULT), { requestId: 9, ok: false, reason: 'client-outdated', message: 'Actualizá la página para seguir trabajando.' })
  assert.equal(world.stats().transport.outdatedWork, 1)

  // A guest has no actor to stand beside anything.
  room.work(guest, { nodeId: target.node.id, pokemonInstanceId: 25, requestId: 1 })
  assert.equal(lastMessage(guest, MESSAGE.ERROR).reason, 'world denied')

  // Walking away cancels it for everyone.
  room.move(player, { direction: target.away, running: false, sequence: first + target.moves.length })
  assert.equal(world.authority.store.get(target.node.id), null)
  assert.equal(skills.cancelled.length, 1)

  for (const client of [player, legacy, guest]) room.onLeave(client)
})
