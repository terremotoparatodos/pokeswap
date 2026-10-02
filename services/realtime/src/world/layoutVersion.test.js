import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS } from '../protocol/arrival.js'
import { CAVE_INTERIORS } from './caveLayouts.js'
import { CANONICAL_NAVIGATION, PERSISTABLE_AREAS, isPersistableArea, layoutSource, layoutVersion, praderaFingerprintWindow, versionOf } from './layoutVersion.js'
import { isSafeLanding } from './navigation.js'

// WORLD LOCATION-2 (D-L8): one layout version per persistable area.
//
// FROZEN. If this test fails, the navigation of an area changed. That is
// allowed, but it is a product decision: every saved location in that area
// will restore at the area's arrival (WORLD_LOCATION_1_AUDIT §4.6). Update
// the expected value here in the same commit that changes the map, and say
// so in its message.
const FROZEN = Object.freeze({
  'ciudad-corazon': '1.f04b84e25e1a',
  pradera: '1.bbce2fd97f67',
  'cueva-inicial': '1.54820710979b',
})

test('the layout version of every persistable area is frozen', () => {
  assert.deepEqual(Object.fromEntries(PERSISTABLE_AREAS.map(area => [area, layoutVersion(area)])), FROZEN)
})

test('persistable areas: Ciudad, Pradera and every cave interior; nothing else (no Dungeon floor, no unknown area)', () => {
  assert.deepEqual([...PERSISTABLE_AREAS].sort(), ['ciudad-corazon', 'pradera', ...Object.keys(CAVE_INTERIORS)].sort())
  for (const areaId of ['tundra', 'dg:cueva-inicial:1', '', null, 42, '__proto__', 'constructor', 'Pradera']) {
    assert.equal(isPersistableArea(areaId), false, String(areaId))
    assert.equal(layoutVersion(areaId), null, String(areaId))
  }
  for (const areaId of PERSISTABLE_AREAS) assert.ok(isSafeLanding(areaId, ARRIVALS[areaId].tx, ARRIVALS[areaId].ty), `${areaId} arrival is a safe landing`)
})

test('a version fits the column (layout_version ~ ^[a-z0-9.-]{1,32}$) and is deterministic', () => {
  for (const areaId of PERSISTABLE_AREAS) {
    assert.match(layoutVersion(areaId), /^[a-z0-9.-]{1,32}$/)
    assert.equal(versionOf(layoutSource(areaId)), layoutVersion(areaId))
  }
})

test('the version follows the navigation: one tile that changes class changes it (each area)', () => {
  const probes = { 'ciudad-corazon': ARRIVALS['ciudad-corazon'], pradera: ARRIVALS.pradera, 'cueva-inicial': ARRIVALS['cueva-inicial'] }
  for (const [areaId, at] of Object.entries(probes)) {
    const blocked = { ...CANONICAL_NAVIGATION, isWalkable: (a, tx, ty) => !(a === areaId && tx === at.tx && ty === at.ty) && CANONICAL_NAVIGATION.isWalkable(a, tx, ty) }
    assert.notEqual(versionOf(layoutSource(areaId, blocked)), layoutVersion(areaId), `${areaId}: a solid arrival must change the version`)
    const pocket = { ...CANONICAL_NAVIGATION, isReachable: (a, tx, ty) => !(a === areaId && tx === at.tx && ty === at.ty) && CANONICAL_NAVIGATION.isReachable(a, tx, ty) }
    assert.notEqual(versionOf(layoutSource(areaId, pocket)), layoutVersion(areaId), `${areaId}: a fenced-off tile must change the version`)
  }
  // Pradera, far from every authored place: the sparse lattice still sees a change on a lattice point.
  const far = { ...CANONICAL_NAVIGATION, isWalkable: (a, tx, ty) => (a === 'pradera' && tx === 4032 && ty === 4032) ? !CANONICAL_NAVIGATION.isWalkable(a, tx, ty) : CANONICAL_NAVIGATION.isWalkable(a, tx, ty) }
  assert.notEqual(versionOf(layoutSource('pradera', far)), layoutVersion('pradera'))
})

test("Pradera's dense window covers the arrival, both zones and the cave, with a margin", () => {
  const w = praderaFingerprintWindow()
  assert.ok(w.maxTx - w.minTx >= 60 && w.maxTy - w.minTy >= 80, JSON.stringify(w))
  for (const t of [ARRIVALS.pradera, { tx: -19, ty: -54 }, { tx: 18, ty: -63 }, { tx: -14, ty: -91 }]) {
    assert.ok(t.tx > w.minTx && t.tx < w.maxTx && t.ty > w.minTy && t.ty < w.maxTy, `${t.tx},${t.ty}`)
  }
})

test('an area only changes its own version', () => {
  const caveOnly = { ...CANONICAL_NAVIGATION, isWalkable: (a, tx, ty) => a === 'cueva-inicial' ? false : CANONICAL_NAVIGATION.isWalkable(a, tx, ty) }
  assert.equal(versionOf(layoutSource('ciudad-corazon', caveOnly)), layoutVersion('ciudad-corazon'))
  assert.notEqual(versionOf(layoutSource('cueva-inicial', caveOnly)), layoutVersion('cueva-inicial'))
})
