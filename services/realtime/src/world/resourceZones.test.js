import test from 'node:test'
import assert from 'node:assert/strict'
import { WORLD_AREAS } from './areas.js'
import { PLOTS } from './plots.js'
import { resourceAt, resourceById } from './resourceLayout.js'
import { AUTHORED_DECOR } from './resourceZoneLayout.js'
import { ARRIVAL_CLEARANCE, RESERVED_AREAS, RESOURCE_ZONES, ROUTES, decorAtArea, isCorridorTile, isPlannedTile, isSolidAtArea, resourceZoneAt } from './resourceZones.js'
import { hash2, isWaterTile } from './terrain.js'
import { standableTile, workPlacement } from './workPlacement.js'

// MAP-2: the forest and the quarry of Pradera, checked on the real layer.

const { seed, spawn } = WORLD_AREAS.pradera
const PORTAL = { tx: spawn.tx, ty: spawn.ty - 1 }
const WINDOW = { x0: spawn.tx - 60, y0: spawn.ty - 60, x1: spawn.tx + 60, y1: spawn.ty + 60 }
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]]
const LOOKALIKES = new Set(RESOURCE_ZONES.flatMap(zone => zone.nodes))
const FOREST = RESOURCE_ZONES.find(zone => zone.id === 'bosque')
const QUARRY = RESOURCE_ZONES.find(zone => zone.id === 'cantera')
const each = (box, fn) => { for (let ty = box.y0; ty <= box.y1; ty++) for (let tx = box.x0; tx <= box.x1; tx++) fn(tx, ty) }
const decor = (tx, ty) => decorAtArea('pradera', seed, tx, ty)
const solid = (tx, ty) => isSolidAtArea('pradera', seed, tx, ty)
const isOpen = standableTile('pradera')

function reachFromArrival() {
  const seen = new Set([`${spawn.tx},${spawn.ty}`])
  const queue = [spawn]
  while (queue.length) {
    const at = queue.shift()
    for (const [dx, dy] of SIDES) {
      const tx = at.tx + dx, ty = at.ty + dy
      if (tx < WINDOW.x0 || tx > WINDOW.x1 || ty < WINDOW.y0 || ty > WINDOW.y1) continue
      if (solid(tx, ty) || (tx === PORTAL.tx && ty === PORTAL.ty) || seen.has(`${tx},${ty}`)) continue
      seen.add(`${tx},${ty}`); queue.push({ tx, ty })
    }
  }
  return seen
}

test('1:1 inside each zone: every prop that looks like its resource is a node, and nothing else is', () => {
  const counts = {}
  for (const zone of RESOURCE_ZONES) {
    each(zone.box, (tx, ty) => {
      const kind = decor(tx, ty)
      const node = resourceAt('pradera', tx, ty)
      if (kind && zone.nodes.includes(kind)) {
        assert.ok(node, `${zone.id}: ${kind} at ${tx},${ty} is a node`)
        assert.equal(node.variantId, kind)
        counts[`${zone.id}:${kind}`] = (counts[`${zone.id}:${kind}`] ?? 0) + 1
      } else assert.equal(node, null, `${zone.id}: ${kind} at ${tx},${ty} is not a node`)
      // No lookalike of another zone's resource inside a zone (a rock in the forest, a tree in the quarry).
      if (kind && LOOKALIKES.has(kind)) assert.ok(zone.nodes.includes(kind), `${zone.id}: stray ${kind} at ${tx},${ty}`)
    })
  }
  assert.deepEqual(counts, { 'bosque:tree': 60, 'bosque:pine': counts['bosque:pine'], 'cantera:rock': 45 })
  assert.ok(counts['bosque:pine'] >= 20, 'the forest keeps its pines as the level-12 tier')
})

test('no resource node outside the zones (lookalikes there are scenery)', () => {
  each(WINDOW, (tx, ty) => {
    if (resourceZoneAt('pradera', tx, ty)) return
    assert.equal(resourceAt('pradera', tx, ty), null, `${tx},${ty}`)
  })
})

test('node ids are unique, resolve back to themselves, and the set is frozen', () => {
  const ids = []
  for (const zone of RESOURCE_ZONES) each(zone.box, (tx, ty) => { const node = resourceAt('pradera', tx, ty); if (node) ids.push(node.id) })
  assert.equal(new Set(ids).size, ids.length)
  for (const id of ids) assert.equal(resourceById(id)?.id, id)
  // A changed layer is a different map: the ids a database may hold move with it.
  let h = 0x811c9dc5
  for (const id of ids.sort()) for (let i = 0; i < id.length; i++) h = Math.imul(h ^ id.charCodeAt(i), 0x01000193) >>> 0
  assert.equal(`${ids.length}:${h.toString(16)}`, FROZEN_IDS)
})

test('the authored layer only touches planned ground, and props only stand where the generator would draw one', () => {
  for (const [key, kind] of AUTHORED_DECOR) {
    const [area, tx, ty] = key.split(':')
    assert.equal(area, 'pradera')
    assert.ok(isPlannedTile('pradera', Number(tx), Number(ty)), `${key} is inside a zone or route`)
    if (kind) assert.equal(isWaterTile(seed, Number(tx), Number(ty)), false, `${key} is dry`)
  }
})

