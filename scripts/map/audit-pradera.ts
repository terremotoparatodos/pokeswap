// Resource and cave audit of Pradera Brisa, measured on the real world.
//
// Reads exactly what players get: the procedural terrain and props both sides
// run (`terrain.js`), WORLD's node layout (`resourceLayout.js`), SKILLS'
// node → resource mapping (`resourceMapping.ts`), the huerta plots, the return
// portal and the caves of `caves.js` (CAVES-2). Writes counts and
// coordinates (JSON) and annotated maps (PNG) for the report.
//
//   npx vite-node scripts/map/audit-pradera.ts -- <output folder>
//
// It reads the zone layer (`decorAtArea`) — the world players get now. The
// output folder is required: `docs/design/map-1/` and `map-2/` are frozen
// measurements of their phases and are not regenerated from here. MAP-1's
// zone-siting proposal was retired in CAVES-2: it searched for room for zones
// in a world that already has them, and its result lives on in map-1/.
//
// DESIGN TOOL. It reads the world, writes nothing but its output folder, and
// exits non-zero when the canonical cave is not where CAVES-2 put it or cannot
// be walked to (guarded by src/features/caves/praderaAudit.test.ts).

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Atlas } from '../../src/features/wildlands/areas/atlas'
import { skillsResourceFor } from '../../src/features/worldSkills/resourceMapping'
import { workDuration } from '../../src/features/skills/domain/workRules'
import { WORLD_AREAS } from '../../services/realtime/src/world/areas.js'
import { PLOTS } from '../../services/realtime/src/world/plots.js'
import { RESOURCE_VARIANTS, ZONE_RING_TILES, resourceAt } from '../../services/realtime/src/world/resourceLayout.js'
import { RESPAWN_MS } from '../../services/realtime/src/world/worldTuning.js'
import { T, decorAt, isSolidDecor, tileTerrain } from '../../services/realtime/src/world/terrain.js'
import { RESERVED_AREAS, RESOURCE_ZONES, ROUTES, decorAtArea, resourceZoneAt } from '../../services/realtime/src/world/resourceZones.js'
import { standableTile, workPlacement } from '../../services/realtime/src/world/workPlacement.js'
import { WORLD_VIEW_TILES } from '../../services/realtime/src/world/worldInterest.js'
import { cavesIn } from '../../services/realtime/src/world/caves.js'

type Tile = { tx: number; ty: number }
const OUT = process.argv.slice(2).find(arg => arg !== '--')
if (!OUT) {
  process.stderr.write('usage: npx vite-node scripts/map/audit-pradera.ts -- <output folder>\n')
  process.exit(2)
}
const { seed, spawn } = { seed: WORLD_AREAS.pradera.seed as number, spawn: WORLD_AREAS.pradera.spawn! }
const area = new Atlas().get('pradera')
/** The audit window: the part of an infinite world a player actually uses around the arrival. */
const R = 48
const X0 = spawn.tx - R
const Y0 = spawn.ty - R
const SIZE = 2 * R + 1
const inWindow = (t: Tile) => Math.abs(t.tx - spawn.tx) <= R && Math.abs(t.ty - spawn.ty) <= R
const key = (t: Tile) => `${t.tx},${t.ty}`
const PORTAL = area.portals[0].tiles[0]
const TREE_KINDS = new Set(['tree', 'pine', 'snowpine', 'palm'])
const ROCK_KINDS = new Set(['rock', 'boulder', 'icerock'])

// ── Caves: the canonical ones (CAVES-2), not a placement of their own ──────
const caves = cavesIn('pradera')
const caveTiles = new Set(caves.flatMap(cave => cave.footprint.map(key)))

