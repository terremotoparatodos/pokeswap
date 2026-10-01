/**
 * Ciudad Corazón — the navigation facts of the town (CAVES-4).
 *
 * The town is hand-laid art the browser draws (`areas/hearthome.ts`), but where
 * a player can stand is not art: it is decided here once and read by both
 * sides. The browser's `TownArea` builds its collision from these facts with
 * `townCollision()`, and the presence service validates every step and every
 * gate against the same grid. Names, blurbs, sprites, sign texts and
 * residents stay in the browser: nothing here is drawn.
 *
 * Dependency-free on purpose, like `caves.js` and `caveLayouts.js`: Vite
 * bundles it into the client, Node runs it.
 */

export const TOWN_AREA_ID = 'ciudad-corazon'

/**
 * One character per 16 px tile (64 × 51): s street, g grass, p plaza paving,
 * t forest (solid). Hand-traced from the reference image; buildings and props
 * stand on top. Regenerate rather than hand-editing large areas.
 */
export const TOWN_TERRAIN = Object.freeze([
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttttttttttttttttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttttttssssssssssstttttttttttttggggggtttttttt',
  'ttttttttggggggttttttttgggsssssssssssssggttttttttttggggggtttttttt',
  'ttttttttggggggttttttttggsssssssssssssssgttttttttttggggggtttttttt',
  'ttttttttggggggttttttttggsssssssssssssssgttttttttttggggggtttttttt',
  'ttttttttggggggggttttttggsssssssssssssssgttttttttggggggggtttttttt',
  'ttttttttggggggggggggggggsssssssssssssssgggggggggggggggggtttttttt',
  'ttttttttgggggggsssssssggsssssssssssssssggssssssgggggggggtttttttt',
  'ttttttgggssssssssssssssssssssssssssssssssssssssssgggggssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssgggsssggtttttt',
  'ttttttggsssssssssssssssssssssssssssssssssssssssssssgssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggggssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttgggggsssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttgggggsssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggggssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttgggsssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttggssssssssssssssssssssssssssssssssssssssssssssssssggtttttt',
  'ttttttttttttttttttsssssssssssssssssssssssssssssssssstttttttttttt',
  'ttttttttttttttttttsssssssssssssssssssssssssssssssssstttttttttttt',
  'ttttttttttttttttttsssssssssssssssssssssssssssssssssstttttttttttt',
  'ttttttttttttttttttsssssssssssssssssssssssssssssssssstttttttttttt',
  'ggggggttttttttttttssssssssssssssssssssssssssssssssssttttttgggggg',
  'ggggggttttttttttttssssssssssssssssssssssssssssssssssttttttgggggg',
  'gggggggggggggggggggggsssssssssssssssssssssssgggggggggsgggggggggg',
  'ggggggggppppppppppppgsssssssssssssssssssssssgppppppppppppppppppp',
  'ggggggggppppppppppppgsssssssssssssssssssssssgppppppppppppppppppp',
  'ggggggttppppppttppppgsssssssssssssssssssssssgppppppppppppppppppp',
  'ttttttttpppppptttttttttttttttttttttttttttttttttttttttttttttttttt',
  'ttttttttsspppptttttttttttttttttttttttttttttttttttttttttttttttttt',
  'ttttttttsssspptttttttttttttttttttttttttttttttttttttttttttttttttt',
  'ttttttttsssssstttttttttttttttttttttttttttttttttttttttttttttttttt',
  'ttttttttsssssstttttttttttttttttttttttttttttttttttttttttttttttttt',
  // Two rows under the south gate: its outer stair stays inside the map.
  'ttttttttsssssstttttttttttttttttttttttttttttttttttttttttttttttttt',
  'ttttttttsssssstttttttttttttttttttttttttttttttttttttttttttttttttt',
])

/** First join, the "Ciudad" recall from the cave and the recall inside the town. */
export const TOWN_SPAWN = Object.freeze({ tx: 31, ty: 20, dir: 'down' })

const tile = (tx, ty) => Object.freeze({ tx, ty })

/**
 * Building footprints: top-left tile plus width and depth. `open` tiles of the
 * footprint stay walkable (stairs); `door` is the walkable threshold that
 * opens a feature. Entering a building is not a change of area.
 */
