import test from 'node:test'
import assert from 'node:assert/strict'
import { isRetained, isVisible, NEAR_RADIUS_TILES, RETAIN_MARGIN_TILES, TOWN_RADIUS_TILES, visibleActors } from './interest.js'

const actor = (id, areaId, tx, ty) => ({ id, areaId, tx, ty })

test('town interest includes the viewport margin and excludes actors beyond it', () => {
  const viewer = actor('viewer', 'ciudad-corazon', 31, 20)
  assert.equal(isVisible(viewer, actor('edge', 'ciudad-corazon', 31 + TOWN_RADIUS_TILES, 0)), true)
  assert.equal(isVisible(viewer, actor('outside', 'ciudad-corazon', 31 + TOWN_RADIUS_TILES + 1, 20)), false)
})

test('interest never crosses areas and snapshots omit the viewer', () => {
  const viewer = actor('viewer', 'ciudad-corazon', 31, 20)
  const same = actor('same', 'ciudad-corazon', 30, 20)
  const wild = actor('wild', 'pradera', 31, 20)
  assert.equal(isVisible(viewer, wild), false)
  assert.deepEqual(visibleActors(viewer, new Map([[viewer.id, viewer], [same.id, same], [wild.id, wild]])), [same])
})

test('wild interest keeps the existing one-sector margin', () => {
  const viewer = actor('viewer', 'pradera', 12, 12)
  assert.equal(isVisible(viewer, actor('near', 'pradera', 35, 35)), true)
  assert.equal(isVisible(viewer, actor('far', 'pradera', 36, 12)), false)
})

test('wild interest never drops an actor within the near radius, whatever the sectors', () => {
  // Viewer at the start of sector 1, actor at the end of sector -1: 13 tiles, two sectors apart.
  const viewer = actor('viewer', 'pradera', 12, 12)
  assert.equal(isVisible(viewer, actor('split', 'pradera', -1, 12)), true)
  assert.equal(isVisible(viewer, actor('edge', 'pradera', 12 - NEAR_RADIUS_TILES, 12)), true)
  assert.equal(isVisible(viewer, actor('beyond', 'pradera', 12 - NEAR_RADIUS_TILES - 1, 12)), false)
})

test('an actor already seen is kept until the retention margin, in town and in the wild', () => {
  const town = actor('viewer', 'ciudad-corazon', 31, 20)
  const leaving = actor('leaving', 'ciudad-corazon', 31 + TOWN_RADIUS_TILES + RETAIN_MARGIN_TILES, 20)
  assert.equal(isVisible(town, leaving), false)
  assert.equal(isRetained(town, leaving), true)
  assert.equal(isRetained(town, { ...leaving, tx: leaving.tx + 1 }), false)

  const wild = actor('viewer', 'pradera', 12, 12)
  const far = actor('far', 'pradera', 12 - NEAR_RADIUS_TILES - RETAIN_MARGIN_TILES, 12)
  const all = new Map([[far.id, far]])
  assert.deepEqual(visibleActors(wild, all), [])
  assert.deepEqual(visibleActors(wild, all, new Set([far.id])), [far])
  assert.equal(isRetained(wild, { ...far, areaId: 'ciudad-corazon' }), false)
})
