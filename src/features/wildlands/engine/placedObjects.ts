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

/** What kind of thing was placed; the feature that owns it gives it meaning. */
export type PlacedObjectKind = 'alchemyTable' | 'smelter' | 'campfire' | 'workbench'

export interface PlacedObject {
  readonly id: string
  readonly areaId: string
  /** The tile the object is anchored to: its front-bottom tile. */
  readonly anchor: Tile
  /**
   * Every tile it occupies. One today; the shape is already a list so a 2×2
   * smelter or a 4×3 house needs no change here, only a wider footprint.
   */
  readonly footprint: readonly Tile[]
  /** Blocks movement, navigation and placement. */
  readonly solid: boolean
  /** Can be used from an orthogonally adjacent tile. */
  readonly interactive: boolean
  readonly kind: PlacedObjectKind
}

export interface PlacedObjectSpec {
  readonly id: string
  readonly areaId: string
  readonly anchor: Tile
  readonly kind: PlacedObjectKind
  readonly solid?: boolean
  readonly interactive?: boolean
  /** Tiles wide and deep, both 1 today. The anchor is the front-left tile. */
  readonly width?: number
  readonly depth?: number
}

/** Builds the record, expanding `width`/`depth` into the tiles it covers. */
export function placedObject(spec: PlacedObjectSpec): PlacedObject {
  const width = Math.max(1, Math.trunc(spec.width ?? 1))
  const depth = Math.max(1, Math.trunc(spec.depth ?? 1))
  const footprint: Tile[] = []
  // The anchor is the front row, so a deeper object grows northwards (-ty),
  // the same direction its art grows on screen.
  for (let dy = 0; dy < depth; dy++) {
    for (let dx = 0; dx < width; dx++) footprint.push({ tx: spec.anchor.tx + dx, ty: spec.anchor.ty - dy })
  }
  return {
    id: spec.id,
    areaId: spec.areaId,
    anchor: spec.anchor,
    footprint,
    solid: spec.solid ?? true,
    interactive: spec.interactive ?? true,
    kind: spec.kind,
  }
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

  /** Adds the object, replacing any earlier one with the same id. */
  register(object: PlacedObject): void {
    this.byId.set(object.id, object)
  }

  /** Removes one object. Unknown ids are ignored, so cleanup is idempotent. */
  unregister(id: string): void {
    this.byId.delete(id)
  }

  /** Drops everything placed in one area (used when that area is left). */
  clearArea(areaId: string): void {
    for (const [id, object] of this.byId) if (object.areaId === areaId) this.byId.delete(id)
  }

  clear(): void {
    this.byId.clear()
  }

  get size(): number {
    return this.byId.size
  }

  inArea(areaId: string): readonly PlacedObject[] {
    return [...this.byId.values()].filter(object => object.areaId === areaId)
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

  /**
   * The object a tap on this tile means, allowing for the art standing above
   * its tile: a tap on the top of a bench lands on the ground behind it, the
   * same way it does on a building (see `doorForTap`). `reachRows` rows north
   * of the footprint still count as the object.
   *
   * This only resolves *what was pointed at*. Whether the player may reach or
   * use it stays with the world and the feature.
   */
  forTap(areaId: string, tile: Tile, reachRows = 0): PlacedObject | null {
    const direct = this.at(areaId, tile.tx, tile.ty)
    if (direct || reachRows <= 0) return direct
    for (const object of this.inArea(areaId)) {
      for (const cell of object.footprint) {
        if (cell.tx !== tile.tx) continue
        if (tile.ty < cell.ty && cell.ty - tile.ty <= reachRows) return object
      }
    }
    return null
  }
}
