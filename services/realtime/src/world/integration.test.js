import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createDevPlayerData } from './persistence/dev/devPlayerData.js'
import { ownershipFromPlayerData } from './pokemonOwnership.js'
import { PLOTS } from './plots.js'
import { RESPAWN_MS } from './resourceLayout.js'
import { createSkillsWorldPolicy, skillsResourceFor } from './skills/skills.generated.js'
import { fakeClient, lastMessage, manualClock, messagesOf, praderaNodesNearSpawn, settle } from './testing.js'
import { WORLD_MESSAGE } from './worldProtocol.js'
import { WorldRoom } from './worldRoom.js'

// INTEGRATION-1 end to end on the server: WORLD's room and authority, the
// real SKILLS rules (the generated bundle), and the real migration on an
// embedded Postgres. Nothing here is a fake policy.

const A = 'benchmark-a'
const B = 'benchmark-b'
const SCYTHER = 123 // A's Talar specialist (dev roster)
const DIGLETT = 50 // A's Minería specialist
const MILTANK = 241 // A's Agricultura specialist
const PINSIR = 127 // B's Talar specialist

const firstOf = resourceId => praderaNodesNearSpawn(20).find(({ node }) => skillsResourceFor(node)?.id === resourceId)
const TREE = firstOf('common_tree')
const ROCK = firstOf('stone_outcrop')
const PLOT = PLOTS[0]
const PLOT_STAND = { tx: PLOT.tx - 1, ty: PLOT.ty }

async function stage({ dataDir = null, playerData = null, clock = manualClock(Date.now()) } = {}) {
  const data = playerData ?? await createDevPlayerData({ dataDir })
  const actors = new Map()
  const sockets = new Map()
  const skills = createSkillsWorldPolicy({ store: data, now: clock.now, growScale: 0.001 })
  const world = new WorldRoom({
    skills, ownership: ownershipFromPlayerData(data, clock.now), playerData: data, now: clock.now, log: () => {},
    lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
  })
  await world.start()
  const join = async (id, spot) => {
    const client = fakeClient(id)
    const actor = { id, areaId: 'pradera', tx: spot.tx, ty: spot.ty }
    actors.set(id, actor); sockets.set(id, client)
    world.join(client, { worldProtocol: 1 }, { kind: 'player', userId: id, token: null })
    world.snapshot(client, actor)
    await settle(); await settle()
    return { client, actor }
  }
  const finish = async ms => { clock.advance(ms); world.tick(); await quiet(world); world.flush() }
  return { data, world, clock, join, finish }
}

const nodeIn = (payload, id) => payload?.nodes?.find(node => node.id === id)

/** Waits until no action is being settled (database writes are real and take real time). */
async function quiet(world, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  await settle()
  while ([...world.authority.actions.values()].some(action => action.phase === 'settling')) {
    if (Date.now() > deadline) throw new Error('settlement did not finish')
    await new Promise(resolve => setTimeout(resolve, 5))
  }
  await settle()
}

test('Talar: A chops with its Pokémon, B sees it, B is refused, ONE settlement gives XP + wood, the stump persists', async () => {
  assert.ok(TREE, 'a common tree near the Pradera arrival')
  const s = await stage()
  const a = await s.join(A, TREE.stands[0])
  const b = await s.join(B, TREE.stands[1])
  assert.ok(lastMessage(a.client, WORLD_MESSAGE.PLAYER_STATE).pokemon.some(p => p.instanceId === SCYTHER))

  await s.world.work(a.actor, { nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1 })
  const started = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
  assert.equal(started.ok, true, JSON.stringify(started))
  assert.equal(started.details.skillId, 'woodcutting')
  s.world.flush()
  assert.deepEqual(nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH), TREE.node.id).worker, { playerId: A, pokemonInstanceId: SCYTHER, speciesId: SCYTHER })

  await s.world.work(b.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 })
  assert.equal(lastMessage(b.client, WORLD_MESSAGE.WORK_RESULT).reason, 'busy')

  await s.finish(started.endsAt - started.startedAt)
  const done = lastMessage(a.client, WORLD_MESSAGE.WORK_DONE)
  assert.equal(done.ok, true, JSON.stringify(done))
  assert.equal(done.summary.xpGained, 10)
  assert.equal(done.summary.rewards[0].itemId, 'common_log')
  assert.equal(nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH), TREE.node.id).state, 'depleted')

  // "Reload": the saved state, read fresh from the database.
  const saved = await s.data.playerState(A)
  assert.equal(saved.xp.woodcutting, 10)
  assert.ok(saved.materials.common_log >= 1)
  assert.deepEqual(s.world.stats().nodesByState, { depleted: 1 })
  const persisted = await s.data.loadNodes()
  assert.equal(persisted.find(n => n.nodeId === TREE.node.id).state, 'depleted')

  // A latecomer sees the stump; after the respawn instant everyone sees the tree.
  const c = await s.join('benchmark-c', { tx: TREE.stands[0].tx + 2, ty: TREE.stands[0].ty })
  assert.equal(nodeIn(lastMessage(c.client, WORLD_MESSAGE.SNAPSHOT), TREE.node.id).state, 'depleted')
  for (const viewer of [a, b, c]) viewer.client.messages.length = 0
  await s.finish(RESPAWN_MS.tree)
  for (const viewer of [a, b, c]) assert.equal(nodeIn(lastMessage(viewer.client, WORLD_MESSAGE.BATCH), TREE.node.id).base, true)
  await s.data.close()
})

