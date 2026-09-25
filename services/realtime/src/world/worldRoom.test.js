import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { RESPAWN_MS } from './resourceLayout.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { WORLD_RETAIN_TILES } from './worldInterest.js'
import { WorldRoom } from './worldRoom.js'
import { fakeClient, lastMessage, manualClock, messagesOf, praderaNodesNearSpawn, settle } from './testing.js'

const [{ node: TREE, stands: [SPOT_A, SPOT_B] }] = praderaNodesNearSpawn()

function setup() {
  const clock = manualClock()
  const actors = new Map()
  const sockets = new Map()
  const skills = createDemoSkillPolicy({ durationMs: 3_000 })
  const world = new WorldRoom({
    skills, ownership: createStaticOwnership({ a: [25], b: [6], c: [7] }), now: clock.now,
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
  return { world, clock, actors, sockets, skills, join }
}

const nodeIn = (payload, id = TREE.id) => payload?.nodes?.find(node => node.id === id)
const work = (world, actor, requestId, pokemonInstanceId) => world.work(actor, { nodeId: TREE.id, pokemonInstanceId, requestId })

test('two viewers beside the same tree both hold its chunk, and the ids come from the layout alone', () => {
  const { join } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  const snapA = lastMessage(a.client, WORLD_MESSAGE.SNAPSHOT)
  const snapB = lastMessage(b.client, WORLD_MESSAGE.SNAPSHOT)
  assert.ok(snapA.chunks.includes(TREE.chunkId))
  assert.ok(snapB.chunks.includes(TREE.chunkId))
  // Nothing is happening yet: the layout is not sent, only state that differs from it.
  assert.deepEqual(snapA.nodes, [])
})

test('A works a tree, B sees it working, B is refused, A finishes, B sees it depleted', async () => {
  const { world, clock, join, skills } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  const started = await work(world, a.actor, 1, 25)
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).ok, true)
  world.flush()
  const seen = nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH))
  assert.deepEqual(
    { state: seen.state, worker: seen.worker, workKind: seen.workKind, startedAt: seen.startedAt, endsAt: seen.endsAt },
    { state: 'working', worker: { playerId: 'a', pokemonInstanceId: 25, speciesId: 25 }, workKind: 'chop', startedAt: started.startedAt, endsAt: started.endsAt },
  )
  // The node only carries what everyone may know: no reward, no summary.
  assert.equal('summary' in seen, false)

  await work(world, b.actor, 1, 6)
  assert.equal(lastMessage(b.client, WORLD_MESSAGE.WORK_RESULT).reason, 'busy')

  clock.advance(3_000)
  world.tick()
  await settle()
  world.flush()
  assert.equal(nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH)).state, 'depleted')
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).ok, true)
  assert.equal(messagesOf(b.client, WORLD_MESSAGE.WORK_DONE).length, 0, 'the settlement result is private to the worker')
  assert.equal(skills.grants, 1)
})

test('a newcomer sees the depleted node, and everyone sees the respawn in the same flush', async () => {
  const { world, clock, join } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  await work(world, a.actor, 1, 25)
  clock.advance(3_000)
  world.tick()
  await settle()
  world.flush()

  const c = join('c', { tx: SPOT_A.tx + 4, ty: SPOT_A.ty })
  const depleted = nodeIn(lastMessage(c.client, WORLD_MESSAGE.SNAPSHOT))
  assert.equal(depleted.state, 'depleted')
  assert.equal(depleted.respawnAt, clock.now() + RESPAWN_MS.tree)

  for (const viewer of [a, b, c]) viewer.client.messages.length = 0
  clock.advance(RESPAWN_MS.tree)
  world.tick()
  world.flush()
  const respawned = [a, b, c].map(viewer => nodeIn(lastMessage(viewer.client, WORLD_MESSAGE.BATCH)))
  assert.deepEqual(respawned.map(node => node.state), ['available', 'available', 'available'])
  assert.equal(new Set(respawned.map(node => node.version)).size, 1, 'one change, one version, for everyone')
})

test('leaving and re-entering the chunk window returns the server state, not a fresh one', async () => {
  const { world, clock, join } = setup()
  const a = join('a', SPOT_A)
  const b = join('b', SPOT_B)
  await work(world, a.actor, 1, 25)
  clock.advance(3_000)
  world.tick()
  await settle()
  world.flush()

  // B walks far away: the chunk leaves its window.
  b.actor.tx = TREE.tx + WORLD_RETAIN_TILES + 40
  world.viewerMoved(b.client, b.actor)
  world.flush()
  assert.ok(lastMessage(b.client, WORLD_MESSAGE.BATCH).leave.includes(TREE.chunkId))
  // Changes there no longer reach B.
  b.client.messages.length = 0
  // B comes back: the chunk's current state arrives with the enter.
  b.actor.tx = SPOT_B.tx
  world.viewerMoved(b.client, b.actor)
  world.flush()
  const enter = lastMessage(b.client, WORLD_MESSAGE.BATCH).enter.find(entry => entry.chunk === TREE.chunkId)
  assert.equal(enter.nodes.find(node => node.id === TREE.id).state, 'depleted')
})

