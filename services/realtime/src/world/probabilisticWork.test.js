import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { RESPAWN_MS } from './resourceLayout.js'
import { createSkillsWorldPolicy, skillsResourceFor } from './skills/skills.generated.js'
import {
  fakeClient, keysDeep, lastMessage, manualClock, messagesOf, numbersDeep, praderaNodesNearSpawn, privateDuration, scriptedRandom, settle,
} from './testing.js'
import { standableTile, workPlacement } from './workPlacement.js'
import { WORK_TICK_MS, WORLD_MESSAGE, WORLD_PROTOCOL } from './worldProtocol.js'
import { WorldRoom } from './worldRoom.js'

// SKILLS PROB-2 through the real room and the real SKILLS rules (the bundle):
// the server draws how many attempts an action takes, keeps the end to
// itself, and settles exactly once. Every random value is scripted.

const isOpen = standableTile('pradera')
const TREE = praderaNodesNearSpawn(20).find(({ node, stands }) => skillsResourceFor(node)?.id === 'common_tree' && stands.length >= 2 && workPlacement(node, stands[0], isOpen))
const SCYTHER = 123
const PINSIR = 127
const LEVEL_50_XP = 10_000_000
/** Keys that would let a client anticipate the end of an action. */
const FORBIDDEN = ['endsAt', 'durationMs', 'attempts', 'maxAttempts', 'chance', 'seed', 'nextAttemptAt', 'actionEndsAt']

/** SKILLS' settlement store, in memory, deduplicated by action id like world_commit_work. */
function memoryStore({ xp = {} } = {}) {
  const settlements = new Map()
  const totals = new Map()
  return {
    settlements,
    xpOf: (userId, skillId) => totals.get(`${userId}:${skillId}`) ?? 0,
    async playerState(userId) {
      return { xp: { woodcutting: xp[userId] ?? 0, mining: 0, farming: 0 }, materials: {}, pokemon: [{ instanceId: SCYTHER, speciesId: SCYTHER }, { instanceId: PINSIR, speciesId: PINSIR }] }
    },
    async commitWork(commit) {
      if (settlements.has(commit.actionId)) return { applied: false, settlement: { xp_after: this.xpOf(commit.userId, commit.skillId) } }
      settlements.set(commit.actionId, commit)
      const key = `${commit.userId}:${commit.skillId}`
      totals.set(key, (totals.get(key) ?? (xp[commit.userId] ?? 0)) + commit.xpGained)
      return { applied: true, settlement: { xp_after: totals.get(key) } }
    },
  }
}

function setup({ random = scriptedRandom(), xp = {}, skills = null } = {}) {
  const clock = manualClock()
  const actors = new Map()
  const sockets = new Map()
  const store = memoryStore({ xp })
  const policy = skills ?? createSkillsWorldPolicy({ store, now: clock.now, random })
  let authorizations = 0
  const counted = { ...policy, authorizeWorkAttempt: attempt => { authorizations++; return policy.authorizeWorkAttempt(attempt) } }
  const world = new WorldRoom({
    skills: counted, ownership: createStaticOwnership({ a: [SCYTHER], b: [PINSIR], old: [SCYTHER] }), now: clock.now,
    lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
    placeActor: (id, place) => {
      const actor = actors.get(id)
      if (!actor) return
      Object.assign(actor, place)
      world.viewerMoved(sockets.get(id), actor)
    },
  })
  const join = (id, spot, protocol = WORLD_PROTOCOL) => {
    const client = fakeClient(id)
    const actor = { id, areaId: 'pradera', tx: spot.tx, ty: spot.ty }
    actors.set(id, actor); sockets.set(id, client)
    world.join(client, protocol === null ? {} : { worldProtocol: protocol }, { kind: 'player', userId: id, token: null })
    world.snapshot(client, actor)
    return { client, actor }
  }
  /** Advances the server clock one work tick at a time, ticking and flushing like the room does. */
  const advance = async ms => {
    for (let left = ms; left > 0; left -= Math.min(WORK_TICK_MS, left)) {
      clock.advance(Math.min(WORK_TICK_MS, left)); world.tick(); await settle(); await settle(); world.flush()
    }
  }
  return { world, clock, actors, sockets, store, join, advance, authorizations: () => authorizations }
}

