import test from 'node:test'
import assert from 'node:assert/strict'
import { ECO_PROTOCOL, ECO_TICK_MS, EcoPopulation, newEcoNamespace, serverRandom } from './ecoPopulation.js'
import { createDemoSkillPolicy } from './demoSkillPolicy.js'
import { createStaticOwnership } from './pokemonOwnership.js'
import { seededRandom } from './wildPopulation.js'
import { WildService } from './wildService.js'
import { worldDependencies } from './worldConfig.js'
import { WORLD_MESSAGE, WORLD_PROTOCOL } from './worldProtocol.js'
import { WorldRoom } from './worldRoom.js'
import { fakeClient, lastMessage, manualClock, messagesOf } from './testing.js'

// ECO-GAMEPLAY-1 (experimental): the admitted population as the server's authority, shared by every
// viewer of an area, with the server's clock and randomness; one wild system per process; a
// development-only test retirement that grants nothing.

const PRADERA = { tx: -5, ty: -69 }

function setup({ ecoExperiment = true, seed = 20261007 } = {}) {
  const clock = manualClock()
  const actors = new Map()
  const sockets = new Map()
  const logs = []
  const world = new WorldRoom({
    skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}), now: clock.now,
    lookupActor: id => actors.get(id) ?? null, clientForPlayer: id => sockets.get(id) ?? null,
    ecoExperiment, ecoRandom: seededRandom(seed), log: message => logs.push(message),
  })
  const join = (id, { areaId = 'pradera', eco = true, guest = false } = {}) => {
    const client = fakeClient(id)
    const actor = guest ? null : { id, areaId, tx: PRADERA.tx, ty: PRADERA.ty }
    if (actor) { actors.set(id, actor); sockets.set(id, client) }
    world.join(client, { worldProtocol: WORLD_PROTOCOL, ...(eco ? { ecoProtocol: ECO_PROTOCOL } : {}) }, guest ? { kind: 'guest' } : { kind: 'player', userId: id, token: null })
    world.snapshot(client, actor ?? { areaId, tx: PRADERA.tx, ty: PRADERA.ty })
    return { client, actor }
  }
  /** Advances the server clock in 1 s steps, ticking and flushing like the room does. */
  const run = (ms, until = () => false) => {
    for (let t = 0; t < ms; t += 1_000) {
      clock.advance(1_000)
      world.tick()
      world.flush()
      if (until()) return true
    }
    return false
  }
  return { world, clock, join, run, logs }
}

const ecoOf = client => lastMessage(client, WORLD_MESSAGE.ECO)?.eco ?? lastMessage(client, WORLD_MESSAGE.SNAPSHOT)?.eco

test('two clients see the same authoritative population, with several individuals of one species', () => {
  const { join, run } = setup()
  const a = join('eco-a')
  const b = join('eco-b')
  assert.equal(lastMessage(a.client, WORLD_MESSAGE.SNAPSHOT).eco.status, 'not-simulated', 'nobody was there yet')
  assert.ok(run(30_000, () => (ecoOf(a.client)?.encounters.length ?? 0) > 0), 'the area fills after its stagger')
  run(60_000)
  const seenA = ecoOf(a.client)
  const seenB = ecoOf(b.client)
  assert.equal(seenA.status, 'active')
  assert.deepEqual(seenB, seenA, 'the same list for everyone, at the same flush')
  const bySpecies = new Map()
  for (const e of seenA.encounters) bySpecies.set(e.speciesId, [...(bySpecies.get(e.speciesId) ?? []), e.id])
  assert.ok([...bySpecies.values()].some(ids => ids.length >= 2), 'several individuals of one species')
  assert.equal(new Set(seenA.encounters.map(e => e.id)).size, seenA.encounters.length, 'every individual has its own id')
  for (const e of seenA.encounters) {
    assert.deepEqual(Object.keys(e).sort(), ['groupId', 'id', 'speciesId', 'tx', 'ty'])
    assert.match(e.id, /^eco-[0-9a-z]+-[0-9a-f]{8}:pradera:[a-z0-9-]+:\d+:\d+$/, 'namespace, area, nest, generation, member: no species, no owner')
  }
  assert.ok(seenA.encounters.length <= 18, 'the provisional area maximum')
})

