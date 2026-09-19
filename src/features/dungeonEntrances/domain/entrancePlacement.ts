// Where a Dungeon opens its mouth in WildLands.
//
// APPROVED product direction: you do not enter a Dungeon from a menu, an NPC or
// the city. A Dungeon **appears physically in the world** and you walk into it.
// `DungeonSpawn` already says what an appearance *is* (domain/dungeonSpawn.ts);
// this says *where* it lands.
//
// Derived, never stored, exactly like every profession node and the alchemy
// bench: the same area, origin and seed put the same caves on the same tiles
// for every player, which is what a future server would need in order to
// validate that somebody really was standing at an entrance. Nothing here
// reaches a database, and nothing here is authoritative — the server owns the
// spawn clock the day the spawn clock matters (dungeonSpawn.ts §SERVER
// AUTHORITY).
//
// Pure: a port answers three questions about the world and this returns tiles.

import type { Tile } from '../../wildlands/engine/pathfinding'

export interface EntranceWorldPort {
  isSolid(tx: number, ty: number): boolean
  isWater(tx: number, ty: number): boolean
  /** Something else already owns the tile: a profession node, a station, a portal. */
  isTaken(tx: number, ty: number): boolean
}

export interface EntranceShape {
  /** Tiles across. The mouth sits in the middle column, so this is odd. */
  readonly width: number
  /** Tiles deep. The anchor is the front row and the rock grows northwards. */
  readonly depth: number
}

export interface PlacementConfig extends EntranceShape {
  /** Closest ring to the arrival point that may hold a cave. */
  readonly minRing: number
  /** Furthest ring searched. Past this the area simply has fewer caves. */
  readonly maxRing: number
  /** How many to place. */
  readonly count: number
  /** Chebyshev tiles between two anchors, so caves do not crowd each other. */
  readonly minSpacing: number
}

export interface EntrancePlacement {
  /** Front-left tile of the footprint. */
  readonly anchor: Tile
  /** Every tile the rock occupies. */
  readonly footprint: readonly Tile[]
  /** The walkable tile in front of the mouth, where the player stands to enter. */
  readonly approach: Tile
}

/** The tiles a cave anchored here would cover: `width` across, `depth` northwards. */
export function entranceFootprint(anchor: Tile, shape: EntranceShape): Tile[] {
  const tiles: Tile[] = []
  for (let dy = 0; dy < shape.depth; dy++) {
    for (let dx = 0; dx < shape.width; dx++) tiles.push({ tx: anchor.tx + dx, ty: anchor.ty - dy })
  }
  return tiles
}

/** Directly in front of the mouth, which is the middle of the front row. */
export const entranceApproach = (anchor: Tile, shape: EntranceShape): Tile =>
  ({ tx: anchor.tx + Math.floor(shape.width / 2), ty: anchor.ty + 1 })

/**
 * A cave fits when every tile it would cover is open ground, and the tile the
 * player has to stand on to use it is open ground too.
 *
 * The approach matters as much as the footprint: a cave whose mouth faces a
 * lake or a cliff is a cave nobody can enter, and it would read as a bug.
 */
export function fits(port: EntranceWorldPort, anchor: Tile, shape: EntranceShape): boolean {
  const open = (tile: Tile) => !port.isSolid(tile.tx, tile.ty) && !port.isWater(tile.tx, tile.ty) && !port.isTaken(tile.tx, tile.ty)
  return entranceFootprint(anchor, shape).every(open) && open(entranceApproach(anchor, shape))
}

/**
 * Deterministic scatter key. A plain ring-by-ring scan would line every cave up
 * along the first ring that happens to be clear; hashing the candidates and
 * taking them in hash order spreads them around the arrival point while staying
 * a pure function of (area seed, tile).
 */
function scatterKey(seed: number, tx: number, ty: number): number {
  let h = (seed ^ 0x9e3779b9) >>> 0
  h = Math.imul(h ^ (tx * 0x27d4eb2d), 0x85ebca6b) >>> 0
  h = Math.imul(h ^ (ty * 0x165667b1), 0xc2b2ae35) >>> 0
  h ^= h >>> 15
  return h >>> 0
}

const chebyshev = (a: Tile, b: Tile): number => Math.max(Math.abs(a.tx - b.tx), Math.abs(a.ty - b.ty))

/**
 * The caves of one area.
 *
 * Candidates are every tile in the [minRing, maxRing] band around `origin`
 * where a cave fits; they are taken in hash order and kept only when far enough
 * from the ones already taken. Fewer than `count` is a valid answer: a cramped
 * corner of the world gets fewer caves rather than caves inside a lake.
 */
export function placeEntrances(
  port: EntranceWorldPort,
  origin: Tile,
  seed: number,
  config: PlacementConfig,
): EntrancePlacement[] {
  const candidates: { tile: Tile; key: number }[] = []
  for (let dy = -config.maxRing; dy <= config.maxRing; dy++) {
    for (let dx = -config.maxRing; dx <= config.maxRing; dx++) {
      const ring = Math.max(Math.abs(dx), Math.abs(dy))
      if (ring < config.minRing || ring > config.maxRing) continue
      const anchor = { tx: origin.tx + dx, ty: origin.ty + dy }
      if (!fits(port, anchor, config)) continue
      candidates.push({ tile: anchor, key: scatterKey(seed, anchor.tx, anchor.ty) })
    }
  }
  // Ties broken by coordinate so the result never depends on scan order.
  candidates.sort((a, b) => a.key - b.key || a.tile.tx - b.tile.tx || a.tile.ty - b.tile.ty)

  const placed: EntrancePlacement[] = []
  for (const candidate of candidates) {
    if (placed.length >= config.count) break
    if (placed.some(other => chebyshev(other.anchor, candidate.tile) < config.minSpacing)) continue
    placed.push({
      anchor: candidate.tile,
      footprint: entranceFootprint(candidate.tile, config),
      approach: entranceApproach(candidate.tile, config),
    })
  }
  return placed
}
