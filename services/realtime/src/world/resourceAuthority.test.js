import test from 'node:test'
import assert from 'node:assert/strict'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { ResourceAuthority, SETTLE_RETRY_DELAYS_MS } from './resourceAuthority.js'
import { RESPAWN_MS, resourceAt, resourceById } from './resourceLayout.js'
import { manualClock, praderaNodesNearSpawn, settle } from './testing.js'

const [{ node: TREE, stands: [SPOT_A, SPOT_B] }] = praderaNodesNearSpawn()

function setup({ skills = createDemoSkillPolicy({ durationMs: 3_000 }), owned = { a: [25], b: [6] }, ownership = null } = {}) {
  const clock = manualClock()
  const actors = new Map([
    ['a', { id: 'a', areaId: 'pradera', ...SPOT_A }],
    ['b', { id: 'b', areaId: 'pradera', ...SPOT_B }],
  ])
  const nodes = []
  const results = []
  const done = []
  let ids = 0
  const authority = new ResourceAuthority({
    skills, ownership: ownership ?? createStaticOwnership(owned), lookupActor: id => actors.get(id) ?? null,
    now: clock.now, newActionId: () => `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`, sleep: async () => {},
    onNode: record => nodes.push(record), onResult: (playerId, result) => results.push({ playerId, ...result }), onDone: (playerId, event) => done.push({ playerId, ...event }),
  })
  return { authority, clock, actors, nodes, results, done, skills }
}

const intent = (requestId, pokemonInstanceId, nodeId = TREE.id) => ({ nodeId, pokemonInstanceId, requestId })

test('the layout gives every node one stable id that resolves back to itself', () => {
  assert.ok(TREE, 'a workable node exists near the Pradera spawn')
  assert.equal(resourceById(TREE.id)?.id, TREE.id)
  assert.deepEqual(resourceAt('pradera', TREE.tx, TREE.ty), TREE)
  // A forged id naming another variant or a tile with no node is not a node.
  assert.equal(resourceById(TREE.id.replace(/:[a-z]+$/, ':palm')), null)
  assert.equal(resourceById(`pradera:${SPOT_A.tx}:${SPOT_A.ty}:tree`), null)
  assert.equal(resourceById(`pradera:${TREE.tx}:${TREE.ty}:${TREE.variantId}x`), null)
  assert.equal(resourceById('ciudad-corazon:31:20:tree'), null)
})

test('A and B race for the same tree: exactly one reservation, a clean refusal for the other', async () => {
  const { authority, actors, nodes, results, skills } = setup()
  // Both intents are in flight before either await resolves.
  const [first, second] = await Promise.all([
    authority.requestWork(actors.get('a'), null, intent(1, 25)),
    authority.requestWork(actors.get('b'), null, intent(1, 6)),
  ])
  assert.equal(first.ok, true)
  assert.deepEqual({ ok: second.ok, reason: second.reason }, { ok: false, reason: 'busy' })
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].state, 'working')
  assert.equal(nodes[0].worker.playerId, 'a')
  assert.equal(results.filter(r => r.ok).length, 1)
  // The loser was authorized by SKILLS but never started: SKILLS is told so.
  assert.equal(skills.cancelled.length, 1)
  assert.equal(skills.cancelled[0].playerId, 'b')
  assert.equal(authority.metrics.authorizedNotStarted, 1)
})

test('B asking for a tree A is already working is refused', async () => {
  const { authority, actors } = setup()
  await authority.requestWork(actors.get('a'), null, intent(1, 25))
  const refused = await authority.requestWork(actors.get('b'), null, intent(1, 6))
  assert.equal(refused.reason, 'busy')
})

