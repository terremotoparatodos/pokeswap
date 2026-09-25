import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLD_AREAS } from './areas.js'
import { buildPatrol, samplePatrol } from './patrol.js'
import { isSolidTile, isWaterTile } from './terrain.js'
import { WILD_ROTATE_MS, fitsBiome, wildEpoch, wildRoster } from './wildPopulation.js'
import { WildService, createStaticWildCatalog, syntheticWildCatalog } from './wildService.js'
import { biomeAt } from './terrain.js'

const { seed, spawn } = WORLD_AREAS.pradera
const catalog = Array.from({ length: 151 }, (_, i) => ({ id: i + 1, type1: ['normal', 'grass', 'bug', 'water', 'electric'][i % 5], type2: null, is_legendary: false, base_aura: 100 }))
const walkable = (tx, ty) => !isSolidTile(seed, tx, ty) && !isWaterTile(seed, tx, ty)

test('the roster is a pure function of area and hour: every client meets the same Pokémon in the same place', () => {
  const a = wildRoster({ areaId: 'pradera', seed, spawn, epoch: 490_000, catalog, ownedIds: new Set() })
  const b = wildRoster({ areaId: 'pradera', seed, spawn, epoch: 490_000, catalog, ownedIds: new Set() })
  assert.deepEqual(a, b)
  assert.ok(a.entities.length >= 20)
  const next = wildRoster({ areaId: 'pradera', seed, spawn, epoch: 490_001, catalog, ownedIds: new Set() })
  assert.notDeepEqual(next.entities.map(e => e.pokemonId), a.entities.map(e => e.pokemonId))
})

test('each wild Pokémon exists once, is unowned, and lives on a tile of its type', () => {
  const owned = new Set([1, 2, 3, 4, 5])
  const roster = wildRoster({ areaId: 'pradera', seed, spawn, epoch: 490_000, catalog, ownedIds: owned })
  const ids = roster.entities.map(e => e.pokemonId)
  assert.equal(new Set(ids).size, ids.length)
  for (const entity of roster.entities) {
    assert.equal(owned.has(entity.pokemonId), false)
    assert.equal(isSolidTile(seed, entity.tx, entity.ty), false)
    const water = isWaterTile(seed, entity.tx, entity.ty)
    assert.equal(entity.habitat, water ? 'water' : 'land')
    assert.ok(fitsBiome(water ? 'ocean' : biomeAt(seed, entity.tx + 0.5, entity.ty + 0.5), catalog[entity.pokemonId - 1]))
  }
})

test('a patrol is the same loop for everyone, never leaves walkable ground and closes at home', () => {
  const home = { tx: spawn.tx + 3, ty: spawn.ty + 2 }
  const patrol = buildPatrol({ key: 'wild:pradera:1:25', home, walkable, speed: 3 })
  assert.deepEqual(buildPatrol({ key: 'wild:pradera:1:25', home, walkable, speed: 3 }), patrol)
  let last = null
  for (const beat of patrol.beats) {
    assert.ok(walkable(beat.tx, beat.ty) || (beat.tx === home.tx && beat.ty === home.ty))
    assert.ok(Math.abs(beat.tx - beat.fromTx) + Math.abs(beat.ty - beat.fromTy) <= 1)
    if (last) assert.deepEqual([beat.fromTx, beat.fromTy], [last.tx, last.ty])
    last = beat
  }
  assert.deepEqual([last.tx, last.ty], [home.tx, home.ty])
  // Sampling is periodic and continuous: t and t + period are the same pose.
  const t = 1_727_000_000_123
  assert.deepEqual(samplePatrol(patrol, t), samplePatrol(patrol, t + patrol.periodMs))
})

test('different keys wander differently', () => {
  const home = { tx: spawn.tx + 3, ty: spawn.ty + 2 }
  const a = buildPatrol({ key: 'a', home, walkable, speed: 3 })
  const b = buildPatrol({ key: 'b', home, walkable, speed: 3 })
  assert.notDeepEqual(a.beats, b.beats)
})

