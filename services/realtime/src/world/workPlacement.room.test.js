import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { resourceById } from './resourceLayout.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { WorldRoom } from './worldRoom.js'
import { standableTile, workPlacement } from './workPlacement.js'
import { fakeClient, lastMessage, manualClock, praderaNodesNearSpawn, settle } from './testing.js'

// WORLD VISUAL-2 through the real room: the Pokémon takes the trainer's tile,
// the server moves the trainer to its waiting tile, and that move never
// cancels the work; the trainer walking off it afterwards does.

const isOpen = standableTile('pradera')
const [{ node: TREE, stands: [SPOT_A, SPOT_B] }] = praderaNodesNearSpawn().filter(({ node, stands }) => stands.length >= 2 && workPlacement(node, stands[0], isOpen))

function setup() {
  const clock = manualClock()
  const actors = new Map()
  const sockets = new Map()
  const placed = []
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const world = new WorldRoom({
    skills, ownership: createStaticOwnership({ a: [25], b: [6] }), now: clock.now,
    lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
    // What presence does, minus the sockets: move the actor, then tell the world it moved.
    placeActor: (id, place) => {
      const actor = actors.get(id)
      if (!actor) return
      Object.assign(actor, place)
      placed.push({ id, ...place })
      world.viewerMoved(sockets.get(id), actor)
    },
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
  return { world, clock, actors, skills, placed, join, nodeSeenBy }
}

const work = (world, actor, nodeId = TREE.id, pokemonInstanceId = 25) => world.work(actor, { nodeId, pokemonInstanceId, requestId: 1 })

test('the Pokémon takes the trainer’s validated tile; the trainer is moved to its waiting tile; everyone sees the same', async () => {
  const { world, join, placed, nodeSeenBy } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  const expected = workPlacement(TREE, SPOT_A, isOpen)
  await work(world, a.actor)
  world.flush()
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).ok, true)
  assert.deepEqual({ tx: expected.stand.tx, ty: expected.stand.ty }, SPOT_A, 'exactly the validated tile')
  assert.deepEqual(nodeSeenBy(a.client).worker.stand, expected.stand)
  assert.deepEqual(nodeSeenBy(b.client).worker.stand, expected.stand)
  assert.deepEqual(placed, [{ id: 'a', ...expected.wait }])
  assert.deepEqual({ tx: a.actor.tx, ty: a.actor.ty }, { tx: expected.wait.tx, ty: expected.wait.ty })
  // Nobody overlaps: node, Pokémon and trainer on three different tiles.
  assert.equal(new Set([`${TREE.tx},${TREE.ty}`, `${SPOT_A.tx},${SPOT_A.ty}`, `${a.actor.tx},${a.actor.ty}`]).size, 3)
})

test('the server’s own move keeps the action; the trainer walking off the waiting tile cancels it', async () => {
  const { world, join } = setup()
  const a = join('a', SPOT_A)
  const started = await work(world, a.actor)
  assert.equal(world.authority.store.get(TREE.id).state, 'working')
  // The same position reported again (a presence echo, a rejoin) changes nothing.
  world.viewerMoved(a.client, a.actor)
  world.actorPlaced(a.actor)
  assert.equal(world.authority.store.get(TREE.id)?.actionId, started.actionId)
  // A manual step, even back toward the node, cancels.
  a.actor.ty += a.actor.ty > TREE.ty ? -1 : 1
  world.viewerMoved(a.client, a.actor)
  assert.equal(world.authority.store.get(TREE.id), null)
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).reason, 'moved')
})

test('no free tile for the trainer: a clean refusal before anything is authorized or held', async () => {
  const { world, join, skills, placed } = setup()
  const rock = resourceById('pradera:-46:-124:icerock')
  const from = { tx: -46, ty: -123 }
  assert.equal(workPlacement(rock, from, isOpen), null, 'fixture: boxed in on real terrain')
  const a = join('a', from)
  const reply = await work(world, a.actor, rock.id)
  assert.deepEqual({ ok: reply.ok, reason: reply.reason }, { ok: false, reason: 'no-room' })
  assert.equal(world.authority.store.get(rock.id), null)
  assert.equal(skills.cancelled.length, 0)
  assert.deepEqual(placed, [])
  assert.deepEqual({ tx: a.actor.tx, ty: a.actor.ty }, from, 'the trainer was not moved')
})

test('complete and cancel take only the Pokémon away: the trainer stays on its waiting tile', async () => {
  for (const end of ['complete', 'cancel']) {
    const { world, clock, join, nodeSeenBy } = setup()
    const a = join('a', SPOT_A)
    const b = join('b', SPOT_B)
    const started = await work(world, a.actor)
    const waiting = { tx: a.actor.tx, ty: a.actor.ty }
    if (end === 'complete') { clock.advance(3_000); world.tick(); await settle() } else world.cancel(a.actor, { actionId: started.actionId })
    world.flush()
    assert.equal(nodeSeenBy(b.client).worker, undefined, end)
    assert.deepEqual({ tx: a.actor.tx, ty: a.actor.ty }, waiting, `${end}: no teleport back`)
  }
})

test('disconnecting: the work goes on, the Pokémon stays on its tile, and it pays once', async () => {
  const { world, clock, actors, skills, join, nodeSeenBy } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  await work(world, a.actor)
  world.flush()
  const stand = nodeSeenBy(b.client).worker.stand
  world.leave(a.client)
  actors.delete('a')
  clock.advance(1_500); world.tick(); world.flush()
  assert.deepEqual(world.authority.store.get(TREE.id).worker.stand, stand)
  clock.advance(1_500); world.tick(); await settle(); world.flush()
  assert.equal(nodeSeenBy(b.client).state, 'depleted')
  assert.equal(skills.grants, 1)
})

test('two trainers side by side never get each other’s tiles', async () => {
  const { world, join } = setup()
  const [first, second] = praderaNodesNearSpawn(40).filter(({ node, stands }) => workPlacement(node, stands[0], isOpen)).slice(0, 2)
  const a = join('a', first.stands[0])
  const b = join('b', second.stands[0])
  await work(world, a.actor, first.node.id, 25)
  await work(world, b.actor, second.node.id, 6)
  const tiles = [...world.authority.actions.values()].flatMap(action => [action.stand, action.anchor]).map(t => `${t.tx},${t.ty}`)
  assert.equal(new Set(tiles).size, tiles.length)
})

test('the new client stays gentle on a fake client: a fresh guest snapshot carries the stand', async () => {
  const { world, join } = setup()
  const a = join('a', SPOT_A)
  await work(world, a.actor)
  const guest = fakeClient('guest')
  world.join(guest, { worldProtocol: 1 }, { kind: 'guest' })
  world.snapshot(guest, { id: null, areaId: 'pradera', tx: SPOT_B.tx, ty: SPOT_B.ty })
  const node = lastMessage(guest, WORLD_MESSAGE.SNAPSHOT).nodes.find(entry => entry.id === TREE.id)
  assert.deepEqual({ tx: node.worker.stand.tx, ty: node.worker.stand.ty }, SPOT_A)
})
