// MAP-2 — generates the authored layer of the resource zones.
//
// Input: the zone plan in `resourceZones.js` (boxes, lanes, buffers, routes)
// and the frozen procedural world. Output: `resourceZoneLayout.js`, the list
// of tiles whose prop changes (cleared, planted tree, placed rock). The rules:
//
// - lanes, routes: every solid prop cleared; buffers: trees and pines cleared
//   (a canopy covers the tile above its trunk);
// - forest: generated rocks cleared (they would look like the quarry's);
//   round trees planted on open grass, in a fixed pseudo-random order, only
//   while every node keeps a side a trainer can work from (WORLD VISUAL-2)
//   and the zone's no-room share stays within NO_ROOM_MAX;
// - quarry: its floor cleared, rocks placed on a 2-tile grid off the lanes.
//
//   npx vite-node scripts/map/zone-layout.ts            (writes the layer)
//   npx vite-node scripts/map/zone-layout.ts -- --check (exit 1 if it drifted)
//
// DESIGN TOOL. Deterministic: same plan, same world, same file.

import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { WORLD_AREAS } from '../../services/realtime/src/world/areas.js'
import { PLOTS } from '../../services/realtime/src/world/plots.js'
import { RESOURCE_ZONES, ROUTES, isCorridorTile } from '../../services/realtime/src/world/resourceZones.js'
import { T, decorAt, hash2, isSolidDecor, isWaterTile, vertexTerrain } from '../../services/realtime/src/world/terrain.js'
import { workPlacement } from '../../services/realtime/src/world/workPlacement.js'

export const OUTPUT = fileURLToPath(new URL('../../services/realtime/src/world/resourceZoneLayout.js', import.meta.url))
const AREA = 'pradera'
const { seed, spawn } = { seed: WORLD_AREAS.pradera.seed as number, spawn: WORLD_AREAS.pradera.spawn! }
const PORTAL = { tx: spawn.tx, ty: spawn.ty - 1 }
const FOREST_TREES = 60
const NO_ROOM_MAX = 0.015
const PLANT_SALT = 0x6d61702 // "map2"
const SIDES = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const
const LOOKALIKE_ROCKS = new Set(['rock', 'boulder', 'icerock'])
const TREES = new Set(['tree', 'pine', 'snowpine', 'palm'])

type Tile = { tx: number; ty: number }
const key = (tx: number, ty: number) => `${AREA}:${tx}:${ty}`
const overrides = new Map<string, string | null>()
const decor = (tx: number, ty: number) => (overrides.has(key(tx, ty)) ? overrides.get(key(tx, ty))! : decorAt(seed, tx, ty))
const solid = (tx: number, ty: number) => isSolidDecor(decor(tx, ty) as never)
const set = (tx: number, ty: number, kind: string | null) => { if (decorAt(seed, tx, ty) === kind) overrides.delete(key(tx, ty)); else overrides.set(key(tx, ty), kind) }
/** Props only stand where the four corners agree (as the generator does), on grass or tall grass. */
const grassCorners = (tx: number, ty: number) => {
  const corners = [[0, 0], [1, 0], [1, 1], [0, 1]].map(([dx, dy]) => vertexTerrain(seed, tx + dx, ty + dy))
  return corners.every(c => c === corners[0]) && (corners[0] === T.GRASS || corners[0] === T.TALL)
}
const each = (b: { x0: number; y0: number; x1: number; y1: number }, fn: (tx: number, ty: number) => void) => { for (let ty = b.y0; ty <= b.y1; ty++) for (let tx = b.x0; tx <= b.x1; tx++) fn(tx, ty) }
const zoneOf = (tx: number, ty: number) => RESOURCE_ZONES.find(z => tx >= z.box.x0 && tx <= z.box.x1 && ty >= z.box.y0 && ty <= z.box.y1) ?? null
const isNode = (tx: number, ty: number) => { const z = zoneOf(tx, ty); const k = decor(tx, ty); return !!z && !!k && (z.nodes as readonly string[]).includes(k) }
const isPlot = (tx: number, ty: number) => PLOTS.some(p => p.tx === tx && p.ty === ty)
/** Where a trainer may wait (workPlacement's rule) on the layer being built. */
const standable = (tx: number, ty: number) => !solid(tx, ty) && !isWaterTile(seed, tx, ty) && !isNode(tx, ty) && !isPlot(tx, ty)

