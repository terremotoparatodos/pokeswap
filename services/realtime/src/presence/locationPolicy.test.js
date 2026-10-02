import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS, arrivalFor } from '../protocol/arrival.js'
import { CAVES } from '../world/caves.js'
import { caveInterior } from '../world/caveLayouts.js'
import { layoutVersion } from '../world/layoutVersion.js'
import { PRADERA_RETURN_PAD, isSafeLanding } from '../world/navigation.js'
import { praderaNodesNearSpawn } from '../world/testing.js'
import { WORLD_PROTOCOL } from '../world/worldProtocol.js'
import { dungeonAnchor, restoreFromRow, savedLocationOf } from './locationPolicy.js'

// WORLD LOCATION-2: what is saved, and how a stored location is validated
// (matrix cases 9, 12, 13, 26; decisions D-L6 to D-L9).

const CAVE = CAVES[0]
const INSIDE = caveInterior(CAVE.interiorAreaId)
const at = (areaId, tx, ty, version = layoutVersion(areaId)) => ({ areaId, tx, ty, layoutVersion: version })
const NEW = { worldProtocol: WORLD_PROTOCOL }

test('a valid stored tile restores exactly, facing down (D-L7)', () => {
  assert.deepEqual(restoreFromRow(at('pradera', CAVE.approach.tx, CAVE.approach.ty), NEW), { areaId: 'pradera', tx: CAVE.approach.tx, ty: CAVE.approach.ty, dir: 'down', repair: null })
  assert.deepEqual(restoreFromRow(at(INSIDE.id, 12, 8), NEW), { areaId: INSIDE.id, tx: 12, ty: 8, dir: 'down', repair: null })
  assert.deepEqual(restoreFromRow(at('ciudad-corazon', 31, 21), NEW), { areaId: 'ciudad-corazon', tx: 31, ty: 21, dir: 'down', repair: null })
  assert.equal(restoreFromRow(null, NEW), null, 'no stored location: the caller uses Ciudad')
})

test('unknown or retired area → Ciudad spawn (case 12)', () => {
  for (const areaId of ['tundra', 'cueva-retirada', 'dg:caliza-d1:3', 'constructor']) {
    assert.deepEqual(restoreFromRow(at(areaId, 1, 1, 'v'), NEW), { areaId: 'ciudad-corazon', tx: 31, ty: 20, dir: 'down', repair: 'area' })
  }
})

test('a different layout version → the area arrival, even on a tile that is still valid (case 13, D-L8)', () => {
  const valid = at('pradera', CAVE.approach.tx, CAVE.approach.ty, '1.000000000000')
  assert.ok(isSafeLanding('pradera', valid.tx, valid.ty))
  assert.deepEqual(restoreFromRow(valid, NEW), { areaId: 'pradera', tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty, dir: 'down', repair: 'layout' })
})

test('solid, unreachable, portal or off-edge tiles → the area arrival (case 9)', () => {
  const tree = praderaNodesNearSpawn()[0].node
  const cases = [
    at('pradera', tree.tx, tree.ty), // a node: solid
    at('pradera', PRADERA_RETURN_PAD.tx, PRADERA_RETURN_PAD.ty), // a portal: never crossed by restoring
    at('pradera', 5000, 0), // past the hard edge
    at(INSIDE.id, 0, 0), // cave rock
    at(INSIDE.id, INSIDE.exit.tx, INSIDE.exit.ty), // the exit pad
    at('ciudad-corazon', 0, 0), // town forest
  ]
  for (const location of cases) {
    const result = restoreFromRow(location, NEW)
    assert.equal(result.repair, 'tile', JSON.stringify(location))
    assert.deepEqual({ tx: result.tx, ty: result.ty, areaId: result.areaId }, { tx: ARRIVALS[location.areaId].tx, ty: ARRIVALS[location.areaId].ty, areaId: location.areaId })
    assert.ok(isSafeLanding(result.areaId, result.tx, result.ty))
  }
})

test('D-L6: a client older than CAVES-3 whose row is in a cave restores at the cave approach in Pradera (case 26)', () => {
  const inside = at(INSIDE.id, 12, 8)
  const approach = arrivalFor('pradera', INSIDE.id)
  for (const old of [{}, { worldProtocol: 2 }, { worldProtocol: '3' }, { worldProtocol: null }]) {
    assert.deepEqual(restoreFromRow(inside, old), { areaId: 'pradera', tx: approach.tx, ty: approach.ty, dir: 'down', repair: 'protocol' }, JSON.stringify(old))
  }
  // Outside a cave, an older client restores normally.
  assert.equal(restoreFromRow(at('pradera', CAVE.approach.tx, CAVE.approach.ty), { worldProtocol: 2 }).repair, null)
})

test('the saved location comes from the server actor; non-persistable areas save nothing', () => {
  assert.deepEqual(savedLocationOf({ areaId: 'pradera', tx: 3, ty: -60, moveSequence: 2 ** 53 }), { areaId: 'pradera', tx: 3, ty: -60, layoutVersion: layoutVersion('pradera') })
  for (const actor of [{ areaId: 'tundra', tx: 1, ty: 1 }, { areaId: 'pradera', tx: 1.5, ty: 1 }, null, { areaId: 'dg:unknown:1', tx: 1, ty: 1 }]) {
    assert.equal(savedLocationOf(actor), null, JSON.stringify(actor))
  }
})

test('D-L9: a Dungeon floor saves its exterior anchor (the cave approach), never the floor', () => {
  const registry = { 'caliza-d1': CAVE.id }
  const anchor = { areaId: CAVE.areaId, tx: CAVE.approach.tx, ty: CAVE.approach.ty }
  assert.deepEqual(dungeonAnchor('dg:caliza-d1:3', registry), anchor)
  assert.deepEqual(savedLocationOf({ areaId: 'dg:caliza-d1:5', tx: 40, ty: 40 }, registry), { ...anchor, layoutVersion: layoutVersion(CAVE.areaId) })
  for (const id of ['dg:caliza-d1:0', 'dg:other:1', 'dg:caliza-d1', 'xdg:caliza-d1:1', 'dg:Caliza:1']) assert.equal(dungeonAnchor(id, registry), null, id)
  assert.ok(isSafeLanding(anchor.areaId, anchor.tx, anchor.ty))
})
