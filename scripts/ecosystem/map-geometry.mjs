// ECO-MAP-1 · geometry snapshot of the real maps, for nest proposals and the
// dev simulator. Reads ONLY the shared, authoritative modules the presence
// service and the browser already use — nothing is redrawn or copied by hand:
//
//   navigation.js     isWalkable, isReachable (cave), portalAt, PORTALS     (collision CAVES-4)
//   resourceZones.js  RESOURCE_ZONES, RESERVED_AREAS, ARRIVAL_CLEARANCE, isCorridorTile
//   resourceLayout.js resourceAt (tree/rock nodes)      plots.js PLOTS (farm plots)
//   workPlacement.js  workPlacement + standableTile      (real Pokémon stand / trainer wait rule)
//   caves.js          CAVES, isCaveReserved              caveLayouts.js caveInterior
//   terrain.js        isWaterTile, tileTerrain, T, TERRAIN_GENERATOR_VERSION
//   arrival.js        ARRIVALS                           layoutVersion.js layoutVersion (fingerprints)
//
//   node scripts/ecosystem/map-geometry.mjs            write src/features/ecosystem/map/generated/geometrySnapshot.json
//   node scripts/ecosystem/map-geometry.mjs --check    exit 1 if missing or stale; writes nothing
//
// Plain Node, no TypeScript, no frontend import. The snapshot is data: the
// dev simulator reads it; the game build never does.

import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { ARRIVALS } from '../../services/realtime/src/protocol/arrival.js'
import { WORLD_AREAS } from '../../services/realtime/src/world/areas.js'
import { CAVES, isCaveReserved } from '../../services/realtime/src/world/caves.js'
import { caveInterior } from '../../services/realtime/src/world/caveLayouts.js'
import { layoutVersion } from '../../services/realtime/src/world/layoutVersion.js'
import { PORTALS, isReachable, isWalkable, portalAt } from '../../services/realtime/src/world/navigation.js'
import { PLOTS } from '../../services/realtime/src/world/plots.js'
import { resourceAt } from '../../services/realtime/src/world/resourceLayout.js'
import { ARRIVAL_CLEARANCE, RESERVED_AREAS, RESOURCE_ZONES, ROUTES, isCorridorTile } from '../../services/realtime/src/world/resourceZones.js'
import { T, TERRAIN_GENERATOR_VERSION, isWaterTile, tileTerrain } from '../../services/realtime/src/world/terrain.js'
import { standableTile, workPlacement } from '../../services/realtime/src/world/workPlacement.js'

export const OUTPUT = fileURLToPath(new URL('../../src/features/ecosystem/map/generated/geometrySnapshot.json', import.meta.url))

/** Bit of each static fact in a tile mask (3 hex digits per tile). */
export const BITS = Object.freeze({
  blocked: 0, unreachable: 1, water: 2, portal: 3, resource: 4, work: 5, corridor: 6,
  reserved: 7, arrivalClearance: 8, caveReserved: 9, tall: 10, nearWater: 11,
})

/** Pradera window: the arrival, the cave mouth, both resource zones, the reserves and the nearby grassland and shore. */
const PRADERA_WINDOW = Object.freeze({ minTx: -48, minTy: -100, maxTx: 30, maxTy: -28 })
const NEAR_WATER = 3

const inBox = (b, tx, ty) => tx >= b.x0 && tx <= b.x1 && ty >= b.y0 && ty <= b.y1

function flood(areaId, window, start) {
  const seen = new Set([`${start.tx},${start.ty}`])
  const queue = [start]
  for (let i = 0; i < queue.length; i++) {
    const { tx, ty } = queue[i]
    for (const [nx, ny] of [[tx + 1, ty], [tx - 1, ty], [tx, ty + 1], [tx, ty - 1]]) {
      if (nx < window.minTx || ny < window.minTy || nx > window.maxTx || ny > window.maxTy) continue
      if (seen.has(`${nx},${ny}`) || !isWalkable(areaId, nx, ny)) continue
      seen.add(`${nx},${ny}`)
      queue.push({ tx: nx, ty: ny })
    }
  }
  return seen
}

/** Every tile a worker or its trainer may occupy while any node of the area is worked (the real rule). */
function workTiles(areaId, window) {
  const out = new Set()
  const standable = standableTile(areaId)
  const nodes = []
  for (let ty = window.minTy - 2; ty <= window.maxTy + 2; ty++) for (let tx = window.minTx - 2; tx <= window.maxTx + 2; tx++) {
    const node = resourceAt(areaId, tx, ty)
    if (node) nodes.push(node)
  }
  nodes.push(...PLOTS.filter(p => p.areaId === areaId))
  for (const node of nodes) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
      const trainer = { tx: node.tx + dx, ty: node.ty + dy }
      if (!isWalkable(areaId, trainer.tx, trainer.ty)) continue
      const placement = workPlacement(node, trainer, standable)
      if (!placement) continue
      out.add(`${placement.stand.tx},${placement.stand.ty}`)
      out.add(`${placement.wait.tx},${placement.wait.ty}`)
    }
  }
  return out
}