// ── 1 · Corridors, routes, zone floors ──────────────────────────────────────
for (const zone of RESOURCE_ZONES) {
  each(zone.box, (tx, ty) => {
    const k = decorAt(seed, tx, ty)
    if (!k) return
    const corridor = zone.lanes.some(l => tx >= l.x0 && tx <= l.x1 && ty >= l.y0 && ty <= l.y1)
    const buffer = zone.buffers.some(b => tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1)
    if (zone.id === 'cantera') set(tx, ty, null)
    else if (corridor && isSolidDecor(k)) set(tx, ty, null)
    else if (buffer && TREES.has(k)) set(tx, ty, null)
    else if (LOOKALIKE_ROCKS.has(k)) set(tx, ty, null)
  })
}
for (const route of ROUTES) each(route.box, (tx, ty) => { if (isSolidDecor(decorAt(seed, tx, ty))) set(tx, ty, null) })

// ── 2 · Quarry rocks on a 2-tile grid ───────────────────────────────────────
const quarry = RESOURCE_ZONES.find(z => z.id === 'cantera')!
each(quarry.box, (tx, ty) => {
  if (isCorridorTile(AREA, tx, ty)) return
  if ((tx - quarry.box.x0) % 2 !== 0 || (ty - quarry.box.y0) % 2 !== 0) return
  if (!grassCorners(tx, ty) || isWaterTile(seed, tx, ty)) return
  set(tx, ty, 'rock')
})

const QUARRY_ROCKS = 45

// ── 3 · Forest planting, keeping every node workable ────────────────────────
const forest = RESOURCE_ZONES.find(z => z.id === 'bosque')!
const WINDOW = { x0: spawn.tx - 40, y0: spawn.ty - 40, x1: spawn.tx + 40, y1: spawn.ty + 40 }
function reachable(): Set<string> {
  const seen = new Set([key(spawn.tx, spawn.ty)])
  const queue: Tile[] = [spawn]
  while (queue.length) {
    const at = queue.shift()!
    for (const [dx, dy] of SIDES) {
      const tx = at.tx + dx, ty = at.ty + dy
      if (tx < WINDOW.x0 || tx > WINDOW.x1 || ty < WINDOW.y0 || ty > WINDOW.y1) continue
      if (solid(tx, ty) || (tx === PORTAL.tx && ty === PORTAL.ty) || seen.has(key(tx, ty))) continue
      seen.add(key(tx, ty)); queue.push({ tx, ty })
    }
  }
  return seen
}
/** Work sides of every zone node: reachable standable sides, and how many of them have no room. */
function audit(zoneFilter: (z: typeof forest) => boolean = () => true) {
  const reach = reachable()
  let sides = 0, noRoom = 0, stranded = 0
  for (const zone of RESOURCE_ZONES.filter(zoneFilter)) {
    each(zone.box, (tx, ty) => {
      if (!isNode(tx, ty)) return
      let workable = 0
      for (const [dx, dy] of SIDES) {
        const side = { tx: tx + dx, ty: ty + dy }
        if (!standable(side.tx, side.ty) || !reach.has(key(side.tx, side.ty))) continue
        sides++
        if (workPlacement({ tx, ty }, side, standable)) workable++
        else noRoom++
      }
      if (workable === 0) stranded++
    })
  }
  return { sides, noRoom, share: sides ? noRoom / sides : 0, stranded }
}
// A node nobody can work from is not a resource: first open a side by clearing a bush next to it,
// else clear the node itself (it stays a plain tile rather than an unreachable lookalike).
function unstrand() {
  for (let pass = 0; pass < 3; pass++) {
    const reach = reachable()
    let changed = false
    for (const zone of RESOURCE_ZONES) each(zone.box, (tx, ty) => {
      if (!isNode(tx, ty)) return
      const works = SIDES.some(([dx, dy]) => { const s = { tx: tx + dx, ty: ty + dy }; return standable(s.tx, s.ty) && reach.has(key(s.tx, s.ty)) && workPlacement({ tx, ty }, s, standable) })
      if (works) return
      // Only inside the zone: the layer never changes ground outside planned tiles (caves read it).
      const bush = SIDES.map(([dx, dy]) => ({ tx: tx + dx, ty: ty + dy })).find(s => decor(s.tx, s.ty) === 'bush' && zoneOf(s.tx, s.ty) === zone)
      if (bush) set(bush.tx, bush.ty, null)
      else set(tx, ty, null)
      changed = true
    })
    if (!changed) return
  }
}
unstrand()
const roundTrees = () => { let n = 0; each(forest.box, (tx, ty) => { if (decor(tx, ty) === 'tree') n++ }); return n }
const candidates: Tile[] = []
each(forest.box, (tx, ty) => {
  if (decor(tx, ty) || isCorridorTile(AREA, tx, ty) || !grassCorners(tx, ty) || isWaterTile(seed, tx, ty)) return
  candidates.push({ tx, ty })
})
candidates.sort((a, b) => hash2(a.tx, a.ty, seed + PLANT_SALT) - hash2(b.tx, b.ty, seed + PLANT_SALT))
for (const c of candidates) {
  if (roundTrees() >= FOREST_TREES) break
  // Keep a free ring: no planted tree touches another prop orthogonally, so paths stay open.
  if (SIDES.some(([dx, dy]) => solid(c.tx + dx, c.ty + dy))) continue
  set(c.tx, c.ty, 'tree')
  const check = audit(z => z.id === 'bosque')
  if (check.stranded > 0 || check.share > NO_ROOM_MAX) set(c.tx, c.ty, null)
}

