// Worker Pokémon presence (R31-C1): where the assigned Pokémon stands while
// the player works a node, and how it pops in and out. Pure and shared by
// every gathering profession; the runtime drawing lives in workerCompanion.ts.
//
// The Pokémon is a visual only: no collision, no pathfinding, no authority.

import type { Dir } from '../../wildlands/engine/characters'

export interface TilePoint {
  readonly tx: number
  readonly ty: number
}

export interface WorkerSpot extends TilePoint {
  /** Facing toward the worked node. */
  readonly dir: Dir
}

/**
 * Candidate offsets from the player, per facing: first beside the player on
 * the side away from the tool swing, then the other side, then slightly
 * behind (diagonals first), then straight behind.
 */
const OFFSETS: Readonly<Record<Dir, readonly (readonly [number, number])[]>> = {
  up: [[1, 0], [-1, 0], [1, 1], [-1, 1], [0, 1]],
  down: [[-1, 0], [1, 0], [-1, -1], [1, -1], [0, -1]],
  left: [[0, -1], [0, 1], [1, -1], [1, 1], [1, 0]],
  right: [[0, -1], [0, 1], [-1, -1], [-1, 1], [-1, 0]],
}

/** Orthogonally adjacent tiles: the reach of any gathering action. */
export function isBeside(a: TilePoint, b: TilePoint): boolean {
  return Math.abs(a.tx - b.tx) + Math.abs(a.ty - b.ty) === 1
}

/** Dominant-axis direction from one tile to another; ties (diagonals) keep `tie`. */
export function faceToward(from: TilePoint, to: TilePoint, tie: Dir): Dir {
  const dx = to.tx - from.tx
  const dy = to.ty - from.ty
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left'
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'down' : 'up'
  return tie
}

/**
 * A free tile next to the player for the worker, never the node or the
 * player's own tile. `isFree` should reject solid, water and node tiles.
 * Null when the player is boxed in (the worker then simply does not appear).
 */
export function workerSpot(player: TilePoint, target: TilePoint, isFree: (tx: number, ty: number) => boolean): WorkerSpot | null {
  const facing = faceToward(player, target, 'down')
  for (const [dx, dy] of OFFSETS[facing]) {
    const tx = player.tx + dx
    const ty = player.ty + dy
    if ((tx === target.tx && ty === target.ty) || !isFree(tx, ty)) continue
    return { tx, ty, dir: faceToward({ tx, ty }, target, facing) }
  }
  return null
}

/** Short on purpose: the action repeats many times. */
export const SUMMON_SECONDS = 0.22
export const DISMISS_SECONDS = 0.18
export const BURST_SECONDS = 0.35

export interface PresencePose {
  readonly scale: number
  readonly alpha: number
  /** 0→1 progress of the sparkle burst, or null when none is showing. */
  readonly burst: number | null
  readonly gone: boolean
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/** Pop-in (scale with a small overshoot and fade) and fade-out timing. */
export function presencePose(shownAt: number, dismissedAt: number | null, seconds: number): PresencePose {
  if (dismissedAt !== null) {
    const t = clamp01((seconds - dismissedAt) / DISMISS_SECONDS)
    return { scale: 1 - 0.45 * t, alpha: 1 - t, burst: t < 1 ? t : null, gone: t >= 1 }
  }
  const t = clamp01((seconds - shownAt) / SUMMON_SECONDS)
  const overshoot = 1.7
  const u = t - 1
  const eased = 1 + (overshoot + 1) * u * u * u + overshoot * u * u
  const burst = (seconds - shownAt) / BURST_SECONDS
  return { scale: 0.35 + 0.65 * eased, alpha: Math.min(1, t * 2), burst: burst < 1 ? clamp01(burst) : null, gone: false }
}
