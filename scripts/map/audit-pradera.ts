// MAP-1 — resource audit of Pradera Brisa, measured on the real world.
//
// Reads exactly what players get: the procedural terrain and props both sides
// run (`terrain.js`), WORLD's node layout (`resourceLayout.js`), SKILLS'
// node → resource mapping (`resourceMapping.ts`), the huerta plots, the return
// portal and the caves as the client places them. Writes counts and
// coordinates (JSON) and annotated maps (PNG) for the report.
//
//   npx vite-node scripts/map/audit-pradera.ts -- docs/design/map-1
//
// DESIGN TOOL. It reads the world and writes nothing but its output folder.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { deflateSync } from 'node:zlib'
import { Atlas } from '../../src/features/wildlands/areas/atlas'
import { areaEntrances } from '../../src/features/dungeonEntrances/domain/entranceSpawns'
import { skillsResourceFor } from '../../src/features/worldSkills/resourceMapping'
import { workDuration } from '../../src/features/skills/domain/workRules'
import { WORLD_AREAS } from '../../services/realtime/src/world/areas.js'
import { PLOTS } from '../../services/realtime/src/world/plots.js'
import { RESOURCE_VARIANTS, ZONE_RING_TILES, resourceAt } from '../../services/realtime/src/world/resourceLayout.js'
import { RESPAWN_MS } from '../../services/realtime/src/world/worldTuning.js'
import { T, decorAt, isSolidDecor, tileTerrain } from '../../services/realtime/src/world/terrain.js'
import { WORLD_VIEW_TILES } from '../../services/realtime/src/world/worldInterest.js'

type Tile = { tx: number; ty: number }
const OUT = process.argv.slice(2).find(arg => arg !== '--') ?? 'docs/design/map-1'
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

// ── Caves, placed like DungeonEntrances.vue does (same seed derivation) ─────
function seedOf(areaId: string): number {
  let hash = 0x811c9dc5
  for (let i = 0; i < areaId.length; i++) hash = Math.imul(hash ^ areaId.charCodeAt(i), 0x01000193) >>> 0
  return hash
}
const caves = areaEntrances({
  areaId: 'pradera', origin: area.arrival(null), seed: seedOf('pradera'), now: Date.now(),
  port: {
    isSolid: (tx, ty) => area.isSolid(tx, ty),
    isWater: (tx, ty) => area.isWater(tx, ty),
    isTaken: (tx, ty) => (tx === PORTAL.tx && ty === PORTAL.ty) || resourceAt('pradera', tx, ty) !== null,
  },
}).map(entrance => entrance.placement)
const caveTiles = new Set(caves.flatMap(cave => cave.footprint.map(key)))

// ── Tiles ────────────────────────────────────────────────────────────────────
type NodeClass = 'basic' | 'gated' | 'unmapped'
interface Prop extends Tile { kind: string; node: string | null; resource: string | null; level: number | null; cls: NodeClass | 'decor' }
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
    const kind = decorAt(seed, tx, ty)
    if (isSolidDecor(kind)) solid++
    if (!kind) continue
    const node = resourceAt('pradera', tx, ty)
    const resource = node ? skillsResourceFor(node) : null
    const cls = !node ? 'decor' : !resource ? 'unmapped' : resource.requiredLevel === 1 ? 'basic' : 'gated'
    props.push({ tx, ty, kind, node: node?.id ?? null, resource: resource?.id ?? null, level: resource?.requiredLevel ?? null, cls })
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

