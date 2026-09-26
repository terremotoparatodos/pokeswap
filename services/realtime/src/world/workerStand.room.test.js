import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { WorldRoom } from './worldRoom.js'
import { hiddenBehindCanopy, standableTile, workerStand } from './workerStand.js'
import { fakeClient, lastMessage, manualClock, praderaNodesNearSpawn, settle } from './testing.js'

// WORLD VISUAL-1 through the real room: the stand is decided once, published
// to every viewer, and outlives the trainer's movement and connection.

const [{ node: TREE, stands: [SPOT_A, SPOT_B, SPOT_C] }] = praderaNodesNearSpawn().filter(entry => entry.stands.length >= 3)

function setup() {
  const clock = manualClock()
  const actors = new Map()
  const sockets = new Map()
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const world = new WorldRoom({
    skills, ownership: createStaticOwnership({ a: [25], b: [6] }), now: clock.now,
    lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
  })
  const join = (id, spot) => {
    const client = fakeClient(id)
    const actor = { id, areaId: 'pradera', tx: spot.tx, ty: spot.ty }
    actors.set(id, actor); sockets.set(id, client)
    world.join(client, { worldProtocol: 1 }, { kind: 'player', userId: id, token: null })
    world.snapshot(client, actor)
    return { client, actor }
  }
  const nodeSeenBy = client => lastMessage(client, WORLD_MESSAGE.BATCH)?.nodes?.find(node => node.id === TREE.id)
  return { world, clock, actors, sockets, skills, join, nodeSeenBy }
}

test('owner and observer receive the same stand, the one the pure rule gives for the validated tile', async () => {
  const { world, join, nodeSeenBy } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  await world.work(a.actor, { nodeId: TREE.id, pokemonInstanceId: 25, requestId: 1 })
  world.flush()
  const expected = workerStand(TREE, SPOT_A, standableTile('pradera'), hiddenBehindCanopy('pradera'))
  assert.deepEqual(nodeSeenBy(a.client).worker.stand, expected)
  assert.deepEqual(nodeSeenBy(b.client).worker.stand, expected)
  // A newcomer's snapshot carries it too.
  const c = fakeClient('c')
  world.join(c, { worldProtocol: 1 }, { kind: 'guest' })
  world.snapshot(c, { id: null, areaId: 'pradera', tx: SPOT_B.tx, ty: SPOT_B.ty })
  assert.deepEqual(lastMessage(c, WORLD_MESSAGE.SNAPSHOT).nodes.find(node => node.id === TREE.id).worker.stand, expected)
})

test('the trainer stepping to another side of the node does not move the Pokémon', async () => {
  const { world, join, nodeSeenBy } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  await world.work(a.actor, { nodeId: TREE.id, pokemonInstanceId: 25, requestId: 1 })
  world.flush()
  const before = nodeSeenBy(b.client)
  b.client.messages.length = 0
  a.actor.tx = SPOT_C.tx; a.actor.ty = SPOT_C.ty
  world.viewerMoved(a.client, a.actor)
  world.flush()
  // Still beside: the action runs on, and nothing about the node was republished.
  assert.equal(nodeSeenBy(b.client), undefined)
  assert.deepEqual(world.authority.store.get(TREE.id).worker.stand, before.worker.stand)
})

test('disconnecting mid-action: the worker stays on its stand until the action settles and pays', async () => {
  const { world, clock, actors, skills, join, nodeSeenBy } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  await world.work(a.actor, { nodeId: TREE.id, pokemonInstanceId: 25, requestId: 1 })
  world.flush()
  const stand = nodeSeenBy(b.client).worker.stand
  b.client.messages.length = 0
  world.leave(a.client)
  actors.delete('a')
  clock.advance(1_500); world.tick(); world.flush()
  assert.equal(nodeSeenBy(b.client), undefined, 'nothing republished: same stand, still working')
  assert.equal(world.authority.store.get(TREE.id).state, 'working')
  assert.deepEqual(world.authority.store.get(TREE.id).worker.stand, stand)
  clock.advance(1_500); world.tick(); await settle(); world.flush()
  const after = nodeSeenBy(b.client)
  assert.equal(after.state, 'depleted')
  assert.equal(after.worker, undefined, 'the worker leaves with the action')
  assert.equal(skills.grants, 1)
})

test('cancel and cancel-by-movement both clear the worker for every viewer', async () => {
  for (const how of ['cancel', 'moved']) {
    const { world, join, nodeSeenBy } = setup()
    const a = join('a', SPOT_A)
    const b = join('b', SPOT_B)
    const started = await world.work(a.actor, { nodeId: TREE.id, pokemonInstanceId: 25, requestId: 1 })
    world.flush()
    assert.ok(nodeSeenBy(b.client).worker.stand)
    if (how === 'cancel') world.cancel(a.actor, { actionId: started.actionId })
    else { a.actor.tx += 3; world.viewerMoved(a.client, a.actor) }
    world.flush()
    const seen = nodeSeenBy(b.client)
    assert.equal(seen.worker, undefined, how)
    assert.equal(seen.actionId, undefined, how)
  }
})