test('small moves inside the window do not resubscribe (hysteresis)', () => {
  const { world, join } = setup()
  const a = join('a', SPOT_A)
  // Reach both ends once: the window may grow there. After that, pacing
  // inside the range must cost nothing.
  for (const dx of [-2, 3]) { a.actor.tx = SPOT_A.tx + dx; world.viewerMoved(a.client, a.actor) }
  world.flush()
  a.client.messages.length = 0
  world.metrics.chunkEnters = 0
  world.metrics.chunkLeaves = 0
  for (const dx of [1, 2, 3, 2, 1, 0, -1, -2, -1, 0]) {
    a.actor.tx = SPOT_A.tx + dx
    world.viewerMoved(a.client, a.actor)
  }
  world.flush()
  assert.equal(messagesOf(a.client, WORLD_MESSAGE.BATCH).length, 0)
  assert.equal(world.metrics.chunkEnters, 0)
  assert.equal(world.metrics.chunkLeaves, 0)
})

test('a reconnecting worker gets its running action and the node state back', async () => {
  const { world, join, sockets } = setup()
  const a = join('a', SPOT_A)
  const started = await work(world, a.actor, 1, 25)
  world.leave(a.client)
  const again = fakeClient('a-again')
  sockets.set('a', again)
  world.join(again, { worldProtocol: 1 }, { kind: 'player', userId: 'a', token: null })
  world.snapshot(again, a.actor)
  const snapshot = lastMessage(again, WORLD_MESSAGE.SNAPSHOT)
  assert.equal(nodeIn(snapshot).state, 'working')
  assert.deepEqual(snapshot.ownAction, { actionId: started.actionId, nodeId: TREE.id, startedAt: started.startedAt, endsAt: started.endsAt })
})

test('a client without the world protocol never receives world messages', async () => {
  const { world, join } = setup()
  const a = join('a', SPOT_A)
  const legacy = fakeClient('legacy')
  world.join(legacy, { presenceProtocol: 2 }, { kind: 'player', userId: 'legacy', token: null })
  world.snapshot(legacy, { id: 'legacy', areaId: 'pradera', ...SPOT_B })
  await work(world, a.actor, 1, 25)
  world.flush()
  assert.equal(legacy.messages.length, 0)
})

test('malformed intents are refused before any lookup', async () => {
  const { world, join } = setup()
  const a = join('a', SPOT_A)
  for (const payload of [null, {}, { nodeId: TREE.id, pokemonInstanceId: '25', requestId: 1 }, { nodeId: 'x', pokemonInstanceId: 25, requestId: 1 },
    { nodeId: TREE.id, pokemonInstanceId: 25, requestId: 1, durationMs: 1, state: 'depleted', reward: 99 }]) {
    a.client.messages.length = 0
    await world.work(a.actor, payload)
    const result = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
    if (payload?.reward) {
      // Extra fields are not an error, they are simply never read.
      assert.equal(result.ok, true)
      assert.equal(result.endsAt - result.startedAt, 3_000)
    } else assert.equal(result.reason, 'invalid')
  }
})

test('Pradera viewers get the same wild roster in their snapshot, and the new one at the hour', async () => {
  const { createStaticWildCatalog } = await import('./wildService.js')
  const { WILD_ROTATE_MS } = await import('./wildPopulation.js')
  let now = 490_000 * WILD_ROTATE_MS + 5
  const catalog = createStaticWildCatalog(Array.from({ length: 60 }, (_, i) => ({ id: i + 1, type1: 'normal', type2: null, is_legendary: false, base_aura: 0 })))
  const world = new WorldRoom({ skills: createDemoSkillPolicy(), ownership: createStaticOwnership({}), catalog, now: () => now, lookupActor: () => null, clientForPlayer: () => null })
  world.tick(); await settle()
  const a = fakeClient('a'); const b = fakeClient('b'); const town = fakeClient('t')
  for (const c of [a, b, town]) world.join(c, { worldProtocol: 1 }, { kind: 'guest' })
  world.snapshot(a, { areaId: 'pradera', ...SPOT_A })
  world.snapshot(b, { areaId: 'pradera', ...SPOT_B })
  world.snapshot(town, { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  assert.deepEqual(lastMessage(a, WORLD_MESSAGE.SNAPSHOT).wild, lastMessage(b, WORLD_MESSAGE.SNAPSHOT).wild)
  assert.ok(lastMessage(a, WORLD_MESSAGE.SNAPSHOT).wild.entities.length > 0)
  assert.equal(lastMessage(town, WORLD_MESSAGE.SNAPSHOT).wild, undefined)
  now += WILD_ROTATE_MS
  world.tick(); await settle()
  assert.equal(lastMessage(a, WORLD_MESSAGE.WILD).wild.epoch, 490_001)
  assert.deepEqual(lastMessage(a, WORLD_MESSAGE.WILD).wild, lastMessage(b, WORLD_MESSAGE.WILD).wild)
  assert.equal(lastMessage(town, WORLD_MESSAGE.WILD), undefined)
})

test('a long session needs no player token: ownership is asked by user id, server-side', async () => {
  // The room keeps no token at all; the ownership port only ever sees the
  // authenticated user id. An hour later (or with the JWT long expired) the
  // same player can still work.
  const { world, clock, join } = setup()
  const a = join('a', SPOT_A)
  assert.equal('credentials' in world, false)
  clock.advance(3 * 60 * 60_000)
  await work(world, a.actor, 1, 25)
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).ok, true)
})