// ── Tiles ────────────────────────────────────────────────────────────────────
type NodeClass = 'basic' | 'gated' | 'unmapped'
interface Prop extends Tile { kind: string; node: string | null; resource: string | null; level: number | null; cls: NodeClass | 'decor'; backdrop: boolean }
const LOOKALIKE = new Set(RESOURCE_ZONES.flatMap(zone => zone.nodes))
const props: Prop[] = []
const terrainCount: Record<string, number> = {}
const TERRAIN_NAME = Object.fromEntries(Object.entries(T).map(([name, id]) => [id, name.toLowerCase()]))
let solid = 0, water = 0, tall = 0
for (let ty = Y0; ty < Y0 + SIZE; ty++) {
  for (let tx = X0; tx < X0 + SIZE; tx++) {
    const terrain = tileTerrain(seed, tx, ty)
    terrainCount[TERRAIN_NAME[terrain]] = (terrainCount[TERRAIN_NAME[terrain]] ?? 0) + 1
    if (terrain === T.DEEP || terrain === T.WATER) water++
    if (terrain === T.TALL) tall++
    const kind = decorAtArea('pradera', seed, tx, ty)
    if (isSolidDecor(kind)) solid++
    if (!kind) continue
    const node = resourceAt('pradera', tx, ty)
    const resource = node ? skillsResourceFor(node) : null
    const cls = !node ? 'decor' : !resource ? 'unmapped' : resource.requiredLevel === 1 ? 'basic' : 'gated'
    props.push({ tx, ty, kind, node: node?.id ?? null, resource: resource?.id ?? null, level: resource?.requiredLevel ?? null, cls, backdrop: !node && LOOKALIKE.has(kind) && !resourceZoneAt('pradera', tx, ty) })
  }
}

// ── Walking distance from the arrival (what the client lets a player walk) ───
const blocked = (tx: number, ty: number) => area.isSolid(tx, ty) || caveTiles.has(`${tx},${ty}`) || (tx === PORTAL.tx && ty === PORTAL.ty)
const dist = new Map<string, number>([[key(spawn), 0]])
for (const queue: Tile[] = [spawn]; queue.length;) {
  const at = queue.shift()!
  const d = dist.get(key(at))!
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const next = { tx: at.tx + dx, ty: at.ty + dy }
    if (!inWindow(next) || blocked(next.tx, next.ty) || dist.has(key(next))) continue
    dist.set(key(next), d + 1)
    queue.push(next)
  }
}
/** Steps to stand beside a node (it is solid itself). */
const reach = (t: Tile) => Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => dist.get(`${t.tx + dx},${t.ty + dy}`) ?? Infinity))

// ── Counts and ratios ────────────────────────────────────────────────────────
const count = (filter: (p: Prop) => boolean) => props.filter(filter).length
const byKind = (kinds: Set<string>) => Object.fromEntries([...kinds].map(kind => [kind, {
  visible: count(p => p.kind === kind),
  nodes: count(p => p.kind === kind && p.node !== null),
  basic: count(p => p.kind === kind && p.cls === 'basic'),
  gated: count(p => p.kind === kind && p.cls === 'gated'),
  unmapped: count(p => p.kind === kind && p.cls === 'unmapped'),
}]))
const basicTrees = props.filter(p => TREE_KINDS.has(p.kind) && p.cls === 'basic')
const basicRocks = props.filter(p => ROCK_KINDS.has(p.kind) && p.cls === 'basic')
const nearestNeighbour = (set: Prop[]) => {
  const d = set.map(a => Math.min(...set.filter(b => b !== a).map(b => Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty)))).sort((x, y) => x - y)
  return { median: d[Math.floor(d.length / 2)] ?? null, p25: d[Math.floor(d.length / 4)] ?? null, p75: d[Math.floor((3 * d.length) / 4)] ?? null }
}
const reachable = (set: Prop[], within: number) => set.filter(p => reach(p) <= within)
const nearest = (set: Prop[]) => set.map(p => ({ id: p.node, tx: p.tx, ty: p.ty, steps: reach(p) })).sort((a, b) => a.steps - b.steps).slice(0, 5)

// ── Capacity (current rules kept: one action depletes, WORLD respawn) ────────
const respawnS = RESPAWN_MS.tree / 1000
const actionS = { chop: workDuration(3000, 3, 1) / 1000, mine: workDuration(3200, 3, 1) / 1000 }
/** Per action besides the work itself: reply, the reward beat, reopening the panel. */
const OVERHEAD_S = 2.5
const WALK_TPS = 3.75
function supported(nodes: number, action: number, spacing: number) {
  const cycle = action + OVERHEAD_S + spacing / WALK_TPS
  return { cycleS: +cycle.toFixed(1), playersBusy: +((nodes * cycle) / (respawnS + action)).toFixed(1), nodesPerPlayer: Math.ceil((respawnS + action) / cycle) }
}
function busyShare(nodes: number, players: number, action: number, spacing: number) {
  return Math.min(1, supported(nodes, action, spacing).playersBusy / players)
}