// ── Zone candidates, at the proposal's real sizes, within a short walk ──────
/** A w×h site: props of `kinds` inside, share of open ground, walking steps from the arrival to its centre. */
function site(cx: number, cy: number, w: number, h: number, kinds: Set<string>) {
  let n = 0, basic = 0, open = 0, blockedTiles = 0
  const x0 = cx - Math.floor(w / 2), y0 = cy - Math.floor(h / 2)
  for (let ty = y0; ty < y0 + h; ty++) for (let tx = x0; tx < x0 + w; tx++) {
    const kind = decorAt(seed, tx, ty)
    if (kind && kinds.has(kind)) {
      n++
      const node = resourceAt('pradera', tx, ty)
      if ((node ? skillsResourceFor(node) : null)?.requiredLevel === 1) basic++
    }
    if (!area.isSolid(tx, ty) && !area.isWater(tx, ty)) open++
    if (caveTiles.has(`${tx},${ty}`) || PLOTS.some(p => p.tx === tx && p.ty === ty) || (tx === PORTAL.tx && ty === PORTAL.ty) || area.isWater(tx, ty)) blockedTiles++
  }
  return { center: { tx: cx, ty: cy }, w, h, props: n, basicToday: basic, open: +(open / (w * h)).toFixed(2), conflicts: blockedTiles, steps: dist.get(`${cx},${cy}`) ?? Infinity }
}
function candidates(kinds: Set<string>, w: number, h: number, rank: (s: ReturnType<typeof site>) => number, accept: (s: ReturnType<typeof site>) => boolean) {
  const all: ReturnType<typeof site>[] = []
  for (let cy = spawn.ty - 34; cy <= spawn.ty + 34; cy++) for (let cx = spawn.tx - 34; cx <= spawn.tx + 34; cx++) {
    const s = site(cx, cy, w, h, kinds)
    // Keep the arrival pad and its surroundings (9×9) out of every zone, plus a 3-tile ring to walk around it.
    const clearOfArrival = Math.abs(cx - spawn.tx) > Math.floor(w / 2) + 4 + 3 || Math.abs(cy - spawn.ty) > Math.floor(h / 2) + 4 + 3
    if (Number.isFinite(s.steps) && clearOfArrival && accept(s)) all.push(s)
  }
  const pick: typeof all = []
  for (const s of all.sort((a, b) => rank(b) - rank(a) || a.steps - b.steps)) {
    if (pick.every(p => Math.max(Math.abs(p.center.tx - s.center.tx), Math.abs(p.center.ty - s.center.ty)) > 10)) pick.push(s)
    if (pick.length === 4) break
  }
  return pick
}

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
  zoneCandidates: {
    // Natural forest: most round trees (the common-tree look), still walkable, a short walk away.
    forest: candidates(new Set(['tree', 'palm']), 22, 18, s => s.props, s => s.steps <= 30 && s.open >= 0.6 && s.conflicts === 0),
    // Open meadow for an authored quarry: flat, dry, free of caves, plots and the portal, a short walk away.
    quarry: candidates(new Set(['rock']), 16, 14, s => s.open * 100 - s.steps, s => s.steps >= 10 && s.steps <= 26 && s.open >= 0.93 && s.conflicts === 0),
  },
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
const near = data.reachableBasic[24]
const today = capacityRows('today (≤24 steps)', near.trees, near.rocks, data.spacing.trees.median ?? 8, data.spacing.rocks.median ?? 8)
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

// 1 · Today: every prop, and which of them work.
const today1 = canvas()
base(today1)
for (const p of props) {
  if (p.cls === 'basic') today1.ring(p, TREE_KINDS.has(p.kind) ? [255, 255, 255] : [255, 150, 0])
  else if (p.cls === 'gated') today1.ring(p, [170, 90, 230])
  else if (p.cls === 'unmapped') today1.ring(p, [30, 30, 30])
}
today1.circle(spawn, WORLD_VIEW_TILES, [230, 40, 40])
writeFileSync(join(OUT, 'README.txt'), 'Generated by scripts/map/audit-pradera.ts. Do not edit by hand.\n')
png(today1, 'pradera-today.png')

