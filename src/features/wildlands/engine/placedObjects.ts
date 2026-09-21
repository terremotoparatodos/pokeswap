// Placed objects — things put in the world on purpose (F-1).
//
// The world derives its terrain and its props from a seed, so nothing can be
// *added* to it: a bench drawn by a `SceneOverlay` is art over a tile that the
// engine still believes is empty grass. That is F-1 — the player walks through
// the Alchemy bench, navigation crosses it, and a future server would have
// nothing to validate a position against.
//
// This registry is the missing physical layer: a small list of objects that
// occupy tiles in an area. It answers three questions and nothing else:
//
//   - is this tile taken?            → solidity, movement, pathfinding
//   - what object is on this tile?   → interaction, and a tap that lands on it
//   - what is in this area?          → a renderer or a tool that wants to look
//
// What it is NOT: it does not draw (that stays in `SceneOverlay`), it does not
// decide what an interaction *does* (that stays in the feature that owns the
// object), and it does not derive the procedural props — those keep coming
// from the world's own seed and are never copied in here.
//
// Pure and synchronous: plain data, no timers, no callbacks, no DOM. A future
// server can hold the same records, which is the point of keeping it this way.

import type { Tile } from './pathfinding'

/**
 * What kind of thing was placed; the feature that owns it gives it meaning.
 *
 * `dungeonEntrance` is a cave mouth: solid like any other rock, and used from
 * the tile in front of it. It belongs here rather than in the dungeon feature
 * because this registry is the one physical layer — a cave that the navigator
 * could walk through would be art, not a place.
 */
export type PlacedObjectKind = 'alchemyTable' | 'smelter' | 'campfire' | 'workbench' | 'dungeonEntrance'

/**
 * Where a tap on this object's art lands, in world pixels around its feet.
 *
 * Declared by whoever places the object, because only it knows how tall its
 * art is: a bench, a smelter and a house each answer for their own silhouette.
 * Optional — an object without one is only reached through its own tiles, and
 * never takes a tap away from the ground around it.
 */
export interface TapHitbox {
  /** Width of the art, centred on the feet unless `offsetX` says otherwise. */
  readonly width: number
  /** How far the art rises above the feet. */
  readonly height: number
  readonly offsetX?: number
}

export interface PlacedObject {
  readonly id: string
  readonly areaId: string
  /** The tile the object is anchored to: its front-bottom tile. */
  readonly anchor: Tile
  /**
   * Every tile it occupies. A list rather than a size, so a 2×2 smelter, a 4×3
   * house or an irregular shape are all the same kind of thing here (R33).
   */
  readonly footprint: readonly Tile[]
  /** Blocks movement, navigation and placement. */
  readonly solid: boolean
  /** Can be used from an orthogonally adjacent tile. */
  readonly interactive: boolean
  readonly kind: PlacedObjectKind
  /** The art's own reach for a tap; absent means "just my tiles". */
  readonly hitbox?: TapHitbox
}

/**
 * A footprint cell, as an offset from the anchor: east and **north**, matching
 * the `ty - dy` rule below. A shape given as cells needs no engine change per
 * object, so an L-shaped forge is a different list, not a different type.
 */
export interface FootprintCell {
  readonly dx: number
  readonly dy: number
}

export interface PlacedObjectSpec {
  readonly id: string
  readonly areaId: string
  readonly anchor: Tile
  readonly kind: PlacedObjectKind
  readonly solid?: boolean
  readonly interactive?: boolean
  /** Tiles wide and deep. The anchor is the front-left tile. Ignored when `cells` is given. */
  readonly width?: number
  readonly depth?: number
  /** An arbitrary shape, when a rectangle is not one. Must include its own anchor cell. */
  readonly cells?: readonly FootprintCell[]
  readonly hitbox?: TapHitbox
}

/** Builds the record, expanding `cells` — or `width`/`depth` — into the tiles it covers. */
export function placedObject(spec: PlacedObjectSpec): PlacedObject {
  const footprint = spec.cells?.length ? cellFootprint(spec) : rectangleFootprint(spec)
  return {
    id: spec.id,
    areaId: spec.areaId,
    anchor: spec.anchor,
    footprint,
    solid: spec.solid ?? true,
    interactive: spec.interactive ?? true,
    kind: spec.kind,
    hitbox: spec.hitbox,
  }
}

// The anchor is the front row, so a deeper object grows northwards (-ty), the
// same direction its art grows on screen.
function rectangleFootprint(spec: PlacedObjectSpec): Tile[] {
  const width = Math.max(1, Math.trunc(spec.width ?? 1))
  const depth = Math.max(1, Math.trunc(spec.depth ?? 1))
  const tiles: Tile[] = []
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) tiles.push({ tx: spec.anchor.tx + dx, ty: spec.anchor.ty - dy })
  }
  return tiles
}

/**
 * An explicit shape. Duplicates are dropped and the anchor is always included,
 * so a malformed list can never produce an object that stands on nothing.
 */
function cellFootprint(spec: PlacedObjectSpec): Tile[] {
  const seen = new Set<string>()
  const tiles: Tile[] = []
  for (const cell of [{ dx: 0, dy: 0 }, ...(spec.cells ?? [])]) {
    const dx = Math.trunc(cell.dx)
    const dy = Math.trunc(cell.dy)
    const key = `${dx}:${dy}`
    if (seen.has(key)) continue
    seen.add(key)
    tiles.push({ tx: spec.anchor.tx + dx, ty: spec.anchor.ty - dy })
  }
  return tiles
}

