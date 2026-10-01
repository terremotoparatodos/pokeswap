/**
 * Cave interiors (CAVES-3).
 *
 * The interior of a cave is a place, like its mouth (`caves.js`): authored
 * here once, as rows of characters, and read by every consumer — the
 * browser's collision and drawing, the presence service's move validation,
 * the arrivals and the guards. Nothing in it is rolled: no seed, no
 * `Math.random()`, no generation.
 *
 *   #  rock: solid, and everything outside the grid is rock too
 *   .  floor
 *   S  floor, where a player arriving from the mouth stands
 *   E  floor, the exit pad back to the cave's area
 *
 * One interior, shared by everyone who enters (no instance per player or
 * group): a cave is a persistent area, a Dungeon run is not (CAVES-1 §13).
 * It is empty on purpose — no nodes, plots, wild Pokémon, NPCs or chests.
 *
 * Dependency-free on purpose, like `caves.js`: Vite bundles it into the
 * client, Node runs it.
 */

const INITIAL = Object.freeze([
  '#####################',
  '######.........######',
  '####.............####',
  '###...............###',
  '##.................##',
  '##....###.....##...##',
  '##....###.....##...##',
  '##.................##',
  '##.................##',
  '###...............###',
  '####.............####',
  '######....S....######',
  '########.....########',
  '#########.E.#########',
  '#####################',
])

function findTile(rows, mark) {
  for (let ty = 0; ty < rows.length; ty++) {
    const tx = rows[ty].indexOf(mark)
    if (tx >= 0) return Object.freeze({ tx, ty })
  }
  throw new Error(`cave layout: no '${mark}' tile`)
}

/** Builds a frozen interior from its rows: size, arrival and exit are derived, never repeated. */
function defineInterior({ id, name, rows }) {
  const width = rows[0].length
  if (rows.some(row => row.length !== width)) throw new Error(`cave layout ${id}: rows must share one width`)
  return Object.freeze({
    id,
    name,
    width,
    height: rows.length,
    rows,
    /** Where a player entering from the mouth stands, facing into the cave. */
    arrival: Object.freeze({ ...findTile(rows, 'S'), dir: 'up' }),
    /** The exit pad: stepping on it takes that player back out. */
    exit: findTile(rows, 'E'),
  })
}

export const CAVE_INTERIORS = Object.freeze({
  'cueva-inicial': defineInterior({ id: 'cueva-inicial', name: 'Cueva de la Pradera', rows: INITIAL }),
})

/** The interior with this area id, or null when the area is not a cave interior. */
export function caveInterior(areaId) {
  return Object.hasOwn(CAVE_INTERIORS, areaId) ? CAVE_INTERIORS[areaId] : null
}

export function isCaveInterior(areaId) {
  return caveInterior(areaId) !== null
}

/** Whether a tile of a cave interior can be stood on. Outside the grid is rock. */
export function isCaveFloor(areaId, tx, ty) {
  const interior = caveInterior(areaId)
  if (!interior || !Number.isInteger(tx) || !Number.isInteger(ty)) return false
  if (tx < 0 || ty < 0 || tx >= interior.width || ty >= interior.height) return false
  return interior.rows[ty][tx] !== '#'
}

/** Whether a tile of a cave interior is its exit pad. */
export function isCaveExit(areaId, tx, ty) {
  const interior = caveInterior(areaId)
  return interior !== null && interior.exit.tx === tx && interior.exit.ty === ty
}