test('completion depletes once, settles once, and respawns at the world time', async () => {
  const { authority, clock, actors, nodes, done, skills } = setup()
  const started = await authority.requestWork(actors.get('a'), null, intent(1, 25))
  clock.advance(3_000)
  // Two completion callbacks for the same action: a duplicated timer and a direct call.
  const results = await Promise.all([authority.complete(started.actionId), authority.complete(started.actionId)])
  assert.deepEqual(results.sort(), [false, true])
  assert.equal(skills.grants, 1)
  assert.equal(done.filter(event => event.ok).length, 1)
  const depleted = nodes.at(-1)
  assert.equal(depleted.state, 'depleted')
  assert.equal(depleted.respawnAt, clock.now() + RESPAWN_MS.tree)
  // And the queue's own entry for the same completion is a no-op too.
  authority.tick()
  await settle()
  assert.equal(skills.grants, 1)
  // Depleted: nobody can start it.
  actors.get('b').tx = SPOT_B.tx
  assert.equal((await authority.requestWork(actors.get('b'), null, intent(2, 6))).reason, 'depleted')
  clock.advance(RESPAWN_MS.tree)
  authority.tick()
  assert.equal(nodes.at(-1).state, 'available')
  assert.ok(nodes.at(-1).version > depleted.version)
  assert.equal(authority.store.get(TREE.id), null, 'base state is not stored')
})

test('the queued completion fires on the tick at endsAt, not before', async () => {
  const { authority, clock, actors, skills } = setup()
  await authority.requestWork(actors.get('a'), null, intent(1, 25))
  clock.advance(2_999)
  authority.tick()
  await settle()
  assert.equal(skills.grants, 0)
  clock.advance(1)
  authority.tick()
  await settle()
  assert.equal(skills.grants, 1)
})

test('a far node and a Pokémon the player does not own are refused', async () => {
  const { authority, actors, skills } = setup()
  actors.get('a').tx += 5
  assert.equal((await authority.requestWork(actors.get('a'), null, intent(1, 25))).reason, 'too-far')
  actors.get('a').tx -= 5
  assert.equal((await authority.requestWork(actors.get('a'), null, intent(2, 6))).reason, 'not-owner')
  assert.equal(skills.authorized.length, 0, 'SKILLS is never asked about a Pokémon WORLD could not verify')
  actors.get('a').areaId = 'ciudad-corazon'
  assert.equal((await authority.requestWork(actors.get('a'), null, intent(3, 25))).reason, 'wrong-area')
})

test('a repeated request id is answered without a second reservation', async () => {
  const { authority, actors, nodes } = setup()
  const [first, again] = await Promise.all([
    authority.requestWork(actors.get('a'), null, intent(7, 25)),
    authority.requestWork(actors.get('a'), null, intent(7, 25)),
  ])
  assert.equal(first.ok, true)
  assert.equal(again.reason, 'duplicate-request')
  assert.equal(nodes.length, 1)
})

test('one action per player and per Pokémon', async () => {
  const [, { node: other, stands }] = praderaNodesNearSpawn()
  const { authority, actors } = setup({ owned: { a: [25, 26], b: [25] } })
  assert.equal((await authority.requestWork(actors.get('a'), null, intent(1, 25))).ok, true)
  actors.set('a2', { id: 'a', areaId: 'pradera', ...stands[0] })
  assert.equal((await authority.requestWork(actors.get('a2'), null, intent(2, 26, other.id))).reason, 'actor-busy')
  actors.set('b', { id: 'b', areaId: 'pradera', ...stands[0] })
  assert.equal((await authority.requestWork(actors.get('b'), null, intent(1, 25, other.id))).reason, 'pokemon-busy')
})

test('walking away cancels the action and gives the node back to everyone', async () => {
  const { authority, actors, nodes, skills, done } = setup()
  const started = await authority.requestWork(actors.get('a'), null, intent(1, 25))
  actors.get('a').tx += 3
  authority.reconcileActor(actors.get('a'))
  assert.equal(nodes.at(-1).state, 'available')
  assert.deepEqual(skills.cancelled.map(c => c.actionId), [started.actionId])
  assert.deepEqual(done.at(-1), { playerId: 'a', actionId: started.actionId, ok: false, reason: 'moved' })
  assert.equal(await authority.complete(started.actionId), false)
  assert.equal(skills.grants, 0)
})

