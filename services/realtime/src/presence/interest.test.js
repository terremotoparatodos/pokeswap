import test from 'node:test'
import assert from 'node:assert/strict'
import { isVisible, TOWN_RADIUS_TILES, visibleActors } from './interest.js'

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