// ── Work sides (WORLD VISUAL-2) and what a client has to hold (MAP-2) ─────────
const standable = standableTile('pradera')
const workSides = (() => {
  let sides = 0, noRoom = 0
  for (const p of props.filter(q => q.node)) for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const side = { tx: p.tx + dx, ty: p.ty + dy }
    if (!standable(side.tx, side.ty) || !dist.has(key(side))) continue
    sides++
    if (!workPlacement(p, side, standable)) noRoom++
  }
  return { sides, noRoom, share: sides ? +(noRoom / sides).toFixed(4) : 0 }
})()
const aoi = (() => {
  const chunks = new Map<string, { props: number; propsBase: number; nodes: number }>()
  for (let ty = Y0; ty < Y0 + SIZE; ty++) for (let tx = X0; tx < X0 + SIZE; tx++) {
    const c = `${Math.floor(tx / 16)},${Math.floor(ty / 16)}`
    const entry = chunks.get(c) ?? { props: 0, propsBase: 0, nodes: 0 }
    if (decorAtArea('pradera', seed, tx, ty)) entry.props++
    if (decorAt(seed, tx, ty)) entry.propsBase++
    if (resourceAt('pradera', tx, ty)) entry.nodes++
    chunks.set(c, entry)
  }
  const rows = [...chunks.values()]
  const nodeBytes = 110 // one depleted node in a snapshot/batch (publicNode as JSON)
  return {
    chunksInWindow: rows.length, propsInWindow: rows.reduce((n, r) => n + r.props, 0), propsInWindowBase: rows.reduce((n, r) => n + r.propsBase, 0),
    maxNodesPerChunk: Math.max(...rows.map(r => r.nodes)), maxPropsPerChunk: Math.max(...rows.map(r => r.props)), maxPropsPerChunkBase: Math.max(...rows.map(r => r.propsBase)),
    worstChunkSnapshotBytes: Math.max(...rows.map(r => r.nodes)) * nodeBytes,
  }
})()

// ── Report data ──────────────────────────────────────────────────────────────
const data = {
  window: { center: spawn, radius: R, tiles: SIZE * SIZE, x: [X0, X0 + SIZE - 1], y: [Y0, Y0 + SIZE - 1] },
  arrival: area.arrival(null), portal: PORTAL,
  ringBoundary: { tiles: ZONE_RING_TILES, spawnDistanceToOrigin: Math.round(Math.hypot(spawn.tx, spawn.ty)) },
  viewRadius: WORLD_VIEW_TILES,
  terrain: terrainCount, waterTiles: water, tallGrassTiles: tall, solidPropTiles: solid,
  walkableReachable: dist.size,
  roads: 'none: the procedural world has no path tiles',
  plots: PLOTS.map(p => ({ id: p.id, tx: p.tx, ty: p.ty, steps: reach(p) })),
  caves: caves.map(c => ({ anchor: c.anchor, footprint: c.footprint.length, approach: c.approach, steps: dist.get(key(c.approach)) ?? null })),
  densities: RESOURCE_VARIANTS,
  trees: byKind(TREE_KINDS), rocks: byKind(ROCK_KINDS),
  otherProps: Object.fromEntries(['bush', 'cactus', 'drybush', 'crystal', 'shell', 'coral', 'searock'].map(kind => [kind, count(p => p.kind === kind)])),
  ratios: {
    treesBasicShare: +(basicTrees.length / count(p => TREE_KINDS.has(p.kind))).toFixed(3),
    commonLookingTreesBasicShare: +(basicTrees.filter(p => p.kind === 'tree' || p.kind === 'palm').length / count(p => p.kind === 'tree' || p.kind === 'palm')).toFixed(3),
    rocksBasicShare: +(basicRocks.length / count(p => ROCK_KINDS.has(p.kind))).toFixed(3),
    rockKindBasicShare: +(basicRocks.filter(p => p.kind === 'rock').length / count(p => p.kind === 'rock')).toFixed(3),
  },
  nearestBasicTrees: nearest(basicTrees), nearestBasicRocks: nearest(basicRocks),
  spacing: { trees: nearestNeighbour(basicTrees), rocks: nearestNeighbour(basicRocks) },
  reachableBasic: Object.fromEntries([12, 24, 36, 48].map(r => [r, { trees: reachable(basicTrees, r).length, rocks: reachable(basicRocks, r).length }])),
  capacity: { respawnS, actionS, overheadS: OVERHEAD_S, walkTilesPerS: WALK_TPS },
  backdrop: { total: count(p => p.backdrop), byKind: Object.fromEntries([...LOOKALIKE].map(kind => [kind, count(p => p.backdrop && p.kind === kind)])) },
  workSides, aoi,
  zones: RESOURCE_ZONES.map(zone => ({ id: zone.id, box: zone.box, entry: zone.entry, entrySteps: dist.get(key(zone.entry)) ?? null, nodes: props.filter(p => p.node && resourceZoneAt('pradera', p.tx, p.ty) === zone).length })),
  nodes: props.filter(p => p.node).map(p => ({ id: p.node, kind: p.kind, cls: p.cls, resource: p.resource, level: p.level, steps: Number.isFinite(reach(p)) ? reach(p) : null })),
}