const work = (world, actor, requestId = 1, pokemonInstanceId = SCYTHER) => world.work(actor, { nodeId: TREE.node.id, pokemonInstanceId, requestId })
const nodeIn = (payload, id = TREE.node.id) => payload?.nodes?.find(node => node.id === id)
/** Six failed rolls, then a success: a level-1 common tree (p = 0.16) takes 7 attempts. */
const SEVEN_ATTEMPTS = () => scriptedRandom([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.01])

test('the drawn end never reaches any client: owner, observer, guest, a reconnecting owner', async () => {
  assert.ok(TREE, 'a workable common tree near the Pradera arrival')
  const s = setup({ random: SEVEN_ATTEMPTS() })
  const a = s.join('a', TREE.stands[0])
  const b = s.join('b', TREE.stands[1])
  const guest = fakeClient('guest')
  s.world.join(guest, { worldProtocol: WORLD_PROTOCOL }, { kind: 'guest' })
  s.world.snapshot(guest, { areaId: 'pradera', tx: TREE.node.tx, ty: TREE.node.ty + 2 })

  const started = await work(s.world, a.actor)
  assert.equal(started.ok, true, JSON.stringify(started))
  const duration = privateDuration(s.world.authority, started.actionId)
  const end = started.startedAt + duration
  assert.equal(duration, 7 * WORK_TICK_MS, 'the scripted draw: 7 attempts')

  // Mid-action the owner reloads: a new socket, a fresh snapshot with its own action.
  await s.advance(3 * WORK_TICK_MS)
  const again = fakeClient('a-again')
  s.sockets.set('a', again)
  s.world.join(again, { worldProtocol: WORLD_PROTOCOL }, { kind: 'player', userId: 'a', token: null })
  s.world.snapshot(again, a.actor)
  assert.deepEqual(lastMessage(again, WORLD_MESSAGE.SNAPSHOT).ownAction, { actionId: started.actionId, nodeId: TREE.node.id, startedAt: started.startedAt })
  await s.advance(3 * WORK_TICK_MS)
  assert.ok(s.clock.now() < end, 'still before the secret end')

  for (const [who, client] of [['owner', a.client], ['observer', b.client], ['guest', guest], ['reconnected owner', again]]) {
    assert.ok(client.messages.length > 0, who)
    for (const { type, payload } of client.messages) {
      const keys = keysDeep(payload)
      for (const key of FORBIDDEN) assert.equal(keys.has(key), false, `${who} got ${key} in ${type}`)
      for (const value of numbersDeep(payload)) {
        assert.notEqual(value, end, `${who} got the end instant in ${type}`)
        assert.notEqual(value, duration, `${who} got the duration in ${type}`)
      }
    }
  }
  // What they do get: who works, where, since when.
  const seen = nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH) ?? lastMessage(b.client, WORLD_MESSAGE.SNAPSHOT))
    ?? nodeIn(messagesOf(b.client, WORLD_MESSAGE.BATCH).find(batch => nodeIn(batch)))
  assert.deepEqual(Object.keys(seen).sort(), ['actionId', 'id', 'startedAt', 'state', 'version', 'workKind', 'worker'])

  await s.advance(WORK_TICK_MS)
  const done = lastMessage(again, WORLD_MESSAGE.WORK_DONE)
  assert.equal(done.ok, true)
  for (const key of FORBIDDEN) assert.equal(keysDeep(done).has(key), false, `work:done carries ${key}`)
})

test('owner and observers get the same start and the same stand: the animation phase is shared', async () => {
  const s = setup({ random: SEVEN_ATTEMPTS() })
  const a = s.join('a', TREE.stands[0])
  const b = s.join('b', TREE.stands[1])
  const started = await work(s.world, a.actor)
  s.world.flush()
  const seenByB = nodeIn(messagesOf(b.client, WORLD_MESSAGE.BATCH).find(batch => nodeIn(batch)))
  const late = fakeClient('c')
  s.world.join(late, { worldProtocol: WORLD_PROTOCOL }, { kind: 'guest' })
  s.world.snapshot(late, { areaId: 'pradera', tx: TREE.node.tx, ty: TREE.node.ty })
  const seenLate = nodeIn(lastMessage(late, WORLD_MESSAGE.SNAPSHOT))
  for (const seen of [seenByB, seenLate]) {
    assert.equal(seen.startedAt, started.startedAt)
    assert.equal(seen.workKind, 'chop')
    assert.deepEqual(seen.worker.stand, { ...TREE.stands[0], dir: seen.worker.stand.dir })
  }
  // The phase every client derives: (serverNow − startedAt) mod WORK_TICK_MS, identical for all.
  assert.equal(WORK_TICK_MS, 600)
})