// 2 · Reach: walking distance from the arrival, empty areas stand out.
const reachMap = canvas()
base(reachMap, true)
for (const [k, d] of dist) {
  const [tx, ty] = k.split(',').map(Number)
  if (area.isSolid(tx, ty)) continue
  const band = d <= 12 ? [255, 235, 120] : d <= 24 ? [255, 200, 90] : d <= 36 ? [240, 160, 80] : [215, 120, 80]
  if ((tx + ty) % 2 === 0) reachMap.fillTile({ tx, ty }, band as unknown as RGB, 2)
}
for (const p of props) if (p.cls === 'basic') reachMap.fillTile(p, TREE_KINDS.has(p.kind) ? [0, 120, 0] : [230, 110, 0], 1)
png(reachMap, 'pradera-reach.png')

// 3 · Proposal: the recommended forest and quarry, the huerta, reserved space.
const box = (center: Tile, w: number, h: number): [Tile, Tile] => [{ tx: center.tx - Math.floor(w / 2), ty: center.ty - Math.floor(h / 2) }, { tx: center.tx - Math.floor(w / 2) + w - 1, ty: center.ty - Math.floor(h / 2) + h - 1 }]
const forestSite = data.zoneCandidates.forest[0]
// The quarry: the shortest walk on the other side of the arrival from the forest (along x), so the two flows do not cross.
const side = Math.sign(forestSite.center.tx - spawn.tx)
const quarrySite = [...data.zoneCandidates.quarry].filter(c => Math.sign(c.center.tx - spawn.tx) !== side).sort((a, b) => a.steps - b.steps)[0]
const overlaps = (a: [Tile, Tile], b: [Tile, Tile]) => a[0].tx <= b[1].tx && b[0].tx <= a[1].tx && a[0].ty <= b[1].ty && b[0].ty <= a[1].ty
const quarryBox = box(quarrySite.center, quarrySite.w, quarrySite.h)
// Space kept for later tiers: the northern meadow toward the snow, clear of every other box.
const reserveSite = data.zoneCandidates.quarry.filter(c => c !== quarrySite && !overlaps(box(c.center, c.w, c.h), quarryBox) && !overlaps(box(c.center, c.w, c.h), [{ tx: -12, ty: -75 }, { tx: -8, ty: -70 }])).sort((a, b) => a.center.ty - b.center.ty)[0]
const huertaReserve: [Tile, Tile] = [{ tx: -12, ty: -75 }, { tx: -8, ty: -70 }]
const forestPines = (() => { const [a, b] = box(forestSite.center, forestSite.w, forestSite.h); let n = 0, open = 0; for (let ty = a.ty; ty <= b.ty; ty++) for (let tx = a.tx; tx <= b.tx; tx++) { if (decorAt(seed, tx, ty) === 'pine') n++; if (!area.isSolid(tx, ty) && !area.isWater(tx, ty) && tileTerrain(seed, tx, ty) !== T.TALL) open++ } return { pines: n, plantable: open } })()
const plan = canvas()
base(plan, true)
for (const p of props) if (p.cls === 'basic') plan.fillTile(p, TREE_KINDS.has(p.kind) ? [0, 120, 0] : [230, 110, 0], 1)
plan.rect(...box(forestSite.center, forestSite.w, forestSite.h), [0, 90, 0], 3)
plan.rect(...box(quarrySite.center, quarrySite.w, quarrySite.h), [200, 90, 0], 3)
plan.rect(...box(reserveSite.center, reserveSite.w, reserveSite.h), [120, 60, 200], 2)
plan.rect(...huertaReserve, [120, 80, 40], 2)
plan.rect({ tx: spawn.tx - 4, ty: spawn.ty - 4 }, { tx: spawn.tx + 4, ty: spawn.ty + 4 }, [220, 40, 40], 2)
plan.circle(spawn, WORLD_VIEW_TILES, [230, 40, 40])
png(plan, 'pradera-proposal.png')
writeFileSync(join(OUT, 'proposal.json'), `${JSON.stringify({ forest: { ...forestSite, box: box(forestSite.center, forestSite.w, forestSite.h), ...forestPines }, quarry: { ...quarrySite, box: box(quarrySite.center, quarrySite.w, quarrySite.h) }, reserve: { ...reserveSite, box: box(reserveSite.center, reserveSite.w, reserveSite.h) }, huertaReserve, arrivalClear: [{ tx: spawn.tx - 4, ty: spawn.ty - 4 }, { tx: spawn.tx + 4, ty: spawn.ty + 4 }] }, null, 1)}
`)