test('one wild system per process: in the experiment there is no hourly roster at all', () => {
  const eco = setup()
  assert.equal(eco.world.wild, null)
  assert.ok(eco.world.eco)
  const plain = setup({ ecoExperiment: false })
  assert.ok(plain.world.wild instanceof WildService)
  assert.equal(plain.world.eco, null)
  const c = plain.join('p', { eco: true })
  const snapshot = lastMessage(c.client, WORLD_MESSAGE.SNAPSHOT)
  assert.equal('eco' in snapshot, false, 'declaring the protocol does not turn the experiment on')
  assert.equal(snapshot.wildStatus, 'unavailable')
  plain.run(5_000)
  assert.deepEqual(messagesOf(c.client, WORLD_MESSAGE.ECO), [])
  assert.deepEqual(plain.world.ecoDevRetire(c.actor, { requestId: 1, encounterId: 'eco-x:pradera:n:1:0' }, c.client), { requestId: 1, encounterId: null, ok: false, reason: 'disabled' })
})

test('a client without the ECO protocol, on an experimental server, sees no population (fail closed) and never a roster', () => {
  const { join, run } = setup()
  const eco = join('eco-a')
  const old = join('old', { eco: false })
  run(40_000)
  const snapshot = lastMessage(old.client, WORLD_MESSAGE.SNAPSHOT)
  assert.equal(snapshot.wildStatus, 'unavailable')
  assert.equal('eco' in snapshot, false)
  assert.equal('wild' in snapshot, false)
  assert.deepEqual(messagesOf(old.client, WORLD_MESSAGE.ECO), [])
  assert.deepEqual(messagesOf(old.client, WORLD_MESSAGE.WILD), [])
  assert.ok(ecoOf(eco.client).encounters.length > 0)
})

test('a test retirement removes the encounter for both clients; the nest respawns after its provisional delay', () => {
  const { world, join, run } = setup()
  const a = join('eco-a')
  const b = join('eco-b')
  run(60_000)
  const target = ecoOf(a.client).encounters[0]
  const group = ecoOf(a.client).encounters.filter(e => e.groupId === target.groupId)
  for (const [i, member] of group.entries()) {
    // Anything but the id is ignored: the server fixes the cause, and nothing is granted.
    const reply = world.ecoDevRetire(a.actor, { requestId: i + 1, encounterId: member.id, cause: 'captured', reward: 999 }, a.client)
    assert.deepEqual(reply, { requestId: i + 1, encounterId: member.id, ok: true })
  }
  assert.deepEqual(lastMessage(a.client, WORLD_MESSAGE.ECO_DEV_RETIRE_RESULT), { requestId: group.length, encounterId: group.at(-1).id, ok: true })
  world.flush()
  for (const client of [a.client, b.client]) assert.ok(ecoOf(client).encounters.every(e => e.groupId !== target.groupId), 'gone for everyone')
  assert.deepEqual(world.ecoDevRetire(a.actor, { requestId: 9, encounterId: target.id }, a.client).reason, 'not-alive', 'twice is a no-op')
  const [ns, area, nest, generation] = target.groupId.split(':')
  const respawned = () => ecoOf(b.client).encounters.some(e => e.id.startsWith(`${ns}:${area}:${nest}:`) && Number(e.id.split(':')[3]) > Number(generation))
  assert.equal(respawned(), false)
  assert.ok(run(200_000, respawned), 'a new generation in the same nest, within delay + jitter + retries')
  assert.deepEqual(ecoOf(a.client), ecoOf(b.client))
})

test('test retirements are refused to guests, from another area, with invalid payloads, and when not admitted', () => {
  const { world, join, run } = setup()
  const a = join('eco-a')
  const guest = join('guest', { guest: true })
  const elsewhere = join('town', { areaId: 'ciudad-corazon' })
  run(60_000)
  const id = ecoOf(a.client).encounters[0].id
  assert.equal(world.ecoDevRetire(null, { requestId: 1, encounterId: id }, guest.client).reason, 'not-player')
  assert.equal(world.ecoDevRetire(elsewhere.actor, { requestId: 1, encounterId: id }, elsewhere.client).reason, 'other-area')
  assert.equal(world.ecoDevRetire(a.actor, { requestId: 1, encounterId: 'not an id' }, a.client).reason, 'invalid')
  assert.equal(world.ecoDevRetire(a.actor, { requestId: 0, encounterId: id }, a.client).reason, 'invalid')
  assert.equal(world.ecoDevRetire(a.actor, { requestId: 1, encounterId: id.replace(/^eco-[^:]+/, 'eco-other') }, a.client).reason, 'not-alive')
  assert.equal(world.ecoDevRetire(a.actor, { requestId: 1, encounterId: id }, fakeClient('unknown')).reason, 'client-outdated')
  assert.ok(ecoOf(a.client).encounters.some(e => e.id === id), 'still alive after every refusal')
  const refused = new EcoPopulation({ now: () => 1, devRetire: false })
  assert.equal(refused.devRetire({ areaId: 'pradera' }, id).reason, 'disabled')
})