test('a realtime restart keeps a depleted tree depleted until its respawn instant', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'world-restart-'))
  try {
    const clock = manualClock(Date.now())
    const first = await stage({ dataDir: dir, clock })
    const a = await first.join(A, TREE.stands[0])
    await first.world.work(a.actor, { nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1 })
    const started = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
    await first.finish(started.endsAt - started.startedAt)
    await first.data.close()

    // New process, same database: still a stump, and still not workable.
    const again = await stage({ dataDir: dir, clock })
    const b = await again.join(B, TREE.stands[1])
    assert.equal(nodeIn(lastMessage(b.client, WORLD_MESSAGE.SNAPSHOT), TREE.node.id).state, 'depleted')
    await again.world.work(b.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 })
    assert.equal(lastMessage(b.client, WORLD_MESSAGE.WORK_RESULT).reason, 'depleted')
    await again.finish(RESPAWN_MS.tree)
    await again.world.work(b.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 2 })
    assert.equal(lastMessage(b.client, WORLD_MESSAGE.WORK_RESULT).ok, true)
    await again.data.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('Minería: the same loop on a real rock — Minería XP and stone', async () => {
  assert.ok(ROCK, 'a rock near the Pradera arrival')
  const s = await stage()
  const a = await s.join(A, ROCK.stands[0])
  await s.world.work(a.actor, { nodeId: ROCK.node.id, pokemonInstanceId: DIGLETT, requestId: 1 })
  const started = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
  assert.equal(started.details.skillId, 'mining')
  await s.finish(started.endsAt - started.startedAt)
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).summary.rewards[0].itemId, 'stone')
  const saved = await s.data.playerState(A)
  assert.equal(saved.xp.mining, 10)
  assert.equal(saved.xp.woodcutting, 0)
  await s.data.close()
})

test('Agricultura: plant → both see it growing → restart → ready by server time → harvest pays once', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'world-farm-'))
  try {
    const clock = manualClock(Date.now())
    const first = await stage({ dataDir: dir, clock })
    const a = await first.join(A, PLOT_STAND)
    const b = await first.join(B, { tx: PLOT.tx, ty: PLOT.ty - 1 })
    // Planting needs a crop choice; SKILLS says which ones are allowed.
    await first.world.work(a.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 1 })
    assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).reason, 'choose-crop')
    await first.world.work(a.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 2, cropId: 'leppa' })
    assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).reason, 'level-too-low')
    await first.world.work(a.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 3, cropId: 'oran' })
    const planting = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
    assert.equal(planting.ok, true, JSON.stringify(planting))
    await first.finish(planting.endsAt - planting.startedAt)
    const planted = nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH), PLOT.id)
    assert.equal(planted.state, 'planted')
    assert.equal(planted.plot.cropId, 'oran')
    assert.equal(planted.plot.ownerId, A)
    assert.equal((await first.data.playerState(A)).xp.farming, 8)
    // B cannot harvest or tend A's crop.
    await first.world.work(b.actor, { nodeId: PLOT.id, pokemonInstanceId: 182, requestId: 1 })
    assert.equal(lastMessage(b.client, WORLD_MESSAGE.WORK_RESULT).reason, 'not-your-plot')
    await first.data.close()

    // Restart while it grows: the stage comes from the stored timestamps.
    const again = await stage({ dataDir: dir, clock })
    const a2 = await again.join(A, PLOT_STAND)
    const seen = nodeIn(lastMessage(a2.client, WORLD_MESSAGE.SNAPSHOT), PLOT.id)
    assert.equal(seen.state, 'planted')
    clock.set(seen.plot.readyAt)
    again.world.tick()
    again.world.flush()
    assert.equal(nodeIn(lastMessage(a2.client, WORLD_MESSAGE.BATCH), PLOT.id).state, 'ready')

    await again.world.work(a2.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 1 })
    const harvesting = lastMessage(a2.client, WORLD_MESSAGE.WORK_RESULT)
    assert.equal(harvesting.farmAction, 'harvest')
    await again.finish(harvesting.endsAt - harvesting.startedAt)
    const harvest = lastMessage(a2.client, WORLD_MESSAGE.WORK_DONE)
    assert.equal(harvest.summary.rewards[0].itemId, 'oran_berry')
    // A second harvest of the same plot is physically impossible now: it is empty.
    await again.world.work(a2.actor, { nodeId: PLOT.id, pokemonInstanceId: MILTANK, requestId: 2 })
    assert.equal(lastMessage(a2.client, WORLD_MESSAGE.WORK_RESULT).reason, 'choose-crop')
    const saved = await again.data.playerState(A)
    assert.equal(saved.xp.farming, 8 + 25)
    assert.equal(saved.materials.oran_berry, harvest.summary.rewards[0].quantity)
    assert.equal((await again.data.loadNodes()).some(n => n.nodeId === PLOT.id), false, 'harvested plots leave no row')
    await again.data.close()
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('hostile payloads: xp, reward, quantity and userId in the intent are never read', async () => {
  const s = await stage()
  const a = await s.join(A, TREE.stands[0])
  await s.world.work(a.actor, {
    nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1,
    xp: 999999, reward: { itemId: 'gold_ore', quantity: 500 }, quantity: 99, userId: B, playerId: B, durationMs: 1,
  })
  const started = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
  assert.equal(started.ok, true)
  assert.ok(started.endsAt - started.startedAt >= 1200, 'duration is SKILLS’, not the payload’s')
  await s.finish(started.endsAt - started.startedAt)
  const saved = await s.data.playerState(A)
  assert.equal(saved.xp.woodcutting, 10)
  assert.deepEqual(Object.keys(saved.materials), ['common_log'])
  assert.equal((await s.data.playerState(B)).xp.woodcutting, 0, 'the payload cannot name another player')
  await s.data.close()
})