// 4 · Annotated SVGs: the same maps with labels, routes and a legend.
const cx = (tx: number) => (tx - X0 + 0.5) * PX
const cy = (ty: number) => (ty - Y0 + 0.5) * PX
const esc = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
function label(t: Tile, text: string, color = '#111', dx = 8, dy = -8) {
  return `<g font-family="sans-serif" font-size="12" font-weight="700"><text x="${cx(t.tx) + dx}" y="${cy(t.ty) + dy}" fill="#fff" stroke="#fff" stroke-width="3">${esc(text)}</text><text x="${cx(t.tx) + dx}" y="${cy(t.ty) + dy}" fill="${color}">${esc(text)}</text></g>`
}
const arrow = (a: Tile, b: Tile, color: string) => `<line x1="${cx(a.tx)}" y1="${cy(a.ty)}" x2="${cx(b.tx)}" y2="${cy(b.ty)}" stroke="${color}" stroke-width="3" stroke-dasharray="8 5" marker-end="url(#head)"/>`
function svg(pngFile: string, overlay: string, legend: [string, string][], title: string) {
  const b64 = readFileSync(join(OUT, pngFile)).toString('base64')
  const W = SIZE * PX, H = SIZE * PX, legendH = 22 + legend.length * 18
  const items = legend.map(([color, text], i) => `<rect x="12" y="${H + 30 + i * 18}" width="12" height="12" fill="${color}" stroke="#333"/><text x="30" y="${H + 40 + i * 18}" font-family="sans-serif" font-size="12">${esc(text)}</text>`).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H + legendH + 16}" viewBox="0 0 ${W} ${H + legendH + 16}">