test('the wild service reads the catalog once per hour and retries a failure later', async () => {
  let now = 490_000 * WILD_ROTATE_MS + 10
  let loads = 0
  let fail = true
  const rosters = []
  const service = new WildService({
    catalog: { async load() { loads++; if (fail) throw new Error('down'); return createStaticWildCatalog(catalog).load() } },
    now: () => now, onRoster: roster => rosters.push(roster),
  })
  service.tick(); await new Promise(r => setImmediate(r))
  assert.equal(service.roster('pradera'), null)
  service.tick(); await new Promise(r => setImmediate(r))
  assert.equal(loads, 1, 'no retry before the back-off')
  fail = false
  now += 60_000
  service.tick(); await new Promise(r => setImmediate(r))
  assert.equal(rosters.length, 1)
  for (let i = 0; i < 10; i++) { now += 1_000; service.tick() }
  await new Promise(r => setImmediate(r))
  assert.equal(loads, 2)
  now = (wildEpoch(now) + 1) * WILD_ROTATE_MS
  service.tick(); await new Promise(r => setImmediate(r))
  assert.equal(loads, 3)
  assert.equal(service.roster('pradera').epoch, wildEpoch(now))
})

test('the synthetic catalog places a full roster for local stacks', async () => {
  const { pokemon, ownedIds } = await syntheticWildCatalog().load()
  const roster = wildRoster({ areaId: 'pradera', seed, spawn, epoch: 1, catalog: pokemon, ownedIds })
  assert.ok(roster.entities.length >= 15)
})

test('no roster, no wild Pokémon: an unreadable catalog fails closed and says why, once', async () => {
  const { WorldRoom } = await import('./worldRoom.js')
  const { fakeClient, lastMessage } = await import('./testing.js')
  const { WORLD_MESSAGE } = await import('./worldProtocol.js')
  const logs = []
  const unavailable = []
  let now = 490_000 * WILD_ROTATE_MS
  const service = new WildService({ catalog: { async load() { throw new Error('catalog 401') } }, now: () => now, onUnavailable: id => unavailable.push(id), log: line => logs.push(line) })
  assert.equal(service.status('pradera'), 'loading')
  service.tick(); await new Promise(r => setImmediate(r))
  assert.equal(service.status('pradera'), 'unavailable')
  assert.equal(service.roster('pradera'), null)
  assert.deepEqual(unavailable, ['pradera'])
  now += 60_000
  service.tick(); await new Promise(r => setImmediate(r))
  assert.equal(logs.length, 1, 'one log line per failure streak, not per retry')
  assert.match(logs[0], /catalog 401/)

  // Through the room: viewers of Pradera are told, in the snapshot and live.
  let roomNow = 490_000 * WILD_ROTATE_MS
  const room = new WorldRoom({ skills: {}, ownership: {}, catalog: { async load() { throw new Error('catalog 503') } }, now: () => roomNow, lookupActor: () => null, clientForPlayer: () => null })
  room.wild.log = () => {}
  const viewer = fakeClient('v')
  room.join(viewer, { worldProtocol: 1 }, { kind: 'guest' })
  room.snapshot(viewer, { areaId: 'pradera', tx: -5, ty: -69 })
  assert.equal(lastMessage(viewer, WORLD_MESSAGE.SNAPSHOT).wildStatus, 'loading')
  room.tick(); await new Promise(r => setImmediate(r))
  assert.deepEqual(lastMessage(viewer, WORLD_MESSAGE.WILD), { now: roomNow, wild: null, status: 'unavailable' })
  room.snapshot(viewer, { areaId: 'pradera', tx: -5, ty: -69 })
  const snapshot = lastMessage(viewer, WORLD_MESSAGE.SNAPSHOT)
  assert.equal(snapshot.wildStatus, 'unavailable')
  assert.equal(snapshot.wild, undefined)
  room.snapshot(viewer, { areaId: 'ciudad-corazon', tx: 31, ty: 20 })
  assert.equal('wildStatus' in lastMessage(viewer, WORLD_MESSAGE.SNAPSHOT), false)
})

test('rollWildPool keeps the legacy weighting exactly (moved from the browser)', async () => {
  const { rollWildPool } = await import('./wildPopulation.js')
  const entry = (id, legendary = false, aura = 0) => ({ id, is_legendary: legendary, base_aura: aura })
  const values = [0, 0, 0.02, 0, 0.14, 0, 0.14, 0]
  assert.deepEqual(rollWildPool([entry(1, true), entry(2, false, 250), entry(3), entry(4)], new Set(), () => values.shift(), 4), [1, 2, 3, 4])
  assert.deepEqual(rollWildPool([entry(1), entry(2)], new Set(), () => 0, 25), [1, 2])
  assert.deepEqual(rollWildPool([entry(1), entry(2), entry(3)], new Set([2]), () => 0.9, 3), [3, 1])
})
