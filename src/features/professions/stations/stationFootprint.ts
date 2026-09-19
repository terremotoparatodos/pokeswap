// What a station occupies on the ground (R33).
//
// F-1 shipped `PlacedObject.footprint` as a list of tiles and `placedObject()`
// expanded a `width`/`depth` rectangle into it, but nothing ever placed
// anything bigger than one tile, so no rule downstream had been exercised with
// a real multi-tile object. R33 places a 2×2 furnace, which means the *shape*
// needs a contract of its own rather than two numbers passed around.
//
// A footprint here is a set of offsets from the anchor, so a non-rectangular
// object needs no new concept: an L-shaped forge or a 4×3 house with a porch
// is a different list, not a different type. Rectangles get a constructor
// (`rectFootprint`) and irregular shapes get a mask (`maskFootprint`), and
// both produce the same thing.
//
// Conventions, taken from F-1 and kept identical so nothing downstream shifts:
//   - the anchor is the **front-left** tile of the shape, and is always one of
//     its cells: `{ dx: 0, dy: 0 }` is in every footprint;
//   - depth grows **northwards** (−ty), the direction the art grows on screen;
//   - `dx` may be negative, because a shape wider at the back than at the front
//     (an anvil, a lean-to) still has to anchor on a front tile.
//
// This module is pure data and arithmetic. It knows nothing about the engine,
// the renderer, Vue, an area or a city: it is the shape, and whoever places a
// station decides where.

/** One cell of a footprint, as an offset from the anchor tile. */
export interface FootprintCell {
  /** Tiles east of the anchor; negative reaches west, for shapes wider behind. */
  readonly dx: number
  /** Tiles **north** of the anchor (≥ 0), matching F-1's `ty - dy`. */
  readonly dy: number
}

export interface StationFootprint {
  /** Every cell the station stands on, anchor first. */
  readonly cells: readonly FootprintCell[]
  /** Bounding width in tiles. */
  readonly width: number
  /** Bounding depth in tiles. */
  readonly depth: number
}

const key = (dx: number, dy: number): string => `${dx}:${dy}`

/** Builds a footprint from a de-duplicated cell list, anchor first. Throws on a shape no placement could honour. */
function build(cells: readonly FootprintCell[]): StationFootprint {
  const seen = new Set<string>()
  const out: FootprintCell[] = []
  for (const cell of cells) {
    if (!Number.isInteger(cell.dx) || !Number.isInteger(cell.dy) || cell.dy < 0) {
      throw new RangeError(`footprint cell must be whole, and never behind the front row, got ${cell.dx},${cell.dy}`)
    }
    const id = key(cell.dx, cell.dy)
    if (seen.has(id)) continue
    seen.add(id)
    out.push({ dx: cell.dx, dy: cell.dy })
  }
  if (!seen.has(key(0, 0))) throw new RangeError('a footprint must include its own anchor cell (0,0)')
  const xs = out.map(cell => cell.dx)
  return {
    cells: out.sort((a, b) => a.dy - b.dy || a.dx - b.dx),
    width: Math.max(...xs) - Math.min(...xs) + 1,
    depth: Math.max(...out.map(cell => cell.dy)) + 1,
  }
}

/** The common case: a solid `width × depth` rectangle anchored at its front-left tile. */
export function rectFootprint(width: number, depth: number): StationFootprint {
  if (!Number.isInteger(width) || !Number.isInteger(depth) || width < 1 || depth < 1) {
    throw new RangeError(`footprint size must be a whole number of tiles above zero, got ${width}×${depth}`)
  }
  const cells: FootprintCell[] = []
  for (let dy = 0; dy < depth; dy++) for (let dx = 0; dx < width; dx++) cells.push({ dx, dy })
  return build(cells)
}

/**
 * An arbitrary shape, drawn as rows of text. The **last** row is the front
 * (dy = 0), so the mask reads the way the object looks on screen:
 *
 * ```ts
 * maskFootprint([' # ', '###', ' # '])   // a cross-shaped forge
 * ```
 *
 * Any non-space character is a cell. The anchor is placed on the leftmost cell
 * of the **front** row, so the drawing does not have to be arranged around it:
 * the cross above anchors on its single front cell and its middle row reaches
 * one tile west, which is what `dx` being signed is for.
 */
