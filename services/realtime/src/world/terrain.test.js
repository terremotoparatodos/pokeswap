import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS } from '../protocol/arrival.js'
import { decorAt, findSpawn, isSolidTile, isWaterTile } from './terrain.js'

test('the service finds the same Pradera spawn the arrival contract states', () => {
  const spawn = findSpawn(208, ['grassland'])
  assert.deepEqual(spawn, { tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty })
  assert.equal(isSolidTile(208, spawn.tx, spawn.ty), false)
  assert.equal(isWaterTile(208, spawn.tx, spawn.ty), false)
})

test('decor is a pure function of seed and tile', () => {
  for (let i = 0; i < 200; i++) assert.equal(decorAt(208, i - 100, -69), decorAt(208, i - 100, -69))
  // The landmark tree the professions demo documents next to the spawn.
  assert.equal(decorAt(208, -6, -64), 'tree')
})
