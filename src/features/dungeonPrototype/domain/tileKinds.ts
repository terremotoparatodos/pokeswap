// The vocabulary a dungeon floor is made of.
//
// Split out of floorTiles.ts in D1.2.2 so the Boss Room (bossRoom.ts) can speak
// it without importing the procedural generator that imports the Boss Room:
// the constants live here, and both sides read them.

import type { DungeonTheme } from './tiers'

export type TileKind =
  | 'rock'      // solid wall
  | 'floor'     // walkable cave floor
  | 'rubble'    // walkable, visually broken up
  | 'water'     // blocked unless bridged
  | 'bridge'    // walkable over water
  | 'ledge'     // a drop: walkable, marks a level change
  | 'accent'    // biome decoration: crystal, snowdrift, moss, lava crust
  | 'stairs'    // the way down, where the exit door is

export const WALKABLE: ReadonlySet<TileKind> = new Set<TileKind>(['floor', 'rubble', 'bridge', 'ledge', 'stairs', 'accent'])

/**
 * How many tiles one plan cell is worth.
 *
 * D1.2.1 §5: the cave is sized for the player, not the other way round. A cell
 * used to be 9×7 — barely a room — and is now 22×17, about the size of a
 * clearing in the overworld at the same 16px tile.
 */
export const CELL_TILES = { w: 22, h: 17 } as const

/**
 * PLAYTEST PARAMETER (D1.2.1 §7). A trainer is one tile. Four of them with a
 * Pokémon each is eight bodies, and a fight parks three of them side by side,
 * so a main route carries five tiles of clear ground and a branch four. Two is
 * reserved for the deliberate pinch points of §8 (bridges, cracks, doorways).
 */
export const PATH_WIDTH = { main: 5, side: 4, pinch: 2 } as const

/** The smallest a chamber is allowed to be, across. */
export const MIN_CHAMBER = 9

export interface TilePoint { readonly x: number; readonly y: number }

export interface FloorTiles {
  readonly width: number
  readonly height: number
  /** Row-major, `width * height` long. */
  readonly tiles: TileKind[]
  readonly entrance: TilePoint
  readonly exit: TilePoint
  /** Tile centre of each room, for placing things. */
  readonly roomCentres: Readonly<Record<number, TilePoint>>
  readonly theme: DungeonTheme
  /**
   * Optional side rooms (D1.2.4ter §2): a one-tile mouth, a short throat and a
   * small chamber behind it. They are never on the way to the stairs, which is
   * what makes them optional, and a single block in the mouth closes one.
   */
  readonly alcoves?: readonly Alcove[]
}

export interface Alcove {
  /** The one tile that closes it: where a block stands. */
  readonly mouth: TilePoint
  /** Everything behind the mouth, the throat included. */
  readonly tiles: readonly TilePoint[]
}

const index = (tiles: FloorTiles, x: number, y: number): number => y * tiles.width + x

export const tileAt = (tiles: FloorTiles, x: number, y: number): TileKind =>
  x < 0 || y < 0 || x >= tiles.width || y >= tiles.height ? 'rock' : tiles.tiles[index(tiles, x, y)]

export const isWalkable = (tiles: FloorTiles, x: number, y: number): boolean =>
  WALKABLE.has(tileAt(tiles, x, y))

/** Clear ground in a straight line through a tile, counting both ways. */
function clearance(tiles: FloorTiles, x: number, y: number, axis: 'x' | 'y'): number {
  if (!isWalkable(tiles, x, y)) return 0
  let span = 1
  for (let step = 1; step < 40; step++) {
    if (!(axis === 'x' ? isWalkable(tiles, x + step, y) : isWalkable(tiles, x, y + step))) break
    span++
  }
  for (let step = 1; step < 40; step++) {
    if (!(axis === 'x' ? isWalkable(tiles, x - step, y) : isWalkable(tiles, x, y - step))) break
    span++
  }
  return span
}

/** The widest of the two axes: how much room a party actually has here. */
export const openWidth = (tiles: FloorTiles, x: number, y: number): number =>
  Math.max(clearance(tiles, x, y, 'x'), clearance(tiles, x, y, 'y'))