// ── 4 · Quarry fill: grid positions lost to grass edges, placed on a free neighbour tile ──
const quarryRocks = () => { let n = 0; each(quarry.box, (tx, ty) => { if (decor(tx, ty) === 'rock') n++ }); return n }
const fill: Tile[] = []
each(quarry.box, (tx, ty) => {
  if (decor(tx, ty) || isCorridorTile(AREA, tx, ty) || !grassCorners(tx, ty) || isWaterTile(seed, tx, ty)) return
  fill.push({ tx, ty })
})
fill.sort((a, b) => hash2(a.tx, a.ty, seed + PLANT_SALT + 1) - hash2(b.tx, b.ty, seed + PLANT_SALT + 1))
for (const c of fill) {
  if (quarryRocks() >= QUARRY_ROCKS) break
  if (SIDES.some(([dx, dy]) => solid(c.tx + dx, c.ty + dy))) continue
  set(c.tx, c.ty, 'rock')
  const check = audit(z => z.id === 'cantera')
  if (check.stranded > 0 || check.share > NO_ROOM_MAX) set(c.tx, c.ty, null)
}

// ── Output ──────────────────────────────────────────────────────────────────
const entries = [...overrides].sort(([a], [b]) => {
  const [, ax, ay] = a.split(':').map(Number); const [, bx, by] = b.split(':').map(Number)
  return ay - by || ax - bx
})
const summary = { forestRoundTrees: roundTrees(), quarryRocks: quarryRocks(), audit: audit(), entries: entries.length, cleared: entries.filter(([, k]) => k === null).length, planted: entries.filter(([, k]) => k === 'tree').length, rocks: entries.filter(([, k]) => k === 'rock').length }
const body = `// Authored layer of the resource zones (MAP-2). DATA ONLY — generated by
// \`scripts/map/zone-layout.ts\` from the zone plan in \`resourceZones.js\` and
// the frozen procedural world. Regenerate, never hand-edit: the tests check
// every rule this data must keep (corridors, work sides, caves, determinism).
//
// ${summary.entries} tiles: ${summary.cleared} cleared, ${summary.planted} trees planted, ${summary.rocks} rocks placed.

/** \`areaId:tx:ty\` → prop kind, or null for a tile cleared of its generated prop. */
export const AUTHORED_DECOR = new Map([
${entries.map(([k, v]) => `  ['${k}', ${v === null ? 'null' : `'${v}'`}],`).join('\n')}
])
`
if (process.argv.includes('--check')) {
  const current = readFileSync(OUTPUT, 'utf8').replace(/\r\n/g, '\n')
  if (current !== body) { process.stderr.write('resourceZoneLayout.js drifted from the generator\n'); process.exit(1) }
  process.stdout.write('resourceZoneLayout.js is up to date\n')
} else {
  writeFileSync(OUTPUT, body)
  process.stdout.write(`${JSON.stringify(summary)}\n`)
}