export const TOWN_BUILDINGS = Object.freeze([
  { id: 'contest', x: 26, y: 7, w: 10, d: 8, door: tile(31, 14) },
  { id: 'amityL', x: 8, y: 1, w: 6, d: 9, open: Object.freeze([tile(10, 9), tile(11, 9)]) },
  { id: 'amityR', x: 50, y: 1, w: 6, d: 9, open: Object.freeze([tile(52, 9), tile(53, 9)]) },
  { id: 'gateW', x: 0, y: 38, w: 6, d: 6 },
  { id: 'gateE', x: 58, y: 38, w: 6, d: 6 },
  { id: 'gateS', x: 9, y: 44, w: 5, d: 7 },
  { id: 'pokecenter', x: 15, y: 15, w: 5, d: 5, door: tile(17, 19) },
  { id: 'house1', x: 21, y: 15, w: 4, d: 5 },
  { id: 'apt1', x: 36, y: 13, w: 5, d: 7 },
  { id: 'gym', x: 48, y: 14, w: 7, d: 6, door: tile(51, 19) },
  { id: 'fanclub', x: 10, y: 26, w: 4, d: 4, door: tile(11, 29) },
  { id: 'house2', x: 23, y: 25, w: 4, d: 5 },
  { id: 'mart', x: 28, y: 26, w: 4, d: 4, door: tile(29, 29) },
  { id: 'poffin', x: 37, y: 26, w: 7, d: 4, door: tile(40, 29) },
  { id: 'apt2', x: 44, y: 23, w: 5, d: 7 },
].map(building => Object.freeze(building)))

/** Fountain basins, inclusive tile rectangles. Solid. */
export const TOWN_FOUNTAINS = Object.freeze([
  Object.freeze({ x0: 19, y0: 35, x1: 22, y1: 37 }),
  Object.freeze({ x0: 27, y0: 35, x1: 30, y1: 37 }),
  Object.freeze({ x0: 47, y0: 35, x1: 50, y1: 37 }),
])

/** Prop kinds that block their tiles. Anything else (fountain spray) is decoration. */
export const TOWN_SOLID_PROP_KINDS = Object.freeze(['lamp', 'sign', 'hedge', 'fenceH', 'fenceV', 'bench', 'benchLeft'])

/** Footprint in tiles from a prop's (tx, ty); anything not listed is one tile. */
export const TOWN_PROP_SIZE = Object.freeze({
  bench: Object.freeze({ w: 1, d: 2 }),
  benchLeft: Object.freeze({ w: 1, d: 2 }),
})

const ONE_TILE = Object.freeze({ w: 1, d: 1 })

export function townPropSize(kind) {
  return Object.hasOwn(TOWN_PROP_SIZE, kind) ? TOWN_PROP_SIZE[kind] : ONE_TILE
}

/** The tiles a prop covers. */
export function townPropTiles(prop) {
  const { w, d } = townPropSize(prop.kind)
  const out = []
  for (let dy = 0; dy < d; dy++) for (let dx = 0; dx < w; dx++) out.push({ tx: prop.tx + dx, ty: prop.ty + dy })
  return out
}

// Hedge columns [x, y0, y1] and rows [y, x0, x1]; fence rows and columns likewise.
const HEDGE_RUNS = [
  [14, 17, 19], [20, 17, 19], [25, 17, 19], [35, 17, 19], [41, 17, 19], [55, 17, 19],
  [8, 24, 29], [16, 24, 29], [22, 26, 29], [27, 26, 29], [32, 26, 29], [49, 26, 29],
  [35, 35, 37], [43, 35, 37],
]
// The row in front of the fountain block stops short of the Casino.
const HEDGE_ROWS = [[29, 33, 36]]
// The north-east fence stops short of the gym, leaving the walk up to the Amity Square lawn.
const FENCE_ROWS = [[13, 14, 22], [13, 41, 45], [7, 23, 25], [7, 37, 39], [34, 18, 35], [34, 43, 51]]
const FENCE_COLS = [[23, 8, 12], [39, 8, 12], [7, 14, 33], [56, 14, 33]]
const LAMPS = [[8, 15], [14, 15], [28, 18], [34, 18], [41, 15], [47, 15], [8, 23], [55, 23], [8, 33], [55, 33], [36, 35], [42, 35], [23, 42], [41, 42]]
/** Signs by key; the browser gives each one its text. */
const SIGNS = [
  ['amity-west', 13, 11], ['amity-east', 50, 11], ['welcome', 28, 15], ['fountains', 21, 29],
  ['casino', 36, 28], ['gym', 46, 18], ['west-south-gates', 14, 40], ['east-gate', 50, 39],
]

/**
 * Every street prop, in the order the town has always listed them (hedges,
 * fences, lamps, benches, signs, then the activity board). Signs carry a `key`.
 */
export const TOWN_PROPS = Object.freeze((() => {
  const out = []
  for (const [x, y0, y1] of HEDGE_RUNS) for (let y = y0; y <= y1; y++) out.push({ kind: 'hedge', tx: x, ty: y })
  for (const [y, x0, x1] of HEDGE_ROWS) for (let x = x0; x <= x1; x++) out.push({ kind: 'hedge', tx: x, ty: y })
  for (const [y, x0, x1] of FENCE_ROWS) for (let x = x0; x <= x1; x++) out.push({ kind: 'fenceH', tx: x, ty: y })
  for (const [x, y0, y1] of FENCE_COLS) for (let y = y0; y <= y1; y++) out.push({ kind: 'fenceV', tx: x, ty: y })
  for (const [tx, ty] of LAMPS) out.push({ kind: 'lamp', tx, ty })
  // Two benches end to end beside each pair of fountains, backs to the water (Platinum's layout).
  for (const ty of [35, 37]) out.push({ kind: 'bench', tx: 33, ty }, { kind: 'benchLeft', tx: 45, ty })
  for (const [key, tx, ty] of SIGNS) out.push({ kind: 'sign', tx, ty, key })
  // Next to the Pokémon Center: the activity board.
  out.push({ kind: 'sign', tx: 13, ty: 19, key: 'activity-board', board: true })
  return out.map(prop => Object.freeze(prop))
})())

