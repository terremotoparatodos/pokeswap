// Where the player stands to fish and where the line lands (R31-C2).
//
// Fishing spots sit on the shore (a land tile touching water) or on reef props
// out in the water. The player fishes standing on solid ground whenever the
// spot has any dry neighbour, so nobody walks into the sea to cast; only a
// spot surrounded by water (open reef) is reached by swimming beside it.

import type { Dir } from '../../wildlands/engine/characters'
import type { TilePoint } from '../overworld/workerPresence'
import { faceToward, isBeside } from '../overworld/workerPresence'

export interface WaterProbe {
  isWater(tx: number, ty: number): boolean
  isSolid(tx: number, ty: number): boolean
}

const SIDES: readonly (readonly [number, number])[] = [[0, -1], [0, 1], [-1, 0], [1, 0]]

/** Dry, walkable tile: where a fisher can stand. */
export function isStandable(probe: WaterProbe, tx: number, ty: number): boolean {
  return !probe.isWater(tx, ty) && !probe.isSolid(tx, ty)
}

/** True when the spot has at least one dry neighbour, i.e. it can be fished from land. */
export function hasDryBank(probe: WaterProbe, spot: TilePoint): boolean {
  return SIDES.some(([dx, dy]) => isStandable(probe, spot.tx + dx, spot.ty + dy))
}

/**
 * Can the player cast from where they stand? Beside the spot, and — whenever
 * the spot has a bank — standing on dry land rather than in the water.
 */
export function canCastFrom(probe: WaterProbe, player: TilePoint, spot: TilePoint): boolean {
  if (!isBeside(player, spot)) return false
  if (probe.isWater(player.tx, player.ty)) return !hasDryBank(probe, spot)
  return true
}

/**
 * Water tile the bobber lands on: the spot itself when it is water, otherwise
 * the first water tile beyond it in the casting direction, or any water
 * neighbour of the spot. Null when there is no water at all (broken placement).
 */
export function castTile(probe: WaterProbe, player: TilePoint, spot: TilePoint): TilePoint | null {
  if (probe.isWater(spot.tx, spot.ty)) return spot
  const dx = Math.sign(spot.tx - player.tx)
  const dy = Math.sign(spot.ty - player.ty)
  for (let step = 1; step <= 2; step++) {
    const tx = spot.tx + dx * step
    const ty = spot.ty + dy * step
    if ((dx !== 0 || dy !== 0) && probe.isWater(tx, ty)) return { tx, ty }
  }
  for (const [sx, sy] of SIDES) {
    const tx = spot.tx + sx
    const ty = spot.ty + sy
    if (probe.isWater(tx, ty)) return { tx, ty }
  }
  return null
}

/** Direction the player (and the worker Pokémon) should face while fishing. */
export function castFacing(player: TilePoint, water: TilePoint, fallback: Dir): Dir {
  return faceToward(player, water, fallback)
}