export function maskFootprint(rows: readonly string[]): StationFootprint {
  const cells: FootprintCell[] = []
  for (let row = 0; row < rows.length; row++) {
    const dy = rows.length - 1 - row
    for (let dx = 0; dx < rows[row].length; dx++) if (rows[row][dx] !== ' ') cells.push({ dx, dy })
  }
  if (!cells.length) throw new RangeError('a footprint mask must mark at least one cell')
  const front = cells.filter(cell => cell.dy === 0)
  if (!front.length) throw new RangeError('a footprint mask must mark at least one cell in its front row')
  const origin = Math.min(...front.map(cell => cell.dx))
  return build(cells.map(cell => ({ dx: cell.dx - origin, dy: cell.dy })))
}

/** The single-tile footprint every pre-R33 placed object had. */
export const SINGLE_TILE: StationFootprint = rectFootprint(1, 1)

export interface FootprintTile {
  readonly tx: number
  readonly ty: number
}

/** The tiles this footprint covers when anchored at `anchor`. */
export function footprintTiles(footprint: StationFootprint, anchor: FootprintTile): FootprintTile[] {
  return footprint.cells.map(cell => ({ tx: anchor.tx + cell.dx, ty: anchor.ty - cell.dy }))
}

/** True when the footprint anchored at `anchor` covers this tile. */
export function footprintCovers(footprint: StationFootprint, anchor: FootprintTile, tx: number, ty: number): boolean {
  return footprint.cells.some(cell => anchor.tx + cell.dx === tx && anchor.ty - cell.dy === ty)
}

/**
 * Where the art's feet go: the horizontal middle of the **front row**, in
 * tile units. A 1×1 footprint answers `anchor.tx + 0.5`, exactly what the
 * renderer already computed, so single-tile objects do not move.
 */
export function footprintFeet(footprint: StationFootprint, anchor: FootprintTile): { readonly x: number; readonly y: number } {
  const front = footprint.cells.filter(cell => cell.dy === 0)
  const minDx = Math.min(...front.map(cell => cell.dx))
  const maxDx = Math.max(...front.map(cell => cell.dx))
  return { x: anchor.tx + (minDx + maxDx + 1) / 2, y: anchor.ty }
}

/**
 * The tiles a player can stand on to use the station: the orthogonal ring
 * around the whole shape, never a tile the shape itself covers. Ordered so the
 * result is stable for tests and for a future server that has to pick one.
 */
export function footprintRing(footprint: StationFootprint, anchor: FootprintTile): FootprintTile[] {
  const inside = new Set(footprintTiles(footprint, anchor).map(tile => key(tile.tx, tile.ty)))
  const seen = new Set<string>()
  const out: FootprintTile[] = []
  for (const tile of footprintTiles(footprint, anchor)) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const next = { tx: tile.tx + dx, ty: tile.ty + dy }
      const id = key(next.tx, next.ty)
      if (inside.has(id) || seen.has(id)) continue
      seen.add(id)
      out.push(next)
    }
  }
  return out
}

/**
 * The footprint tile closest to a point, in **Manhattan** distance; ties go to
 * the first in order.
 *
 * Manhattan because every rule that consumes this is orthogonal — walking, the
 * approach ring, the one-step interaction check. Chebyshev would let a
 * diagonal tile win a tie and make an adjacent caller look two steps away.
 */
export function nearestFootprintTile(footprint: StationFootprint, anchor: FootprintTile, tx: number, ty: number): FootprintTile {
  const tiles = footprintTiles(footprint, anchor)
  let best = tiles[0]
  let bestDistance = Infinity
  for (const tile of tiles) {
    const distance = Math.abs(tile.tx - tx) + Math.abs(tile.ty - ty)
    if (distance < bestDistance) {
      bestDistance = distance
      best = tile
    }
  }
  return best
}