test('refusals: someone else’s Pokémon, a fake node, a far node', async () => {
  const s = await stage()
  const a = await s.join(A, TREE.stands[0])
  await s.join(B, TREE.stands[1])
  await s.world.work(a.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 })
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).reason, 'not-owner')
  await s.world.work(a.actor, { nodeId: `pradera:${TREE.node.tx}:${TREE.node.ty}:boulder`, pokemonInstanceId: SCYTHER, requestId: 2 })
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).reason, 'unknown-node')
  await s.world.work(a.actor, { nodeId: ROCK.node.id, pokemonInstanceId: DIGLETT, requestId: 3 })
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT).reason, 'too-far')
  await s.data.close()
})

test('A and B race for the same tree with real rules: one reservation, one reward', async () => {
  const s = await stage()
  const a = await s.join(A, TREE.stands[0])
  const b = await s.join(B, TREE.stands[1])
  await Promise.all([
    s.world.work(a.actor, { nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1 }),
    s.world.work(b.actor, { nodeId: TREE.node.id, pokemonInstanceId: PINSIR, requestId: 1 }),
  ])
  const results = [lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT), lastMessage(b.client, WORLD_MESSAGE.WORK_RESULT)]
  assert.deepEqual(results.map(r => r.ok).sort(), [false, true])
  assert.equal(results.find(r => !r.ok).reason, 'busy')
  const winner = results.find(r => r.ok)
  await s.finish(winner.endsAt - winner.startedAt)
  const total = (await s.data.playerState(A)).xp.woodcutting + (await s.data.playerState(B)).xp.woodcutting
  assert.equal(total, 10)
  await s.data.close()
})

test('exactly once: duplicate completions, and a retry after the store timed out', async () => {
  const clock = manualClock(Date.now())
  const real = await createDevPlayerData()
  let failNext = 1
  // The first commit "times out" AFTER the database wrote it: the retry must be a no-op.
  const flaky = { ...real, async commitWork(commit) { const result = await real.commitWork(commit); if (failNext-- > 0) throw new Error('timeout'); return result } }
  const s = await stage({ playerData: flaky, clock })
  s.world.authority.sleep = async () => {}
  const a = await s.join(A, TREE.stands[0])
  await s.world.work(a.actor, { nodeId: TREE.node.id, pokemonInstanceId: SCYTHER, requestId: 1 })
  const started = lastMessage(a.client, WORLD_MESSAGE.WORK_RESULT)
  clock.advance(started.endsAt - started.startedAt)
  await Promise.all([s.world.authority.complete(started.actionId), s.world.authority.complete(started.actionId)])
  s.world.tick()
  await quiet(s.world)
  const saved = await real.playerState(A)
  assert.equal(saved.xp.woodcutting, 10, 'one reward')
  // One roll paid once: base 1 log, +1 when the specialist's aptitude bonus rolls.
  assert.ok([1, 2].includes(saved.materials.common_log), `one drop, got ${saved.materials.common_log}`)
  assert.equal(messagesOf(a.client, WORLD_MESSAGE.WORK_DONE).length, 1)
  assert.equal(s.world.stats().actions.duplicateSettlements, 1, 'the retry found the settlement already stored')
  await real.close()
})
