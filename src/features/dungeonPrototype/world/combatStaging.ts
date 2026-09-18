// Where a fight happens (D1.2 §9, §10, §15).
//
// The fight takes place on the floor, at the tile where the wild Pokémon was
// already standing: no arena, no second scene, no second copy of the foe. All
// this module does is find free ground for the Pokémon we send out, so nothing
// ends up inside a wall, on water or on top of somebody else.
//
// Pure functions over the floor's tiles — no canvas, no engine, no session.

import { isWalkable, type FloorTiles, type TilePoint } from '../domain/floorTiles'
import type { Dir } from '../../wildlands/engine/characters'

export interface StagedCombat {
  /** The foe's own tile. It never moves and is never duplicated. */
  readonly foe: TilePoint
  /** Free ground for each Pokémon we send out, nearest first. */
  readonly allies: readonly TilePoint[]
  /** The trainer stays where they are; this is only which way they look. */
  readonly trainerFacing: Dir
  readonly foeFacing: Dir
}

const STEPS: readonly (readonly [number, number])[] = [
  [0, 1], [0, -1], [1, 0], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1],
  [0, 2], [0, -2], [2, 0], [-2, 0],
]

export const facingBetween = (from: TilePoint, to: TilePoint): Dir => {
  const dx = to.x - from.x
  const dy = to.y - from.y
  if (Math.abs(dx) >= Math.abs(dy)) return dx >= 0 ? 'right' : 'left'
  return dy >= 0 ? 'down' : 'up'
}

const key = (point: TilePoint): string => `${point.x}:${point.y}`

/**
 * Free tiles around `centre`, closest to `prefer` first. A tile is free when it
 * is walkable floor (bridges count, water and rock do not) and nobody is on it.
 */
export function openGround(
  tiles: FloorTiles,
  centre: TilePoint,
  occupied: readonly TilePoint[],
  prefer: TilePoint = centre,
): TilePoint[] {
  const taken = new Set(occupied.map(key))
  const out: TilePoint[] = []
  for (const [dx, dy] of STEPS) {
    const spot = { x: centre.x + dx, y: centre.y + dy }
    if (taken.has(key(spot)) || !isWalkable(tiles, spot.x, spot.y)) continue
    out.push(spot)
  }
  return out.sort((a, b) =>
    Math.hypot(a.x - prefer.x, a.y - prefer.y) - Math.hypot(b.x - prefer.x, b.y - prefer.y))
}

/**
 * Stages a fight around the Pokémon the player just talked to: our side goes
 * between the trainer and the foe when there is room, and the trainer keeps
 * their tile so they stay in the picture.
 */
export function stageCombat(
  tiles: FloorTiles,
  foe: TilePoint,
  trainer: TilePoint,
  busy: readonly TilePoint[],
  slots = 1,
): StagedCombat {
  const blocked = [foe, trainer, ...busy]
  const allies: TilePoint[] = []
  for (let i = 0; i < slots; i++) {
    const spot = openGround(tiles, foe, [...blocked, ...allies], trainer)[0]
      ?? openGround(tiles, trainer, [...blocked, ...allies], foe)[0]
    // With nowhere free at all the Pokémon shares the trainer's tile rather
    // than standing in a wall; the renderer sorts them by depth anyway.
    allies.push(spot ?? trainer)
  }
  return {
    foe,
    allies,
    trainerFacing: facingBetween(trainer, foe),
    foeFacing: facingBetween(foe, allies[0] ?? trainer),
  }
}