/**
 * Gates: stepping on any of `tiles` leads to `to`, and coming back through the
 * gate lands on `arrival` (never a gate tile, so arriving cannot loop). Only
 * the Pradera gate leads to a shared area; the others are local trips the
 * client refuses while presence is on ("llegará próximamente").
 */
export const TOWN_GATES = Object.freeze([
  { to: 'tundra', tiles: [tile(10, 9), tile(11, 9)], arrival: { tx: 10, ty: 11, dir: 'down' } },
  { to: 'costa', tiles: [tile(52, 9), tile(53, 9)], arrival: { tx: 53, ty: 11, dir: 'down' } },
  { to: 'pradera', tiles: [tile(6, 41), tile(6, 42)], arrival: { tx: 8, ty: 41, dir: 'right' } },
  { to: 'bosque', tiles: [tile(57, 41), tile(57, 42)], arrival: { tx: 55, ty: 41, dir: 'left' } },
  { to: 'desierto', tiles: [tile(10, 42), tile(11, 42)], arrival: { tx: 11, ty: 40, dir: 'up' } },
].map(gate => Object.freeze({ to: gate.to, tiles: Object.freeze(gate.tiles), arrival: Object.freeze(gate.arrival) })))

/**
 * The collision grid of a town: 1 solid, 0 walkable, row-major. Forest
 * terrain, building footprints (minus their open tiles and doors), fountains
 * and solid props block; gate tiles are always open. The one rule both the
 * browser's `TownArea` and the presence service use, for this town and for any
 * other town definition (the city lab's).
 *
 * @param {{ terrain: readonly string[], buildings: readonly { x: number, y: number, w: number, d: number, open?: readonly { tx: number, ty: number }[], door?: { tx: number, ty: number } }[], fountains: readonly { x0: number, y0: number, x1: number, y1: number }[], props: readonly { kind: string, tx: number, ty: number }[], gates: readonly { tiles: readonly { tx: number, ty: number }[] }[] }} def
 * @returns {Uint8Array}
 */
export function townCollision(def) {
  const width = def.terrain[0].length
  const height = def.terrain.length
  const solid = new Uint8Array(width * height)
  const mark = (tx, ty, value) => {
    if (tx >= 0 && ty >= 0 && tx < width && ty < height) solid[ty * width + tx] = value
  }
  for (let ty = 0; ty < height; ty++) {
    for (let tx = 0; tx < width; tx++) if (def.terrain[ty][tx] === 't') mark(tx, ty, 1)
  }
  for (const b of def.buildings) {
    for (let ty = b.y; ty < b.y + b.d; ty++) for (let tx = b.x; tx < b.x + b.w; tx++) mark(tx, ty, 1)
    for (const t of b.open ?? []) mark(t.tx, t.ty, 0)
    if (b.door) mark(b.door.tx, b.door.ty, 0)
  }
  for (const f of def.fountains) {
    for (let ty = f.y0; ty <= f.y1; ty++) for (let tx = f.x0; tx <= f.x1; tx++) mark(tx, ty, 1)
  }
  for (const p of def.props) if (TOWN_SOLID_PROP_KINDS.includes(p.kind)) for (const t of townPropTiles(p)) mark(t.tx, t.ty, 1)
  for (const gate of def.gates) for (const t of gate.tiles) mark(t.tx, t.ty, 0)
  return solid
}

export const TOWN_WIDTH = TOWN_TERRAIN[0].length
export const TOWN_HEIGHT = TOWN_TERRAIN.length

const SOLID = townCollision({ terrain: TOWN_TERRAIN, buildings: TOWN_BUILDINGS, fountains: TOWN_FOUNTAINS, props: TOWN_PROPS, gates: TOWN_GATES })

/** Whether a Ciudad Corazón tile can be stood on. Outside the map is solid. */
export function isTownWalkable(tx, ty) {
  if (!Number.isInteger(tx) || !Number.isInteger(ty)) return false
  if (tx < 0 || ty < 0 || tx >= TOWN_WIDTH || ty >= TOWN_HEIGHT) return false
  return SOLID[ty * TOWN_WIDTH + tx] === 0
}

/** The gate whose tiles include this one, or null. */
export function townGateAt(tx, ty) {
  return TOWN_GATES.find(gate => gate.tiles.some(t => t.tx === tx && t.ty === ty)) ?? null
}

/** Whether a tile is a building door: a walkable threshold that opens a feature, not a portal. */
export function isTownDoor(tx, ty) {
  return TOWN_BUILDINGS.some(b => b.door !== undefined && b.door.tx === tx && b.door.ty === ty)
}