test('an area nobody views stops being simulated; returning refills it', () => {
  const { world, join, run } = setup()
  const a = join('eco-a')
  run(60_000)
  assert.ok(ecoOf(a.client).encounters.length > 0)
  world.leave(a.client)
  run(5 * 60_000 + 10_000)
  assert.deepEqual(world.eco.view('pradera'), { protocol: ECO_PROTOCOL, areaId: 'pradera', status: 'not-simulated', encounters: [] })
  const back = join('eco-b')
  assert.ok(run(30_000, () => (ecoOf(back.client)?.encounters.length ?? 0) > 0))
})

test('fail closed: without admission there is no population, and the log carries codes only', () => {
  const logs = []
  const eco = new EcoPopulation({ now: () => 1, layouts: () => '1.000000000000', log: message => logs.push(message) })
  assert.equal(eco.status, 'unavailable')
  assert.deepEqual(eco.view('pradera'), { protocol: ECO_PROTOCOL, areaId: 'pradera', status: 'unavailable', encounters: [] })
  eco.tick(10_000, new Set(['pradera']))
  assert.equal(eco.view('pradera').encounters.length, 0)
  assert.equal(eco.devRetire({ areaId: 'pradera' }, 'eco-x:pradera:n:1:0').reason, 'disabled')
  assert.match(logs.join('\n'), /not admitted \(layout-mismatch\)/)
  assert.doesNotMatch(logs.join('\n'), /1\.000000000000/)
})

test('server clock, server randomness and a fresh namespace per process', () => {
  for (let i = 0; i < 1_000; i++) { const r = serverRandom(); assert.ok(r >= 0 && r < 1) }
  const a = newEcoNamespace(1_791_000_000_000)
  const b = newEcoNamespace(1_791_000_000_000)
  assert.match(a, /^eco-[0-9a-z]+-[0-9a-f]{8}$/)
  assert.notEqual(a, b)
  let ticks = 0
  const eco = new EcoPopulation({ now: () => 0 })
  const original = eco.population.tick
  eco.population = { ...eco.population, tick: input => { ticks++; return original(input) } }
  eco.tick(1_000, new Set(['pradera']))
  eco.tick(1_000 + ECO_TICK_MS - 1, new Set(['pradera']))
  eco.tick(1_000 + ECO_TICK_MS, new Set(['pradera']))
  assert.equal(ticks, 2, `at most one population tick per ${ECO_TICK_MS} ms`)
})

test('the experiment is development-only: refused with NODE_ENV=production', () => {
  assert.throws(() => worldDependencies({ NODE_ENV: 'production', WORLD_ECO_EXPERIMENT: 'on' }), /development-only/)
  assert.equal(worldDependencies({ NODE_ENV: 'development', WORLD_ECO_EXPERIMENT: 'on' }).ecoExperiment, true)
  assert.equal(worldDependencies({ NODE_ENV: 'development' }).ecoExperiment, false)
  assert.equal(worldDependencies({ NODE_ENV: 'production' }).ecoExperiment, false)
})

test('the real path, with the server\'s own randomness (no seed injected), populates the area', () => {
  const clock = manualClock()
  const world = new WorldRoom({
    skills: createDemoSkillPolicy({ durationMs: 3_000 }), ownership: createStaticOwnership({}), now: clock.now,
    lookupActor: () => null, clientForPlayer: () => null, ecoExperiment: true, log: () => {},
  })
  const client = fakeClient('observer')
  world.join(client, { worldProtocol: WORLD_PROTOCOL, ecoProtocol: ECO_PROTOCOL }, { kind: 'guest' })
  world.snapshot(client, { areaId: 'pradera', ...PRADERA })
  for (let t = 0; t < 30_000 && !(ecoOf(client)?.encounters.length > 0); t += 1_000) { clock.advance(1_000); world.tick(); world.flush() }
  assert.ok(ecoOf(client).encounters.length > 0)
})