const capacityRows = (label: string, trees: number, rocks: number, spacingTrees: number, spacingRocks: number) => ({
  label, trees, rocks,
  chop: supported(trees, actionS.chop, spacingTrees), mine: supported(rocks, actionS.mine, spacingRocks),
  busyShare: Object.fromEntries([2, 5, 10, 30].map(n => [n, {
    allChop: +busyShare(trees, n, actionS.chop, spacingTrees).toFixed(2),
    allMine: +busyShare(rocks, n, actionS.mine, spacingRocks).toFixed(2),
    halfEach: +Math.min(busyShare(trees, n / 2, actionS.chop, spacingTrees), busyShare(rocks, n / 2, actionS.mine, spacingRocks)).toFixed(2),
  }])),
})
const today = capacityRows('zonas MAP-2', basicTrees.length, basicRocks.length, data.spacing.trees.median ?? 8, data.spacing.rocks.median ?? 8)
const alternatives = [
  capacityRows('minimal', 24, 18, 3, 3),
  capacityRows('recommended', 60, 45, 2.5, 2.5),
  capacityRows('dense', 120, 90, 2, 2),
]

mkdirSync(OUT, { recursive: true })
writeFileSync(join(OUT, 'audit.json'), `${JSON.stringify({ ...data, today, alternatives }, null, 1)}\n`)

