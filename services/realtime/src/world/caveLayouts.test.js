import test from 'node:test'
import assert from 'node:assert/strict'
import { ARRIVALS, arrivalFor } from '../protocol/arrival.js'
import { CAVES, caveByInterior } from './caves.js'
import { CAVE_INTERIORS, caveInterior, isCaveExit, isCaveFloor, isCaveInterior } from './caveLayouts.js'

// CAVES-3: the interior of a cave is authored data, shared by the browser and
// the service. These guards hold for every interior, not just the first one.

const SIDES = [[0, -1], [0, 1], [-1, 0], [1, 0]]
const k = t => `${t.tx},${t.ty}`

function reachable(interior, from) {
  const seen = new Set([k(from)])
  const queue = [from]
  while (queue.length) {
    const at = queue.shift()
    for (const [dx, dy] of SIDES) {
      const next = { tx: at.tx + dx, ty: at.ty + dy }
      if (seen.has(k(next)) || !isCaveFloor(interior.id, next.tx, next.ty)) continue
      seen.add(k(next)); queue.push(next)
    }
  }
  return seen
}

test('every cave mouth leads to exactly one authored interior, and every interior to exactly one cave', () => {
  assert.deepEqual(Object.keys(CAVE_INTERIORS), CAVES.map(cave => cave.interiorAreaId))
  for (const cave of CAVES) {
    assert.equal(isCaveInterior(cave.interiorAreaId), true)
    assert.equal(caveByInterior(cave.interiorAreaId), cave)
  }
  assert.equal(caveInterior('pradera'), null)
  assert.equal(caveInterior('ciudad-corazon'), null)
  assert.equal(caveInterior('__proto__'), null)
})

test('the first interior: cueva-inicial, 21×15, arrival (10,11) facing in, exit (10,13)', () => {
  const interior = caveInterior('cueva-inicial')
  assert.equal(interior.width, 21)
  assert.equal(interior.height, 15)
  assert.deepEqual({ ...interior.arrival }, { tx: 10, ty: 11, dir: 'up' })
  assert.deepEqual({ ...interior.exit }, { tx: 10, ty: 13 })
})

for (const interior of Object.values(CAVE_INTERIORS)) {
  test(`${interior.id}: closed by rock on every edge, and nothing outside the grid is floor`, () => {
    for (let tx = -1; tx <= interior.width; tx++) {
      for (const ty of [-1, 0, interior.height - 1, interior.height]) assert.equal(isCaveFloor(interior.id, tx, ty), false, `${tx},${ty}`)
    }
    for (let ty = -1; ty <= interior.height; ty++) {
      for (const tx of [-1, 0, interior.width - 1, interior.width]) assert.equal(isCaveFloor(interior.id, tx, ty), false, `${tx},${ty}`)
    }
    assert.equal(isCaveFloor(interior.id, 1.5, 2), false)
    assert.equal(isCaveFloor(interior.id, NaN, 2), false)
  })

  test(`${interior.id}: only rock and floor, no node, plot, chest or spawn mark`, () => {
    for (const row of interior.rows) assert.match(row, /^[#.SE]+$/)
    const marks = interior.rows.join('')
    assert.equal(marks.split('S').length - 1, 1, 'one arrival')
    assert.equal(marks.split('E').length - 1, 1, 'one exit')
  })

  test(`${interior.id}: arrival and exit are floor, distinct and not adjacent to each other`, () => {
    const { arrival, exit } = interior
    assert.equal(isCaveFloor(interior.id, arrival.tx, arrival.ty), true)
    assert.equal(isCaveFloor(interior.id, exit.tx, exit.ty), true)
    assert.equal(isCaveExit(interior.id, exit.tx, exit.ty), true)
    assert.equal(isCaveExit(interior.id, arrival.tx, arrival.ty), false)
    // Arriving never lands on (or next to) the trigger: the exit takes a deliberate step.
    assert.ok(Math.abs(arrival.tx - exit.tx) + Math.abs(arrival.ty - exit.ty) >= 2)
  })

  test(`${interior.id}: the exit and every floor tile are reachable from the arrival`, () => {
    const reach = reachable(interior, interior.arrival)
    assert.ok(reach.has(k(interior.exit)))
    let floor = 0
    for (let ty = 0; ty < interior.height; ty++) for (let tx = 0; tx < interior.width; tx++) {
      if (!isCaveFloor(interior.id, tx, ty)) continue
      floor++
      assert.ok(reach.has(`${tx},${ty}`), `${tx},${ty} reachable`)
    }
    assert.ok(floor >= 100, 'a cave, not a corridor')
  })

  test(`${interior.id}: every passage is at least 3 tiles wide`, () => {
    // A floor tile whose open run is narrower than 3 in both axes is a bottleneck.
    const run = (tx, ty, dx, dy) => {
      let n = 1
      for (let s = 1; isCaveFloor(interior.id, tx + dx * s, ty + dy * s); s++) n++
      for (let s = 1; isCaveFloor(interior.id, tx - dx * s, ty - dy * s); s++) n++
      return n
    }
    for (let ty = 0; ty < interior.height; ty++) for (let tx = 0; tx < interior.width; tx++) {
      if (!isCaveFloor(interior.id, tx, ty)) continue
      assert.ok(run(tx, ty, 1, 0) >= 3 || run(tx, ty, 0, 1) >= 3, `${tx},${ty} too narrow`)
    }
  })

  test(`${interior.id}: arrivals agree with the presence protocol both ways`, () => {
    const cave = caveByInterior(interior.id)
    // In: the interior's S tile, whatever area the request names as its origin.
    assert.deepEqual({ ...arrivalFor(interior.id, cave.areaId) }, { ...interior.arrival })
    assert.deepEqual({ ...ARRIVALS[interior.id] }, { ...interior.arrival })
    // Out: the approach in front of the mouth, never the mouth (no loop) and never rock.
    const out = arrivalFor(cave.areaId, interior.id)
    assert.deepEqual({ tx: out.tx, ty: out.ty }, { ...cave.approach })
    assert.notDeepEqual({ tx: out.tx, ty: out.ty }, { ...cave.mouth })
    assert.ok(!cave.footprint.some(t => t.tx === out.tx && t.ty === out.ty))
  })
}
