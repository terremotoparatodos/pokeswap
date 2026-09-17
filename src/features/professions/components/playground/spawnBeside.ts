// Field lab spawn (R31-Z.1): where a lab drops the player next to the node or
// bench it is showing. The four field labs had the same copy of this rule.
//
// Dev tooling only: it places the *player* when a lab opens. The worker
// Pokémon is placed by `overworld/workerPresence.ts` (`workerSpot`), which has
// nothing to do with this.

import type { Dir } from '../../../wildlands/engine/characters'

export interface SpawnProbe {
  isSolid(tx: number, ty: number): boolean
  isWater(tx: number, ty: number): boolean
}

export interface LabSpawn {
  readonly tx: number
  readonly ty: number
  /** Facing toward the tile. */
  readonly dir: Dir
}

/** South, north, east, west — with the facing that looks back at the tile. */
const SIDES: readonly (readonly [number, number, Dir])[] = [[0, 1, 'up'], [0, -1, 'down'], [1, 0, 'left'], [-1, 0, 'right']]

/**
 * A dry, walkable tile two steps from `tile` with a clear step in between (so
 * the lab shows the player walking up), else one step away, trying the sides
 * in a fixed order. When every side is blocked it falls back to the tile just
 * south, facing up — e.g. an open reef, reached by swimming.
 */
export function spawnBeside(probe: SpawnProbe, tile: { tx: number; ty: number }): LabSpawn {
  const free = (tx: number, ty: number) => !probe.isSolid(tx, ty) && !probe.isWater(tx, ty)
  for (const distance of [2, 1]) {
    for (const [dx, dy, dir] of SIDES) {
      const tx = tile.tx + dx * distance
      const ty = tile.ty + dy * distance
      const path = distance === 2 ? free(tile.tx + dx, tile.ty + dy) : true
      if (path && free(tx, ty)) return { tx, ty, dir }
    }
  }
  return { tx: tile.tx, ty: tile.ty + 1, dir: 'up' }
}