test('SKILLS refusing an attempt leaves no trace on the node', async () => {
  const skills = createDemoSkillPolicy({ refuse: () => 'level' })
  const { authority, actors, nodes } = setup({ skills })
  assert.equal((await authority.requestWork(actors.get('a'), null, intent(1, 25))).reason, 'level')
  assert.equal(nodes.length, 0)
  assert.equal((await authority.requestWork(actors.get('b'), null, intent(1, 6))).reason, 'level', 'the claim was released')
})

test('a settlement that keeps failing never depletes the node', async () => {
  const skills = createDemoSkillPolicy({ failSettlements: SETTLE_RETRY_DELAYS_MS.length + 1 })
  const { authority, clock, actors, nodes, done } = setup({ skills })
  const started = await authority.requestWork(actors.get('a'), null, intent(1, 25))
  clock.advance(3_000)
  await authority.complete(started.actionId)
  assert.equal(nodes.at(-1).state, 'available')
  assert.equal(skills.grants, 0)
  assert.equal(done.at(-1).ok, false)
})

test('a transient settlement failure is retried with the same action id and grants once', async () => {
  const skills = createDemoSkillPolicy({ failSettlements: 2 })
  const { authority, clock, actors, nodes } = setup({ skills })
  const started = await authority.requestWork(actors.get('a'), null, intent(1, 25))
  clock.advance(3_000)
  await authority.complete(started.actionId)
  assert.equal(skills.grants, 1)
  assert.deepEqual([...skills.settled.keys()], [started.actionId])
  assert.equal(nodes.at(-1).state, 'depleted')
})

test('a duration from SKILLS is clamped, never trusted blindly', async () => {
  const skills = createDemoSkillPolicy({ durationMs: 10 })
  const { authority, actors } = setup({ skills })
  const started = await authority.requestWork(actors.get('a'), null, intent(1, 25))
  assert.equal(started.endsAt - started.startedAt, 500)
})

/** Ownership whose answer for `slowPlayer` waits until `release()` is called. */
function gatedOwnership(owned, slowPlayer) {
  let open
  const gate = new Promise(resolve => { open = resolve })
  const base = createStaticOwnership(owned)
  return { release: () => open(), async verify(playerId, instanceId) { if (playerId === slowPlayer) await gate; return base.verify(playerId, instanceId) } }
}

test('a request with someone else’s Pokémon, still in flight, never makes the node busy for a legitimate player', async () => {
  const ownership = gatedOwnership({ a: [25], b: [6] }, 'b')
  const { authority, actors, nodes } = setup({ ownership })
  const hostile = authority.requestWork(actors.get('b'), null, intent(1, 25)) // B does not own 25
  const legit = await authority.requestWork(actors.get('a'), null, intent(1, 25))
  assert.equal(legit.ok, true, 'A acquires the tree while B’s check is still pending')
  ownership.release()
  assert.equal((await hostile).reason, 'not-owner')
  assert.equal(nodes.length, 1)
  assert.equal(nodes[0].worker.playerId, 'a')
})

test('an attempt SKILLS is about to refuse never makes the node busy either', async () => {
  let open
  const gate = new Promise(resolve => { open = resolve })
  const base = createDemoSkillPolicy()
  const skills = { ...base, async authorizeWorkAttempt(attempt) { if (attempt.playerId === 'b') { await gate; return { ok: false, reason: 'level' } } return base.authorizeWorkAttempt(attempt) } }
  const { authority, actors } = setup({ skills })
  const refused = authority.requestWork(actors.get('b'), null, intent(1, 6))
  assert.equal((await authority.requestWork(actors.get('a'), null, intent(1, 25))).ok, true)
  open()
  assert.equal((await refused).reason, 'level')
})

test('one attempt in flight per player: a concurrent second one costs no ownership read', async () => {
  let reads = 0
  const base = createStaticOwnership({ a: [25] })
  const ownership = { async verify(...args) { reads++; return base.verify(...args) } }
  const { authority, actors } = setup({ ownership })
  const [first, second] = await Promise.all([
    authority.requestWork(actors.get('a'), null, intent(1, 25)),
    authority.requestWork(actors.get('a'), null, intent(2, 25)),
  ])
  assert.equal(first.ok, true)
  assert.equal(second.reason, 'in-flight')
  assert.equal(reads, 1)
})
