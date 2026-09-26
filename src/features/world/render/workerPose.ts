// The working beat of a worker Pokémon (WORLD VISUAL-1).
//
// A pure function of the action's server start and the shared server clock:
// no local timers, no randomness. Two browsers that agree on `serverNow` draw
// the same frame, the same lean and the same hop.

import { DIRS } from '../../wildlands/engine/actors'
import type { Dir } from '../../wildlands/engine/characters'
import { TILE } from '../../wildlands/engine/world'

/** One lean toward the node and back. */
export const WORK_BEAT_MS = 600
/** How far the Pokémon leans into the node at the peak of a beat. */
export const WORK_LEAN_PX = 3
/** Hop at the peak of a beat, on top of the lean. */
const WORK_HOP_PX = 1.5

export interface WorkerStandTile {
  readonly tx: number
  readonly ty: number
  readonly dir: Dir
}

/** The actor fields a worker's pose sets. */
export interface WorkerPose {
  readonly fromTx: number
  readonly fromTy: number
  readonly tx: number
  readonly ty: number
  /** Kept below 1 so the renderer steps the sprite from `walkClock` (shared) rather than its local clock. */
  readonly progress: number
  readonly dir: Dir
  readonly hop: number
  readonly walkClock: number
}

/** 0→1 position inside the current beat, counted from the action's start. */
export function workBeat(startedAt: number, serverNow: number): number {
  const elapsed = serverNow - startedAt
  return (((elapsed % WORK_BEAT_MS) + WORK_BEAT_MS) % WORK_BEAT_MS) / WORK_BEAT_MS
}

/**
 * Where and how the worker is drawn at `serverNow`: on its stand, leaning up
 * to WORK_LEAN_PX toward the node it faces and back once per beat, with a
 * small hop, stepping two sprite frames per beat.
 */
export function workerPose(stand: WorkerStandTile, startedAt: number, serverNow: number): WorkerPose {
  const beat = workBeat(startedAt, serverNow)
  const lean = Math.sin(beat * Math.PI)
  const [dx, dy] = DIRS[stand.dir]
  return {
    // Interpolating from the stand toward the next tile along the facing gives a sub-tile lean.
    fromTx: stand.tx, fromTy: stand.ty, tx: stand.tx + dx, ty: stand.ty + dy,
    progress: (lean * WORK_LEAN_PX) / TILE,
    dir: stand.dir,
    hop: lean * WORK_HOP_PX,
    // Never negative: the renderer indexes frames with it (a clock a hair behind `startedAt` is normal).
    walkClock: Math.max(0, serverNow - startedAt) / WORK_BEAT_MS,
  }
}
