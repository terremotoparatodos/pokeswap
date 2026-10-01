import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS, arrivalFor } from '../protocol/arrival.js'
import { AREAS } from '../protocol/messages.js'
import { WORLD_AREAS } from './areas.js'
import { cavesIn } from './caves.js'
import { caveInterior, isCaveFloor } from './caveLayouts.js'
import { AREA_BOUNDS, PORTALS, PRADERA_RETURN_PAD, insideAreaBounds, isSafeLanding, isWalkable, portalAt, portalTo } from './navigation.js'
import { PLOTS } from './plots.js'
import { isSolidAtArea } from './resourceZones.js'
import { resourceAt } from './resourceLayout.js'
import { routeBetween } from './testing.js'
import { TOWN_GATES, TOWN_HEIGHT, TOWN_WIDTH, isTownWalkable } from './townLayout.js'
import { standableTile } from './workPlacement.js'

// CAVES-4: the one navigation answer for every shared area. Each expectation
// is derived from the sources it composes; the browser's parity tests prove
// its areas collide with exactly these tiles.

const CAVE = cavesIn('pradera')[0]
const INSIDE = caveInterior(CAVE.interiorAreaId)
const { seed } = WORLD_AREAS.pradera

test('isWalkable composes the three sources, tile for tile', () => {
  for (let ty = -2; ty < TOWN_HEIGHT + 2; ty++) {
    for (let tx = -2; tx < TOWN_WIDTH + 2; tx++) assert.equal(isWalkable('ciudad-corazon', tx, ty), isTownWalkable(tx, ty))
  }
  for (let ty = -2; ty < INSIDE.height + 2; ty++) {
    for (let tx = -2; tx < INSIDE.width + 2; tx++) assert.equal(isWalkable(INSIDE.id, tx, ty), isCaveFloor(INSIDE.id, tx, ty))
  }
  for (let ty = -100; ty < -40; ty++) {
    for (let tx = -40; tx < 20; tx++) assert.equal(isWalkable('pradera', tx, ty), !isSolidAtArea('pradera', seed, tx, ty))
  }
  // Trees, rocks and cave rock are solid; resource nodes are props, so never walkable.
  for (const t of CAVE.footprint) assert.equal(isWalkable('pradera', t.tx, t.ty), t.tx === CAVE.mouth.tx && t.ty === CAVE.mouth.ty)
})

test('nothing but integer tiles of a shared area is walkable', () => {
  for (const [tx, ty] of [[0.5, 0], [Number.NaN, 0], [Infinity, 0], [-Infinity, 0], [2 ** 60, 0], ['3', 3], [null, 0], [undefined, 0]]) {
    for (const areaId of AREAS) assert.equal(isWalkable(areaId, tx, ty), false, `${areaId} ${tx},${ty}`)
  }
  for (const areaId of ['tundra', 'costa', 'bosque', 'desierto', 'cueva-falsa', '', '__proto__', 'constructor']) {
    assert.equal(isWalkable(areaId, ARRIVALS.pradera.tx, ARRIVALS.pradera.ty), false, areaId)
  }
})

test('Pradera has a hard edge: past it everything is solid, inside it the terrain decides', () => {
  const b = AREA_BOUNDS.pradera
  assert.ok(insideAreaBounds('pradera', b.maxTx, b.maxTy) && insideAreaBounds('pradera', b.minTx, b.minTy))
  for (const [tx, ty] of [[b.maxTx + 1, 0], [b.minTx - 1, 0], [0, b.maxTy + 1], [0, b.minTy - 1]]) {
    assert.equal(insideAreaBounds('pradera', tx, ty), false)
    assert.equal(isWalkable('pradera', tx, ty), false, `${tx},${ty}`)
  }
  // Far from every authored place.
  for (const p of [ARRIVALS.pradera, CAVE.mouth, ...PLOTS]) assert.ok(Math.abs(p.tx) < 200 && Math.abs(p.ty) < 200)
  assert.equal(insideAreaBounds('ciudad-corazon', 10 ** 6, 0), true, 'bounded areas need no extra edge')
})

test('every portal: walkable, reachable from its area arrival, and landing never on a portal', () => {
  assert.deepEqual(PORTALS.filter(p => p.areaId === 'pradera').map(p => p.to).sort(), ['ciudad-corazon', 'cueva-inicial'])
  assert.deepEqual(PORTALS.filter(p => p.areaId === INSIDE.id).map(p => p.to), ['pradera'])
  assert.equal(PORTALS.filter(p => p.areaId === 'ciudad-corazon').length, TOWN_GATES.flatMap(g => g.tiles).length)
  for (const p of PORTALS) {
    assert.equal(portalAt(p.areaId, p.tx, p.ty), p.to)
    assert.ok(isWalkable(p.areaId, p.tx, p.ty), `${p.areaId} ${p.tx},${p.ty}`)
    assert.ok(routeBetween(p.areaId, ARRIVALS[p.areaId], p), `${p.areaId} → ${p.to} unreachable`)
    if (!AREAS.has(p.to)) continue
    const landing = arrivalFor(p.to, p.areaId)
    assert.ok(isSafeLanding(p.to, landing.tx, landing.ty), `${p.areaId} → ${p.to} lands on ${landing.tx},${landing.ty}`)
  }
  // Each shared area's own arrival is a safe landing too (first join, recall, repairs).
  for (const areaId of AREAS) assert.ok(isSafeLanding(areaId, ARRIVALS[areaId].tx, ARRIVALS[areaId].ty), areaId)
})

test('only the portal tile itself leads anywhere', () => {
  assert.equal(portalAt('pradera', PRADERA_RETURN_PAD.tx, PRADERA_RETURN_PAD.ty), 'ciudad-corazon')
  assert.equal(portalAt('pradera', CAVE.approach.tx, CAVE.approach.ty), null)
  assert.equal(portalAt('pradera', ARRIVALS.pradera.tx, ARRIVALS.pradera.ty), null)
  assert.equal(portalAt('ciudad-corazon', 7, 41), null)
  assert.equal(portalAt(INSIDE.id, INSIDE.arrival.tx, INSIDE.arrival.ty), null)
  // The same coordinates in another area are not that area's portal.
  assert.equal(portalAt('ciudad-corazon', CAVE.mouth.tx, CAVE.mouth.ty), null)
  assert.equal(portalAt('pradera', INSIDE.exit.tx, INSIDE.exit.ty), null)
  assert.deepEqual(portalTo('ciudad-corazon', 'pradera'), { areaId: 'ciudad-corazon', tx: 6, ty: 41, to: 'pradera' })
})

test('no worker or trainer stand is ever a portal: the cave mouth and the Pradera pad included', () => {
  const isOpen = standableTile('pradera')
  for (const p of PORTALS.filter(portal => portal.areaId === 'pradera')) assert.equal(isOpen(p.tx, p.ty), false, `${p.tx},${p.ty}`)
  // Its neighbours are judged on their own merits (the arrival is open ground).
  assert.equal(isOpen(ARRIVALS.pradera.tx, ARRIVALS.pradera.ty), true)
  // Areas the world does not model offer no stand at all, portals or not.
  assert.equal(standableTile('ciudad-corazon')(31, 20), false)
  assert.equal(standableTile(INSIDE.id)(INSIDE.arrival.tx, INSIDE.arrival.ty), false)
  assert.equal(resourceAt('pradera', PRADERA_RETURN_PAD.tx, PRADERA_RETURN_PAD.ty), null)
})
