import test from 'node:test'
import assert from 'node:assert/strict'
import { PLOTS, farmActionFor, nextPlotChange, plotAfterWork, plotById, plotStageAt } from './plots.js'
import { resourceAt, resourceById } from './resourceLayout.js'
import { T, isSolidTile, isWaterTile, tileTerrain } from './terrain.js'
import { WORLD_AREAS } from './areas.js'

test('every plot is on open grass, never on a node, the pad or water, with room to stand beside it', () => {
  const { seed, spawn } = WORLD_AREAS.pradera
  for (const plot of PLOTS) {
    assert.equal(plotById(plot.id), plot)
    assert.equal(resourceById(plot.id), null, 'a plot id is never a resource node id')
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const tx = plot.tx + dx
      const ty = plot.ty + dy
      assert.equal(isSolidTile(seed, tx, ty) || isWaterTile(seed, tx, ty) || resourceAt('pradera', tx, ty) !== null, false, `${tx},${ty}`)
      assert.notEqual(tileTerrain(seed, tx, ty), T.TALL)
    }
    assert.ok(Math.abs(plot.tx - spawn.tx) + Math.abs(plot.ty - spawn.ty) <= 8, 'early game: next to the arrival')
    assert.notDeepEqual([plot.tx, plot.ty], [spawn.tx, spawn.ty - 1], 'not the return pad')
  }
})

test('a plot grows by server timestamps alone', () => {
  const data = plotAfterWork('plant', null, { now: 1000, playerId: 'a', cropId: 'oran', growMs: 90_000 })
  assert.deepEqual(data, { cropId: 'oran', ownerId: 'a', plantedAt: 1000, growingAt: 46_000, readyAt: 91_000, tended: false })
  assert.equal(plotStageAt(data, 1000), 'planted')
  assert.equal(plotStageAt(data, 46_000), 'growing')
  assert.equal(plotStageAt(data, 91_000), 'ready')
  assert.equal(nextPlotChange(data, 1000), 46_000)
  assert.equal(nextPlotChange(data, 50_000), 91_000)
  assert.equal(nextPlotChange(data, 91_000), null)
})

test('who may do what on a plot (physically)', () => {
  const data = { ownerId: 'a', tended: false }
  assert.deepEqual(farmActionFor('empty', null, 'b'), { action: 'plant' })
  assert.deepEqual(farmActionFor('planted', data, 'a'), { action: 'tend' })
  assert.deepEqual(farmActionFor('growing', { ...data, tended: true }, 'a'), { reason: 'already-tended' })
  assert.deepEqual(farmActionFor('ready', data, 'b'), { reason: 'not-your-plot' })
  assert.deepEqual(farmActionFor('ready', data, 'a'), { action: 'harvest' })
})
