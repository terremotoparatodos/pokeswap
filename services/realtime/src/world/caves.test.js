import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLD_AREAS } from './areas.js'
import { CAVES, CAVE_CLEARANCE, CAVE_ENTRANCE, cavesIn, isCaveMouth, isCaveReserved, isCaveRock } from './caves.js'
import { PLOTS } from './plots.js'
import { resourceAt } from './resourceLayout.js'
import { AUTHORED_DECOR } from './resourceZoneLayout.js'
import { RESERVED_AREAS, RESOURCE_ZONES, ROUTES, decorAtArea, isPlannedTile, isSolidAtArea } from './resourceZones.js'
import { isWaterTile } from './terrain.js'
import { WILD_CHUNK_TILES, WILD_HOME_RADIUS_CHUNKS, wildSpawnTiles } from './wildPopulation.js'
import { standableTile, workPlacement } from './workPlacement.js'

// CAVES-2: the guards of the canonical caves. Every expectation is derived
// from `CAVES` and the real Pradera layer; the only literal is the decision
// itself (one public cave, anchored at -26,-74).

const { seed, spawn } = WORLD_AREAS.pradera
const PORTAL = { tx: spawn.tx, ty: spawn.ty - 1 }
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const R = 64
const k = t => `${t.tx},${t.ty}`
const solid = (tx, ty) => isSolidAtArea('pradera', seed, tx, ty)
const reserveOf = cave => [...cave.footprint, ...cave.clearance]

function reachFromArrival() {
  const seen = new Set([k(spawn)])
  const queue = [spawn]
  while (queue.length) {
    const at = queue.shift()
    for (const [dx, dy] of SIDES) {
      const tx = at.tx + dx, ty = at.ty + dy
      if (Math.abs(tx - spawn.tx) > R || Math.abs(ty - spawn.ty) > R) continue
      if (solid(tx, ty) || isWaterTile(seed, tx, ty) || (tx === PORTAL.tx && ty === PORTAL.ty) || seen.has(`${tx},${ty}`)) continue
      seen.add(`${tx},${ty}`); queue.push({ tx, ty })
    }
  }
  return seen
}

test('ids are unique and stable strings; interiors are unique too', () => {
  assert.equal(new Set(CAVES.map(cave => cave.id)).size, CAVES.length)
  assert.equal(new Set(CAVES.map(cave => cave.interiorAreaId)).size, CAVES.length)
  for (const cave of CAVES) {
    assert.match(cave.id, /^[a-z0-9-]+$/)
    assert.ok(!/-?\d+:-?\d+/.test(cave.id), 'an id names the place, never its coordinates')
    assert.ok(Object.isFrozen(cave) && Object.isFrozen(cave.footprint) && Object.isFrozen(cave.clearance))
  }
})

test('exactly one public cave: Pradera at (-26,-74), open since CAVES-3, leading to cueva-inicial', () => {
  assert.equal(CAVES.length, 1)
  assert.deepEqual(CAVES.map(cave => cave.areaId), ['pradera'])
  const [cave] = cavesIn('pradera')
  assert.deepEqual({ ...cave.anchor }, { tx: -26, ty: -74 })
  assert.equal(cave.entrance, CAVE_ENTRANCE.OPEN)
  assert.equal(cave.interiorAreaId, 'cueva-inicial')
  for (const areaId of ['ciudad-corazon', 'bosque', 'desierto', 'tundra', 'costa']) assert.equal(cavesIn(areaId).length, 0, areaId)
})

test('geometry: the footprint, mouth, approach and clearance follow from anchor, size and facing', () => {
  for (const cave of CAVES) {
    assert.equal(cave.facing, 'down')
    assert.equal(cave.footprint.length, cave.width * cave.depth)
    assert.equal(new Set(cave.footprint.map(k)).size, cave.footprint.length)
    const xs = cave.footprint.map(t => t.tx), ys = cave.footprint.map(t => t.ty)
    assert.deepEqual([Math.min(...xs), Math.max(...xs)], [cave.anchor.tx, cave.anchor.tx + cave.width - 1])
    assert.deepEqual([Math.min(...ys), Math.max(...ys)], [cave.anchor.ty - cave.depth + 1, cave.anchor.ty])
    // The mouth is the middle of the front row; the approach is right in front of it.
    assert.deepEqual({ ...cave.mouth }, { tx: cave.anchor.tx + Math.floor(cave.width / 2), ty: cave.anchor.ty })
    assert.deepEqual({ ...cave.approach }, { tx: cave.mouth.tx, ty: cave.mouth.ty + 1 })
    assert.ok(cave.footprint.some(t => t.tx === cave.mouth.tx && t.ty === cave.mouth.ty))
    // The clearance is 3×3, starts at the approach and never overlaps the rock.
    assert.equal(cave.clearance.length, CAVE_CLEARANCE.width * CAVE_CLEARANCE.depth)
    assert.ok(cave.clearance.some(t => t.tx === cave.approach.tx && t.ty === cave.approach.ty))
    assert.ok(cave.clearance.every(t => t.ty > cave.anchor.ty && Math.abs(t.tx - cave.mouth.tx) <= 1))
    assert.ok(!cave.clearance.some(t => cave.footprint.some(f => f.tx === t.tx && f.ty === t.ty)))
  }
})