test('Talar at level 50 with the best roll: done on the very first tick, not before', async () => {
  const s = setup({ random: () => 0, xp: { a: LEVEL_50_XP } })
  const a = s.join('a', TREE.stands[0])
  const started = await work(s.world, a.actor)
  assert.equal(privateDuration(s.world.authority, started.actionId), WORK_TICK_MS)
  s.clock.advance(WORK_TICK_MS - 1); s.world.tick(); await settle()
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE), undefined)
  s.clock.advance(1); s.world.tick(); await settle(); await settle()
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).ok, true)
  assert.equal(s.store.settlements.size, 1)
})

test('a beginner with the worst luck stops at the cap: ⌈3/p⌉ ticks, never more', async () => {
  const s = setup({ random: () => 0.9999999 })
  const a = s.join('a', TREE.stands[0])
  const started = await work(s.world, a.actor)
  // Common tree, level 1, Scyther (aptitude 5): p = 1 − 0.84^1.25 ≈ 0.1958 → cap ⌈3/p⌉ = 16.
  assert.equal(privateDuration(s.world.authority, started.actionId), 16 * WORK_TICK_MS)
  await s.advance(16 * WORK_TICK_MS)
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).ok, true)
})

test('cancelling before the success pays nothing, frees the tree, and the next action draws again', async () => {
  const s = setup({ random: scriptedRandom([0.9, 0.9, 0.9, 0.9, 0.9, 0.9, 0.01, 0], 0.5) })
  const a = s.join('a', TREE.stands[0])
  const first = await work(s.world, a.actor)
  await s.advance(2 * WORK_TICK_MS)
  s.world.cancel(a.actor, { actionId: first.actionId })
  s.world.flush()
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).ok, false)
  assert.equal(s.world.authority.store.get(TREE.node.id), null, 'the tree is back for everyone')
  await s.advance(10 * WORK_TICK_MS)
  assert.equal(s.store.settlements.size, 0, 'nothing was paid')
  // Step back to the tree: a fresh action, a fresh secret draw (the next scripted roll succeeds at once).
  Object.assign(a.actor, TREE.stands[0])
  const second = await work(s.world, a.actor, 2)
  assert.equal(second.ok, true)
  assert.notEqual(second.actionId, first.actionId)
  assert.equal(privateDuration(s.world.authority, second.actionId), WORK_TICK_MS)
  await s.advance(WORK_TICK_MS)
  assert.equal(s.store.settlements.size, 1)
})

test('walking away before the success cancels it: nothing paid', async () => {
  const s = setup({ random: SEVEN_ATTEMPTS() })
  const a = s.join('a', TREE.stands[0])
  await work(s.world, a.actor)
  await s.advance(3 * WORK_TICK_MS)
  a.actor.tx += 3
  s.world.viewerMoved(a.client, a.actor)
  await s.advance(10 * WORK_TICK_MS)
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.WORK_DONE).reason, 'moved')
  assert.equal(s.store.settlements.size, 0)
})

test('disconnecting: the Pokémon keeps working in view, it pays once at the secret end; a return later finds no action', async () => {
  const s = setup({ random: SEVEN_ATTEMPTS() })
  const a = s.join('a', TREE.stands[0])
  const b = s.join('b', TREE.stands[1])
  const started = await work(s.world, a.actor)
  s.world.leave(a.client)
  s.sockets.delete('a')
  s.actors.delete('a')
  await s.advance(6 * WORK_TICK_MS)
  assert.equal(s.world.authority.store.get(TREE.node.id).worker.pokemonInstanceId, SCYTHER, 'still visible while it works')
  assert.equal(s.store.settlements.size, 0)
  await s.advance(WORK_TICK_MS)
  assert.equal(s.store.settlements.size, 1)
  assert.equal(nodeIn(lastMessage(b.client, WORLD_MESSAGE.BATCH)).state, 'depleted')
  // Back after the end: nothing running, the reward is already in the store.
  const back = s.join('a', TREE.stands[0])
  assert.equal(lastMessage(back.client, WORLD_MESSAGE.SNAPSHOT).ownAction, undefined)
  assert.equal(s.store.settlements.get(started.actionId).xpGained, 10)
})

