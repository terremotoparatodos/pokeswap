/**
 * Caves of the shared world (CAVES-2).
 *
 * A cave is a place, not a roll: its mouth is authored here once, with a
 * stable id and fixed tiles, and every consumer reads it from this file —
 * the browser's collision and drawing, the service's terrain, the map tools
 * and the guards. Nothing derives a cave from a seed, a scan or the order in
 * which components mount (the procedural placement it replaces did all three,
 * see docs/design/CAVES_1_AUDIT.md §1.2).
 *
 * A Cave is not a Dungeon (CAVES-1 §13, D1): this is the permanent mouth in
 * the world. Pradera has exactly one. Since CAVES-3 its entrance is `open`:
 * the mouth tile is the portal to the interior (`caveLayouts.js`), and the
 * rest of the footprint stays rock. A `closed` entrance keeps the whole
 * footprint rock, mouth included.
 *
 * Geometry, for the only orientation there is (`facing: 'down'`):
 *
 *   ty-1   R R R    R = rock (footprint, solid)
 *   ty     R M R    M = mouth: the portal tile when open, rock when closed
 *   ty+1   . A .    A = approach: where the player stands, and lands on exit
 *   ty+2   . . .    the front clearance (3×3, includes A): kept free of
 *   ty+3   . . .    props, nodes, plots, portals, work stands and wild homes
 *
 * The anchor is the front-left tile and the rock grows northwards, the rule
 * every placed object in the engine follows.
 *
 * Dependency-free on purpose, like `resourceZones.js`: Vite bundles it into
 * the client, Node runs it.
 */

/** Whether a cave can be entered. */
export const CAVE_ENTRANCE = Object.freeze({ CLOSED: 'closed', OPEN: 'open' })

/** How far the kept-free ground reaches in front of the mouth, and how wide it is. */
export const CAVE_CLEARANCE = Object.freeze({ width: 3, depth: 3 })

const tile = (tx, ty) => Object.freeze({ tx, ty })

/** Builds a frozen cave record: the authored facts plus every tile derived from them. */
function defineCave({ id, areaId, anchor, width, depth, facing, interiorAreaId, entrance }) {
  if (facing !== 'down') throw new Error(`cave ${id}: only 'down' is supported`)
  if (width % 2 !== 1 || width < 3 || depth < 2) throw new Error(`cave ${id}: needs an odd width ≥ 3 and a depth ≥ 2`)
  const footprint = []
  for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) footprint.push(tile(anchor.tx + dx, anchor.ty - dy))
  const centre = anchor.tx + Math.floor(width / 2)
  const clearance = []
  for (let dy = 1; dy <= CAVE_CLEARANCE.depth; dy++) {
    for (let dx = -Math.floor(CAVE_CLEARANCE.width / 2); dx <= Math.floor(CAVE_CLEARANCE.width / 2); dx++) clearance.push(tile(centre + dx, anchor.ty + dy))
  }
  return Object.freeze({
    id,
    areaId,
    anchor: tile(anchor.tx, anchor.ty),
    width,
    depth,
    facing,
    /** Every tile the rock covers, front row first. */
    footprint: Object.freeze(footprint),
    /** The front-row centre: the portal when the entrance is open, rock when it is closed. */
    mouth: tile(centre, anchor.ty),
    /** The walkable tile in front of the mouth. */
    approach: tile(centre, anchor.ty + 1),
    /** The ground kept free in front of the mouth (includes the approach). */
    clearance: Object.freeze(clearance),
    /** The shared interior area the mouth leads to (`caveLayouts.js`). */
    interiorAreaId,
    entrance,
  })
}

export const CAVES = Object.freeze([
  defineCave({
    id: 'pradera-cueva-inicial',
    areaId: 'pradera',
    anchor: { tx: -26, ty: -74 },
    width: 3,
    depth: 2,
    facing: 'down',
    interiorAreaId: 'cueva-inicial',
    entrance: CAVE_ENTRANCE.OPEN,
  }),
])

const key = (areaId, tx, ty) => `${areaId}:${tx}:${ty}`
const isOpenMouth = (cave, t) => cave.entrance === CAVE_ENTRANCE.OPEN && t.tx === cave.mouth.tx && t.ty === cave.mouth.ty
const ROCK = new Set(CAVES.flatMap(cave => cave.footprint.filter(t => !isOpenMouth(cave, t)).map(t => key(cave.areaId, t.tx, t.ty))))
const RESERVED = new Set(CAVES.flatMap(cave => [...cave.footprint, ...cave.clearance].map(t => key(cave.areaId, t.tx, t.ty))))

/** The caves whose mouth is in an area. */
export function cavesIn(areaId) {
  return CAVES.filter(cave => cave.areaId === areaId)
}

/**
 * Whether a tile is cave rock: the footprint, except the mouth of an open
 * entrance, which is the portal (the only tile that lets anyone through).
 */
export function isCaveRock(areaId, tx, ty) {
  return ROCK.has(key(areaId, tx, ty))
}

/** Whether a tile belongs to a cave's footprint or its front clearance: nothing else may be placed there. */
export function isCaveReserved(areaId, tx, ty) {
  return RESERVED.has(key(areaId, tx, ty))
}

/** The cave whose interior is this area, or null. */
export function caveByInterior(areaId) {
  return CAVES.find(cave => cave.interiorAreaId === areaId) ?? null
}

/** Whether a tile is the mouth of an open cave in this area: the only tile that leads inside. */
export function isCaveMouth(areaId, tx, ty) {
  return CAVES.some(cave => cave.areaId === areaId && isOpenMouth(cave, { tx, ty }))
}