function praderaSnapshot() {
  const areaId = 'pradera'
  const seed = WORLD_AREAS.pradera.seed
  const w = PRADERA_WINDOW
  const entry = { tx: ARRIVALS.pradera.tx, ty: ARRIVALS.pradera.ty }
  const reach = flood(areaId, w, entry)
  const work = workTiles(areaId, w)
  const clearance = ARRIVAL_CLEARANCE.box
  const m = ARRIVAL_CLEARANCE.margin
  const clearanceBox = { x0: clearance.x0 - m, y0: clearance.y0 - m, x1: clearance.x1 + m, y1: clearance.y1 + m }
  const water = (tx, ty) => isWaterTile(seed, tx, ty)
  const rows = []
  for (let ty = w.minTy; ty <= w.maxTy; ty++) {
    let row = ''
    for (let tx = w.minTx; tx <= w.maxTx; tx++) {
      const walkable = isWalkable(areaId, tx, ty)
      let near = false
      if (!water(tx, ty)) for (let dy = -NEAR_WATER; dy <= NEAR_WATER && !near; dy++) for (let dx = -NEAR_WATER; dx <= NEAR_WATER; dx++) if (water(tx + dx, ty + dy)) { near = true; break }
      const flags = {
        blocked: !walkable, unreachable: walkable && !reach.has(`${tx},${ty}`), water: water(tx, ty), portal: portalAt(areaId, tx, ty) !== null,
        resource: !!resourceAt(areaId, tx, ty) || PLOTS.some(p => p.areaId === areaId && p.tx === tx && p.ty === ty),
        work: work.has(`${tx},${ty}`), corridor: isCorridorTile(areaId, tx, ty),
        reserved: RESERVED_AREAS.some(r => r.areaId === areaId && inBox(r.box, tx, ty)) || ROUTES.some(r => r.areaId === areaId && inBox(r.box, tx, ty)),
        arrivalClearance: inBox(clearanceBox, tx, ty), caveReserved: isCaveReserved(areaId, tx, ty),
        tall: tileTerrain(seed, tx, ty) === T.TALL, nearWater: near,
      }
      row += encode(flags)
    }
    rows.push(row)
  }
  const cave = CAVES.find(c => c.areaId === areaId)
  return {
    areaId, layoutVersion: layoutVersion(areaId), window: w, entry,
    protected: [
      { kind: 'arrival', tx: entry.tx, ty: entry.ty },
      ...PORTALS.filter(p => p.areaId === areaId).map(p => ({ kind: `portal→${p.to}`, tx: p.tx, ty: p.ty })),
      ...(cave ? [{ kind: 'cave-approach', tx: cave.approach.tx, ty: cave.approach.ty }] : []),
    ],
    subzones: RESOURCE_ZONES.filter(z => z.areaId === areaId).map(z => ({ id: z.id, box: z.box })),
    rows,
  }
}

function caveSnapshot(areaId) {
  const interior = caveInterior(areaId)
  const w = { minTx: 0, minTy: 0, maxTx: interior.width - 1, maxTy: interior.height - 1 }
  const rows = []
  for (let ty = w.minTy; ty <= w.maxTy; ty++) {
    let row = ''
    for (let tx = w.minTx; tx <= w.maxTx; tx++) {
      const walkable = isWalkable(areaId, tx, ty)
      row += encode({ blocked: !walkable, unreachable: walkable && !isReachable(areaId, tx, ty), portal: portalAt(areaId, tx, ty) !== null })
    }
    rows.push(row)
  }
  return {
    areaId, layoutVersion: layoutVersion(areaId), window: w, entry: { tx: interior.arrival.tx, ty: interior.arrival.ty },
    protected: [
      { kind: 'arrival', tx: interior.arrival.tx, ty: interior.arrival.ty },
      ...PORTALS.filter(p => p.areaId === areaId).map(p => ({ kind: `portal→${p.to}`, tx: p.tx, ty: p.ty })),
    ],
    subzones: [],
    rows,
  }
}

function encode(flags) {
  let mask = 0
  for (const [name, bit] of Object.entries(BITS)) if (flags[name]) mask |= 1 << bit
  return mask.toString(16).padStart(3, '0')
}

export function buildSnapshot() {
  return JSON.stringify({
    generatedBy: 'scripts/ecosystem/map-geometry.mjs',
    terrainGenerator: TERRAIN_GENERATOR_VERSION,
    bits: BITS,
    areas: { pradera: praderaSnapshot(), 'cueva-inicial': caveSnapshot('cueva-inicial') },
  }) + '\n'
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const fresh = buildSnapshot()
  if (process.argv.includes('--check')) {
    const current = await readFile(OUTPUT, 'utf8').catch(() => null)
    if (current === null || current.replace(/\r\n/g, '\n') !== fresh) {
      console.error(`geometrySnapshot.json is ${current === null ? 'missing' : 'stale'}: run node scripts/ecosystem/map-geometry.mjs`)
      process.exit(1)
    }
    console.log('geometrySnapshot.json is up to date')
  } else {
    await writeFile(OUTPUT, fresh)
    console.log(`wrote ${OUTPUT} (${fresh.length} bytes)`)
  }
}