test('arrival, portal and huerta stay clear; zones keep three tiles from the arrival clearance', () => {
  for (const tile of [spawn, PORTAL, ...PLOTS]) {
    assert.equal(solid(tile.tx, tile.ty), false)
    assert.equal(resourceZoneAt('pradera', tile.tx, tile.ty), null)
  }
  const { box, margin } = ARRIVAL_CLEARANCE
  each(box, (tx, ty) => assert.equal(AUTHORED_DECOR.has(`pradera:${tx}:${ty}`), false, `${tx},${ty} untouched`))
  const near = { x0: box.x0 - margin, y0: box.y0 - margin, x1: box.x1 + margin, y1: box.y1 + margin }
  for (const zone of RESOURCE_ZONES) {
    const overlaps = zone.box.x0 <= near.x1 && near.x0 <= zone.box.x1 && zone.box.y0 <= near.y1 && near.y0 <= zone.box.y1
    assert.equal(overlaps, false, `${zone.id} keeps ${margin} tiles from the arrival`)
  }
  for (const area of RESERVED_AREAS) each(area.box, (tx, ty) => assert.equal(resourceAt('pradera', tx, ty), null, `reserve ${area.id} is empty`))
})

test('corridors: two tiles wide, clear of props, no canopy over them, and connected to the arrival', () => {
  const reach = reachFromArrival()
  for (const zone of RESOURCE_ZONES) {
    for (const lane of zone.lanes) {
      assert.ok(Math.min(lane.x1 - lane.x0, lane.y1 - lane.y0) + 1 >= 2, `${zone.id} lane is two tiles wide`)
      each(lane, (tx, ty) => {
        assert.equal(solid(tx, ty), false, `${zone.id} lane ${tx},${ty} is clear`)
        assert.ok(reach.has(`${tx},${ty}`), `${zone.id} lane ${tx},${ty} is reachable`)
      })
    }
    // A canopy covers the tile above its trunk: no tree right below a horizontal lane.
    for (const lane of zone.lanes.filter(l => l.x1 - l.x0 > l.y1 - l.y0)) {
      for (let tx = lane.x0; tx <= lane.x1; tx++) assert.ok(!['tree', 'pine'].includes(decor(tx, lane.y1 + 1)), `${zone.id}: no canopy over ${tx},${lane.y1}`)
    }
    assert.ok(reach.has(`${zone.entry.tx},${zone.entry.ty}`), `${zone.id} entry is reachable`)
  }
  for (const route of ROUTES) each(route.box, (tx, ty) => {
    assert.equal(solid(tx, ty), false, `${route.id} ${tx},${ty} is clear`)
    assert.ok(isCorridorTile('pradera', tx, ty))
  })
})

test('WORLD VISUAL-2: every node can be worked from a reachable side; waiting tiles never land on portal, node, plot or solid', () => {
  const reach = reachFromArrival()
  let sides = 0, noRoom = 0
  for (const zone of RESOURCE_ZONES) each(zone.box, (tx, ty) => {
    const node = resourceAt('pradera', tx, ty)
    if (!node) return
    let workable = 0
    for (const [dx, dy] of SIDES) {
      const side = { tx: tx + dx, ty: ty + dy }
      if (!isOpen(side.tx, side.ty) || !reach.has(`${side.tx},${side.ty}`)) continue
      sides++
      const placement = workPlacement(node, side, isOpen)
      if (!placement) { noRoom++; continue }
      workable++
      const { wait } = placement
      assert.notDeepEqual({ tx: wait.tx, ty: wait.ty }, PORTAL)
      assert.equal(solid(wait.tx, wait.ty), false)
      assert.equal(resourceAt('pradera', wait.tx, wait.ty), null)
      assert.equal(PLOTS.some(p => p.tx === wait.tx && p.ty === wait.ty), false)
    }
    assert.ok(workable > 0, `${node.id} has a side to work from`)
  })
  assert.ok(sides > 300)
  // MAP-1 measured ~1.6 % on the old scattered nodes; the zones must not be worse.
  assert.ok(noRoom / sides <= 0.016, `no-room ${noRoom}/${sides}`)
})

test('the layer is deterministic: same tiles, same answers, and the lookalike rule reads the data', () => {
  const sample = Array.from({ length: 400 }, (_, i) => ({ tx: FOREST.box.x0 - 5 + Math.floor(hash2(i, 1, 7) * 40), ty: QUARRY.box.y0 - 5 + Math.floor(hash2(i, 2, 7) * 50) }))
  const once = sample.map(t => [decor(t.tx, t.ty), resourceAt('pradera', t.tx, t.ty)?.id ?? null])
  const twice = sample.map(t => [decor(t.tx, t.ty), resourceAt('pradera', t.tx, t.ty)?.id ?? null])
  assert.deepEqual(once, twice)
  assert.deepEqual([...LOOKALIKES].sort(), ['pine', 'rock', 'tree'])
})

const FROZEN_IDS = '134:327f12ac'