<defs><marker id="head" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8 z" fill="#222"/></marker></defs>
<rect width="100%" height="100%" fill="#fff"/>
<image href="data:image/png;base64,${b64}" x="0" y="0" width="${W}" height="${H}" style="image-rendering:pixelated"/>
${overlay}
<text x="12" y="${H + 18}" font-family="sans-serif" font-size="13" font-weight="700">${esc(title)}</text>${items}
</svg>
`
}
const common: [string, string][] = [['#e62828', 'Llegada (spawn -5,-69); círculo = radio de vista 24'], ['#d23cdc', 'Portal a Ciudad (-5,-70)'], ['#785028', 'Huerta: 4 parcelas'], ['#3c2d28', 'Cuevas (dungeons), 3×2']]
const caveLabels = caves.map((c, i) => label(c.anchor, `Cueva ${i + 1}`, '#3c2d28', 6, 18)).join('')
writeFileSync(join(OUT, 'pradera-today.svg'), svg('pradera-today.png',
  label(spawn, 'Llegada', '#c00', 10, 22) + label(PORTAL, 'Portal', '#a0a', 10, -6) + label(PLOTS[0], 'Huerta', '#785028', -52, -6) + caveLabels
  + label({ tx: spawn.tx + 8, ty: spawn.ty - 10 }, 'Pradera abierta: casi sin recursos', '#333', 0, 0)
  + label({ tx: spawn.tx - 30, ty: spawn.ty + 26 }, 'Bosque natural (pinos = nivel 12)', '#063', 0, 0)
  + label({ tx: spawn.tx - 40, ty: spawn.ty - 40 }, 'Nieve', '#446', 0, 0) + label({ tx: spawn.tx + 36, ty: spawn.ty - 20 }, 'Mar', '#036', 0, 0),
  [...common, ['#ffffff', 'Árbol talable (nivel 1): borde blanco'], ['#ff9600', 'Roca picable (nivel 1): borde naranja'], ['#aa5ae6', 'Nodo que pide más nivel (pino 12, carbón 10, hierro 20…)'], ['#1e1e1e', 'Nodo sin recurso SKILLS (no se puede trabajar)'], ['#2d6e2d', 'Árbol / pino sin nodo (decoración idéntica)'], ['#78787d', 'Roca sin nodo']],
  'Pradera hoy — ventana 97×97 alrededor de la llegada'))
writeFileSync(join(OUT, 'pradera-reach.svg'), svg('pradera-reach.png',
  label(spawn, 'Llegada', '#c00', 10, 22)
  + label({ tx: spawn.tx - 2, ty: spawn.ty - 3 }, 'Cuello: portal + huerta + llegada', '#c00', 8, -2)
  + label({ tx: -6, ty: -64 }, 'Árbol más cercano: 7 pasos', '#060', 8, -4) + label({ tx: -5, ty: -77 }, 'Roca más cercana: 9 pasos', '#b50', 8, -4)
  + label({ tx: spawn.tx + 14, ty: spawn.ty + 4 }, 'Zona vacía', '#333', 0, 0) + label({ tx: spawn.tx - 22, ty: spawn.ty - 10 }, 'Zona vacía', '#333', 0, 0),
  [['#ffeb78', '≤ 12 pasos desde la llegada'], ['#ffc85a', '13–24 pasos'], ['#f0a050', '25–36 pasos'], ['#d77850', '37–48 pasos'], ['#007800', 'Árbol talable nivel 1'], ['#e66e00', 'Roca picable nivel 1']],
  'Pradera hoy — distancia caminando (pasos) y recursos básicos'))
writeFileSync(join(OUT, 'pradera-proposal.svg'), svg('pradera-proposal.png',
  arrow(spawn, forestSite.center, '#060') + arrow(spawn, quarrySite.center, '#b50') + arrow(spawn, reserveSite.center, '#63c')
  + label({ tx: forestSite.center.tx - 10, ty: forestSite.center.ty - 9 }, `BOSQUE 22×18 · ~60 árboles comunes · ${forestSite.steps} pasos`, '#060', 0, -4)
  + label({ tx: quarrySite.center.tx - 7, ty: quarrySite.center.ty - 7 }, `CANTERA 16×14 · ~45 rocas · ${quarrySite.steps} pasos`, '#b50', 0, -4)
  + label({ tx: reserveSite.center.tx - 7, ty: reserveSite.center.ty - 7 }, 'RESERVA: minerales de mayor nivel', '#63c', 0, -4)
  + label({ tx: -12, ty: -75 }, 'Reserva huerta', '#785028', 0, -4) + label({ tx: spawn.tx - 4, ty: spawn.ty + 4 }, 'Llegada libre 9×9', '#c00', 0, 16) + caveLabels,
  [...common, ['#005a00', 'Bosque recomendado: todo árbol redondo = Árbol común (nivel 1)'], ['#c85a00', 'Cantera recomendada: rocas colocadas, todas picables'], ['#783cc8', 'Reserva para recursos de mayor nivel'], ['#007800', 'Árboles talables hoy (referencia)'], ['#e66e00', 'Rocas picables hoy (referencia)']],
  'Propuesta recomendada — bosque, cantera y espacio reservado'))

process.stdout.write(`${JSON.stringify({ trees: data.trees, rocks: data.rocks, ratios: data.ratios, nearestBasicTrees: data.nearestBasicTrees.slice(0, 2), nearestBasicRocks: data.nearestBasicRocks.slice(0, 2), spacing: data.spacing, reachableBasic: data.reachableBasic, caves: data.caves, plots: data.plots, forest: data.zoneCandidates.forest, quarry: data.zoneCandidates.quarry, today, alternatives }, null, 1)}\n`)