test('footprint on dry ground; sides and back are solid rock, and only the open mouth lets anyone through', () => {
  for (const cave of cavesIn('pradera')) {
    const isMouth = t => t.tx === cave.mouth.tx && t.ty === cave.mouth.ty
    for (const t of cave.footprint) {
      assert.equal(isWaterTile(seed, t.tx, t.ty), false, `${k(t)} dry`)
      assert.equal(isCaveRock('pradera', t.tx, t.ty), !isMouth(t), `${k(t)} rock`)
      assert.equal(solid(t.tx, t.ty), !isMouth(t), `${k(t)} solid`)
      assert.equal(isCaveMouth('pradera', t.tx, t.ty), isMouth(t), `${k(t)} mouth`)
    }
    // Exactly one footprint tile is open: the whole rock never becomes walkable.
    assert.equal(cave.footprint.filter(t => !solid(t.tx, t.ty)).length, 1)
    // Nothing but the footprint (minus its open mouth) is rock: the layer never grows past the data.
    for (let ty = cave.anchor.ty - 4; ty <= cave.anchor.ty + 5; ty++) for (let tx = cave.anchor.tx - 4; tx <= cave.anchor.tx + cave.width + 3; tx++) {
      const inside = cave.footprint.some(t => t.tx === tx && t.ty === ty) && !isMouth({ tx, ty })
      assert.equal(isCaveRock('pradera', tx, ty), inside, `${tx},${ty}`)
    }
  }
})

test('the approach is walkable and reachable from the Pradera arrival; the clearance is open ground', () => {
  const reach = reachFromArrival()
  for (const cave of cavesIn('pradera')) {
    assert.ok(reach.has(k(cave.approach)), 'approach reachable by BFS from the arrival')
    for (const t of cave.clearance) {
      assert.equal(solid(t.tx, t.ty), false, `${k(t)} not solid`)
      assert.equal(isWaterTile(seed, t.tx, t.ty), false, `${k(t)} dry`)
      assert.equal(decorAtArea('pradera', seed, t.tx, t.ty), null, `${k(t)} has no prop`)
      assert.ok(reach.has(k(t)), `${k(t)} reachable`)
    }
    // The only way to the mouth is the approach: every other neighbour of the mouth is rock.
    const around = SIDES.map(([dx, dy]) => ({ tx: cave.mouth.tx + dx, ty: cave.mouth.ty + dy }))
    const open = around.filter(t => !solid(t.tx, t.ty))
    assert.deepEqual(open.map(k), [k(cave.approach)])
  }
})

test('nothing else occupies the reserve: nodes, plots, portal, zones, routes, reserves, authored props', () => {
  for (const cave of cavesIn('pradera')) {
    for (const t of reserveOf(cave)) {
      assert.equal(isCaveReserved('pradera', t.tx, t.ty), true)
      assert.equal(isPlannedTile('pradera', t.tx, t.ty), true, `${k(t)} planned`)
      assert.equal(resourceAt('pradera', t.tx, t.ty), null, `${k(t)} no node`)
      assert.ok(!PLOTS.some(p => p.tx === t.tx && p.ty === t.ty), `${k(t)} no plot`)
      assert.ok(!(t.tx === PORTAL.tx && t.ty === PORTAL.ty), `${k(t)} not the portal`)
      assert.ok(!(t.tx === spawn.tx && t.ty === spawn.ty), `${k(t)} not the arrival`)
      assert.equal(AUTHORED_DECOR.has(`pradera:${t.tx}:${t.ty}`), false, `${k(t)} untouched by the zone layer`)
      const inBox = b => t.tx >= b.x0 && t.tx <= b.x1 && t.ty >= b.y0 && t.ty <= b.y1
      assert.ok(!RESOURCE_ZONES.some(zone => inBox(zone.box)), `${k(t)} outside zones`)
      assert.ok(!ROUTES.some(route => inBox(route.box)), `${k(t)} outside routes`)
      assert.ok(!RESERVED_AREAS.some(area => inBox(area.box)), `${k(t)} outside reserves`)
    }
  }
})

test('no work stand or waiting tile of any reachable node side lands in a cave reserve', () => {
  const reach = reachFromArrival()
  const isOpen = standableTile('pradera')
  let placements = 0
  for (const zone of RESOURCE_ZONES) {
    for (let ty = zone.box.y0; ty <= zone.box.y1; ty++) for (let tx = zone.box.x0; tx <= zone.box.x1; tx++) {
      const node = resourceAt('pradera', tx, ty)
      if (!node) continue
      for (const [dx, dy] of SIDES) {
        const side = { tx: tx + dx, ty: ty + dy }
        if (!isOpen(side.tx, side.ty) || !reach.has(k(side))) continue
        const placement = workPlacement(node, side, isOpen)
        if (!placement) continue
        placements++
        assert.equal(isCaveReserved('pradera', placement.stand.tx, placement.stand.ty), false, `${node.id} stand`)
        assert.equal(isCaveReserved('pradera', placement.wait.tx, placement.wait.ty), false, `${node.id} wait`)
      }
    }
  }
  assert.ok(placements > 300)
  // And rock is never standable, so no future node beside a cave can put a worker in it.
  for (const cave of CAVES) for (const t of cave.footprint) assert.equal(standableTile(cave.areaId)(t.tx, t.ty), false)
})

test('no wild home can land in a cave reserve', () => {
  const scx = Math.floor(spawn.tx / WILD_CHUNK_TILES), scy = Math.floor(spawn.ty / WILD_CHUNK_TILES)
  let tiles = 0
  for (let cy = scy - WILD_HOME_RADIUS_CHUNKS; cy <= scy + WILD_HOME_RADIUS_CHUNKS; cy++) {
    for (let cx = scx - WILD_HOME_RADIUS_CHUNKS; cx <= scx + WILD_HOME_RADIUS_CHUNKS; cx++) {
      for (const t of wildSpawnTiles(seed, cx, cy, 'pradera')) {
        tiles++
        assert.equal(isCaveReserved('pradera', t.tx, t.ty), false, `${k(t)}`)
      }
    }
  }
  assert.ok(tiles > 100)
})