test('one action id completed 1, 2 or 20 times pays exactly once', async () => {
  for (const times of [1, 2, 20]) {
    const s = setup({ random: SEVEN_ATTEMPTS() })
    const a = s.join('a', TREE.stands[0])
    const started = await work(s.world, a.actor)
    s.clock.advance(privateDuration(s.world.authority, started.actionId))
    const results = await Promise.all(Array.from({ length: times }, () => s.world.authority.complete(started.actionId)))
    s.world.tick(); await settle(); await settle()
    assert.equal(results.filter(Boolean).length, 1, `${times}×`)
    assert.equal(s.store.settlements.size, 1, `${times}×`)
    assert.equal(messagesOf(a.client, WORLD_MESSAGE.WORK_DONE).length, 1, `${times}×`)
  }
})

test('twenty intents with the same request id start one action', async () => {
  const s = setup({ random: SEVEN_ATTEMPTS() })
  const a = s.join('a', TREE.stands[0])
  const replies = await Promise.all(Array.from({ length: 20 }, () => work(s.world, a.actor, 7)))
  assert.equal(replies.filter(reply => reply.ok).length, 1)
  assert.equal(s.authorizations(), 1, 'SKILLS was asked once')
  assert.equal(s.world.authority.actions.size, 1)
})

test('a client that declares an older world protocol (or none) cannot start anything: client-outdated', async () => {
  for (const protocol of [1, null]) {
    const s = setup({ random: SEVEN_ATTEMPTS() })
    const old = s.join('old', TREE.stands[0], protocol)
    assert.equal(old.client.messages.length, 0, 'no world state for an outdated client')
    const reply = await work(s.world, old.actor, 3)
    assert.deepEqual(reply, { requestId: 3, ok: false, reason: 'client-outdated', message: 'Actualizá la página para seguir trabajando.' })
    assert.equal(reply.reason, 'client-outdated')
    assert.equal(reply.message, 'Actualizá la página para seguir trabajando.')
    assert.deepEqual(lastMessage(old.client, WORLD_MESSAGE.WORK_RESULT), reply)
    assert.equal(s.authorizations(), 0, 'nothing was checked or asked')
    assert.equal(s.world.authority.store.get(TREE.node.id), null, 'nothing was held')
    assert.equal(s.world.stats().transport.outdatedWork, 1)
    // Its only world message is the refusal: no snapshot, no batch, no player state.
    s.world.flush()
    assert.deepEqual(old.client.messages.map(entry => entry.type), [WORLD_MESSAGE.WORK_RESULT])
    // The current protocol still works.
    const current = s.join('a', TREE.stands[1])
    assert.equal((await work(s.world, current.actor, 1)).ok, true)
  }
})

test('depletion and respawn do not depend on the draw: respawn 90 s after the success', async () => {
  for (const random of [() => 0, SEVEN_ATTEMPTS()]) {
    const s = setup({ random })
    const a = s.join('a', TREE.stands[0])
    const started = await work(s.world, a.actor)
    const end = started.startedAt + privateDuration(s.world.authority, started.actionId)
    await s.advance(end - started.startedAt)
    const depleted = s.world.authority.store.get(TREE.node.id)
    assert.equal(depleted.state, 'depleted')
    assert.equal(depleted.respawnAt, end + RESPAWN_MS.tree)
    await s.advance(RESPAWN_MS.tree)
    assert.equal(s.world.authority.store.get(TREE.node.id), null, 'available again')
  }
})

test('the demo policy still runs on whole ticks (transport benchmarks)', async () => {
  const s = setup({ skills: createDemoSkillPolicy({ durationMs: 3_000 }) })
  const a = s.join('a', TREE.stands[0])
  const started = await work(s.world, a.actor)
  assert.equal(privateDuration(s.world.authority, started.actionId) % WORK_TICK_MS, 0)
})

test('WORLD asks SKILLS with the protocol’s tick: every attempt is WORK_TICK_MS (600 ms)', async () => {
  const seen = []
  const demo = createDemoSkillPolicy({ durationMs: WORK_TICK_MS })
  const s = setup({ skills: { ...demo, authorizeWorkAttempt: attempt => { seen.push(attempt.attemptMs); return demo.authorizeWorkAttempt(attempt) } } })
  const a = s.join('a', TREE.stands[0])
  await work(s.world, a.actor)
  assert.deepEqual(seen, [WORK_TICK_MS])
  assert.equal(WORK_TICK_MS, 600)
})