// ── Maps ─────────────────────────────────────────────────────────────────────
const PX = 7
type RGB = readonly [number, number, number]
const TERRAIN_RGB: Record<number, RGB> = {
  [T.DEEP]: [38, 78, 140], [T.WATER]: [70, 125, 190], [T.SAND]: [222, 204, 150], [T.GRASS]: [150, 196, 110],
  [T.DUNE]: [210, 180, 120], [T.TALL]: [110, 165, 85], [T.SNOW]: [235, 240, 245],
}
function canvas() {
  const w = SIZE * PX, h = SIZE * PX
  const px = new Uint8Array(w * h * 3)
  const set = (x: number, y: number, c: RGB) => { if (x < 0 || y < 0 || x >= w || y >= h) return; const i = (y * w + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2] }
  const fillTile = (t: Tile, c: RGB, inset = 0) => { const bx = (t.tx - X0) * PX, by = (t.ty - Y0) * PX; for (let y = inset; y < PX - inset; y++) for (let x = inset; x < PX - inset; x++) set(bx + x, by + y, c) }
  const ring = (t: Tile, c: RGB) => { const bx = (t.tx - X0) * PX, by = (t.ty - Y0) * PX; for (let i = -1; i <= PX; i++) { set(bx + i, by - 1, c); set(bx + i, by + PX, c); set(bx - 1, by + i, c); set(bx + PX, by + i, c) } }
  const rect = (a: Tile, b: Tile, c: RGB, thick = 2) => {
    const x0 = (a.tx - X0) * PX, y0 = (a.ty - Y0) * PX, x1 = (b.tx - X0 + 1) * PX - 1, y1 = (b.ty - Y0 + 1) * PX - 1
    for (let t = 0; t < thick; t++) { for (let x = x0; x <= x1; x++) { set(x, y0 + t, c); set(x, y1 - t, c) } for (let y = y0; y <= y1; y++) { set(x0 + t, y, c); set(x1 - t, y, c) } }
  }
  const circle = (t: Tile, radius: number, c: RGB) => { const cx = (t.tx - X0 + 0.5) * PX, cy = (t.ty - Y0 + 0.5) * PX; for (let a = 0; a < 2000; a++) { const th = (a / 2000) * Math.PI * 2; set(Math.round(cx + Math.cos(th) * radius * PX), Math.round(cy + Math.sin(th) * radius * PX), c) } }
  return { w, h, px, set, fillTile, ring, rect, circle }
}
function base(c: ReturnType<typeof canvas>, dim = false) {
  for (let ty = Y0; ty < Y0 + SIZE; ty++) for (let tx = X0; tx < X0 + SIZE; tx++) {
    const rgb = TERRAIN_RGB[tileTerrain(seed, tx, ty)]
    c.fillTile({ tx, ty }, dim ? (rgb.map(v => Math.round(v * 0.55 + 110)) as unknown as RGB) : rgb)
  }
  for (const p of props) {
    const rgb: RGB = TREE_KINDS.has(p.kind) ? (p.kind === 'pine' || p.kind === 'snowpine' ? [40, 90, 70] : [45, 110, 45])
      : ROCK_KINDS.has(p.kind) ? [120, 120, 125] : p.kind === 'bush' || p.kind === 'drybush' ? [95, 140, 60] : p.kind === 'crystal' ? [120, 220, 240] : [150, 120, 90]
    c.fillTile(p, dim ? (rgb.map(v => Math.round(v * 0.6 + 90)) as unknown as RGB) : rgb, 1)
  }
  for (const t of caveTiles) { const [tx, ty] = t.split(',').map(Number); c.fillTile({ tx, ty }, [60, 45, 40]) }
  for (const p of PLOTS) c.fillTile(p, [120, 80, 40])
  c.fillTile(PORTAL, [210, 60, 220])
  c.fillTile(spawn, [230, 40, 40])
}
function png(c: ReturnType<typeof canvas>, file: string) {
  const raw = Buffer.alloc((c.w * 3 + 1) * c.h)
  for (let y = 0; y < c.h; y++) { raw[y * (c.w * 3 + 1)] = 0; Buffer.from(c.px.buffer, y * c.w * 3, c.w * 3).copy(raw, y * (c.w * 3 + 1) + 1) }
  const crcTable = Array.from({ length: 256 }, (_, n) => { let v = n; for (let k = 0; k < 8; k++) v = v & 1 ? 0xedb88320 ^ (v >>> 1) : v >>> 1; return v >>> 0 })
  const crc = (buf: Buffer) => { let v = 0xffffffff; for (const b of buf) v = crcTable[(v ^ b) & 0xff] ^ (v >>> 8); return (v ^ 0xffffffff) >>> 0 }
  const chunk = (type: string, body: Buffer) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); const tb = Buffer.concat([Buffer.from(type), body]); const cr = Buffer.alloc(4); cr.writeUInt32BE(crc(tb)); return Buffer.concat([len, tb, cr]) }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(c.w, 0); ihdr.writeUInt32BE(c.h, 4); ihdr[8] = 8; ihdr[9] = 2
  writeFileSync(join(OUT, file), Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

{
// MAP-2 · The zones as built: every prop, nodes ringed, backdrop lookalikes grey.
const zoneBox = (b: { x0: number; y0: number; x1: number; y1: number }): [Tile, Tile] => [{ tx: b.x0, ty: b.y0 }, { tx: b.x1, ty: b.y1 }]
const built = canvas()
base(built)
for (const p of props) {
  if (p.backdrop) built.fillTile(p, [150, 150, 145], 1)
  if (p.cls === 'basic') built.ring(p, TREE_KINDS.has(p.kind) ? [255, 255, 255] : [255, 150, 0])
  else if (p.cls === 'gated') built.ring(p, [170, 90, 230])
}
for (const zone of RESOURCE_ZONES) {
  for (const lane of zone.lanes) for (let ty = lane.y0; ty <= lane.y1; ty++) for (let tx = lane.x0; tx <= lane.x1; tx++) built.fillTile({ tx, ty }, [196, 160, 110], 2)
  built.rect(...zoneBox(zone.box), zone.id === 'bosque' ? [0, 90, 0] : [200, 90, 0], 3)
}
for (const route of ROUTES) for (let ty = route.box.y0; ty <= route.box.y1; ty++) for (let tx = route.box.x0; tx <= route.box.x1; tx++) built.fillTile({ tx, ty }, [196, 160, 110], 2)
for (const reserve of RESERVED_AREAS) built.rect(...zoneBox(reserve.box), [120, 60, 200], 2)
built.circle(spawn, WORLD_VIEW_TILES, [230, 40, 40])
writeFileSync(join(OUT, 'README.txt'), 'Generated by scripts/map/audit-pradera.ts. Do not edit by hand.\n')
png(built, 'pradera-zones.png')
const reachAfter = canvas()
base(reachAfter, true)
for (const [k, d] of dist) {
  const [tx, ty] = k.split(',').map(Number)
  if (area.isSolid(tx, ty)) continue
  const band = d <= 12 ? [255, 235, 120] : d <= 24 ? [255, 200, 90] : d <= 36 ? [240, 160, 80] : [215, 120, 80]
  if ((tx + ty) % 2 === 0) reachAfter.fillTile({ tx, ty }, band as unknown as RGB, 2)
}
for (const p of props) if (p.cls === 'basic') reachAfter.fillTile(p, TREE_KINDS.has(p.kind) ? [0, 120, 0] : [230, 110, 0], 1)
for (const zone of RESOURCE_ZONES) reachAfter.rect(...zoneBox(zone.box), zone.id === 'bosque' ? [0, 90, 0] : [200, 90, 0], 2)
png(reachAfter, 'pradera-reach-after.png')
{
  const cx = (tx: number) => (tx - X0 + 0.5) * PX
  const cy = (ty: number) => (ty - Y0 + 0.5) * PX
  const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  const label = (t: Tile, text: string, color = '#111', dx = 8, dy = -8) => `<g font-family="sans-serif" font-size="12" font-weight="700"><text x="${cx(t.tx) + dx}" y="${cy(t.ty) + dy}" fill="#fff" stroke="#fff" stroke-width="3">${esc(text)}</text><text x="${cx(t.tx) + dx}" y="${cy(t.ty) + dy}" fill="${color}">${esc(text)}</text></g>`
  const svg = (pngFile: string, overlay: string, legend: [string, string][], title: string) => {
    const b64 = readFileSync(join(OUT, pngFile)).toString('base64')
    const W = SIZE * PX, H = SIZE * PX, legendH = 22 + legend.length * 18
    const items = legend.map(([color, text], i) => `<rect x="12" y="${H + 30 + i * 18}" width="12" height="12" fill="${color}" stroke="#333"/><text x="30" y="${H + 40 + i * 18}" font-family="sans-serif" font-size="12">${esc(text)}</text>`).join('')
    return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + legendH + 16}" viewBox="0 0 ${W} ${H + legendH + 16}">
<rect width="100%" height="100%" fill="#fff"/>
<image href="data:image/png;base64,${b64}" x="0" y="0" width="${W}" height="${H}" style="image-rendering:pixelated"/>
${overlay}
<text x="12" y="${H + 18}" font-family="sans-serif" font-size="13" font-weight="700">${esc(title)}</text>${items}
</svg>
`
  }
  const zoneText = (id: string) => data.zones.find(z => z.id === id)!
  const forest = RESOURCE_ZONES.find(z => z.id === 'bosque')!, quarry = RESOURCE_ZONES.find(z => z.id === 'cantera')!
  const overlay = label(spawn, 'Llegada', '#c00', 10, 22) + label(PORTAL, 'Portal', '#a0a', 10, -6) + label(PLOTS[0], 'Huerta', '#785028', -52, -6)
    + caves.map(c => label(c.anchor, 'Cueva (cerrada)', '#3c2d28', 6, 18)).join('')
    + label({ tx: forest.box.x0, ty: forest.box.y0 }, `BOSQUE · ${zoneText('bosque').nodes} nodos · entrada a ${zoneText('bosque').entrySteps} pasos`, '#060', 0, -6)
    + label({ tx: quarry.box.x0, ty: quarry.box.y0 }, `CANTERA · ${zoneText('cantera').nodes} rocas · entrada a ${zoneText('cantera').entrySteps} pasos`, '#b50', 0, -6)
    + RESERVED_AREAS.map(r => label({ tx: r.box.x0, ty: r.box.y0 }, r.id === 'reserva-minerales' ? 'RESERVA minerales' : 'Reserva huerta', '#63c', 0, -6)).join('')
  writeFileSync(join(OUT, 'pradera-zones.svg'), svg('pradera-zones.png', overlay,
    [['#e62828', 'Llegada (spawn -5,-69); círculo = radio de vista 24'], ['#d23cdc', 'Portal a Ciudad (-5,-70)'], ['#785028', 'Huerta: 4 parcelas'], ['#3c2d28', 'Cueva canónica (caves.js), 3×2'],
      ['#ffffff', 'Árbol común talable (nivel 1): borde blanco'], ['#aa5ae6', 'Pino (Talar 12): borde violeta'], ['#ff9600', 'Roca picable (nivel 1): borde naranja'],
      ['#96968f', 'Árbol / pino / roca de fondo (se dibuja apagado, no es recurso)'], ['#c4a06e', 'Corredores y rutas (tierra pisada)'], ['#783cc8', 'Reservas']],
    'Pradera después de MAP-2 — ventana 97×97 alrededor de la llegada'))
  writeFileSync(join(OUT, 'pradera-reach-after.svg'), svg('pradera-reach-after.png', label(spawn, 'Llegada', '#c00', 10, 22) + overlay,
    [['#ffeb78', '≤ 12 pasos desde la llegada'], ['#ffc85a', '13–24 pasos'], ['#f0a050', '25–36 pasos'], ['#d77850', '37–48 pasos'], ['#007800', 'Árbol talable nivel 1'], ['#e66e00', 'Roca picable nivel 1']],
    'Pradera después de MAP-2 — distancia caminando y recursos básicos'))
}

}

process.stdout.write(`${JSON.stringify({ trees: data.trees, rocks: data.rocks, ratios: data.ratios, nearestBasicTrees: data.nearestBasicTrees.slice(0, 2), nearestBasicRocks: data.nearestBasicRocks.slice(0, 2), spacing: data.spacing, reachableBasic: data.reachableBasic, caves: data.caves, plots: data.plots, today, alternatives }, null, 1)}\n`)

// ── Cave check (CAVES-2): the one canonical cave, where it was decided, walkable to ──
const caveProblems: string[] = []
if (data.caves.length !== 1) caveProblems.push(`expected exactly one cave in Pradera, found ${data.caves.length}`)
for (const cave of data.caves) {
  if (cave.anchor.tx !== -26 || cave.anchor.ty !== -74) caveProblems.push(`cave anchored at (${cave.anchor.tx},${cave.anchor.ty}), expected (-26,-74)`)
  if (cave.steps === null) caveProblems.push(`cave approach (${cave.approach.tx},${cave.approach.ty}) is not reachable from the arrival`)
}
if (caveProblems.length) {
  process.stderr.write(`cave check failed:\n  ${caveProblems.join('\n  ')}\n`)
  process.exit(1)
}
process.stderr.write(`cave check: ok — ${data.caves.map(c => `(${c.anchor.tx},${c.anchor.ty}), approach (${c.approach.tx},${c.approach.ty}) at ${c.steps} steps`).join('; ')}\n`)