/**
 * The **front-centre** of a footprint in world pixels: where the art's feet
 * go, and where a tap hitbox is projected from.
 *
 * A one-tile object answers the middle of its own tile, exactly what the
 * renderer computed before, so nothing already placed moves. A 2×2 object
 * answers the middle of its two front tiles, which is where its sprite is
 * actually standing — the correction multi-tile art needs.
 */
export function placedFeet(object: PlacedObject, tile: number): { readonly x: number; readonly y: number } {
  const frontTy = Math.max(...object.footprint.map(cell => cell.ty))
  const front = object.footprint.filter(cell => cell.ty === frontTy)
  const minTx = Math.min(...front.map(cell => cell.tx))
  const maxTx = Math.max(...front.map(cell => cell.tx))
  return { x: (minTx + maxTx + 1) / 2 * tile, y: frontTy * tile + tile - 2 }
}

/**
 * The footprint tile nearest a point, in **Manhattan** distance.
 *
 * A tap on a wide object answers with its anchor, which for a 2×2 furnace can
 * be three steps from the player standing at its other corner — far enough
 * that an adjacency check would refuse an interaction that is plainly
 * adjacent. Retargeting to the nearest tile of the same object fixes that for
 * every shape at once, without anyone hardcoding a size.
 *
 * Manhattan and not Chebyshev, because that is the metric every rule
 * downstream uses: walking, `besidePlaced` and the one-step interaction check
 * are all orthogonal. Under Chebyshev a diagonal tile ties with an orthogonal
 * one and can win, and the caller is then one *diagonal* step away — which
 * reads as adjacent and is refused.
 */
export function nearestTile(object: PlacedObject, tx: number, ty: number): Tile {
  let best = object.footprint[0]
  let bestDistance = Infinity
  for (const tile of object.footprint) {
    const distance = Math.abs(tile.tx - tx) + Math.abs(tile.ty - ty)
    if (distance < bestDistance) {
      bestDistance = distance
      best = tile
    }
  }
  return best
}

/** The four orthogonal tiles around a footprint, where a player can stand. */
export function besidePlaced(object: PlacedObject): Tile[] {
  const inside = new Set(object.footprint.map(tile => `${tile.tx}:${tile.ty}`))
  const out: Tile[] = []
  const seen = new Set<string>()
  for (const tile of object.footprint) {
    for (const [dx, dy] of [[0, 1], [0, -1], [1, 0], [-1, 0]] as const) {
      const next = { tx: tile.tx + dx, ty: tile.ty + dy }
      const key = `${next.tx}:${next.ty}`
      if (inside.has(key) || seen.has(key)) continue
      seen.add(key)
      out.push(next)
    }
  }
  return out
}

/**
 * The objects placed in the world right now.
 *
 * Registration is by id, so re-registering the same object replaces it instead
 * of leaving a ghost. Areas are independent: leaving one and coming back must
 * not inherit what the other had placed, which is what `clearArea` is for.
 */
export class PlacedObjects {
  private readonly byId = new Map<string, PlacedObject>()
  private readonly byArea = new Map<string, readonly PlacedObject[]>()

  private invalidateAreas(): void {
    this.byArea.clear()
  }

  /** Adds the object, replacing any earlier one with the same id. */
  register(object: PlacedObject): void {
    this.byId.set(object.id, object)
    this.invalidateAreas()
  }

  /** Removes one object. Unknown ids are ignored, so cleanup is idempotent. */
  unregister(id: string): void {
    if (this.byId.delete(id)) this.invalidateAreas()
  }

  /** Drops everything placed in one area (used when that area is left). */
  clearArea(areaId: string): void {
    let changed = false
    for (const [id, object] of this.byId) if (object.areaId === areaId) { this.byId.delete(id); changed = true }
    if (changed) this.invalidateAreas()
  }

  clear(): void {
    this.byId.clear()
    this.invalidateAreas()
  }

  get size(): number {
    return this.byId.size
  }

  inArea(areaId: string): readonly PlacedObject[] {
    const cached = this.byArea.get(areaId)
    if (cached) return cached
    const objects = [...this.byId.values()].filter(object => object.areaId === areaId)
    this.byArea.set(areaId, objects)
    return objects
  }

  /** The object covering this tile, or null. The last registered one wins. */
  at(areaId: string, tx: number, ty: number): PlacedObject | null {
    let found: PlacedObject | null = null
    for (const object of this.byId.values()) {
      if (object.areaId !== areaId) continue
      if (object.footprint.some(tile => tile.tx === tx && tile.ty === ty)) found = object
    }
    return found
  }

  /** True when something placed here blocks the way. */
  isSolid(areaId: string, tx: number, ty: number): boolean {
    for (const object of this.byId.values()) {
      if (!object.solid || object.areaId !== areaId) continue
      if (object.footprint.some(tile => tile.tx === tx && tile.ty === ty)) return true
    }
    return false
  }

  /** True when something placed here is used from an adjacent tile. */
  isInteractive(areaId: string, tx: number, ty: number): boolean {
    const object = this.at(areaId, tx, ty)
    return object?.interactive ?? false
  }
}
