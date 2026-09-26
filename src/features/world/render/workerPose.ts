// The working beat of a worker Pokémon (WORLD VISUAL-1, per task since VISUAL-2).
//
// A pure function of the task (the node's authoritative `workKind`), the
// action's server start and the shared server clock: no local timers, no
// randomness. Two browsers that agree on `serverNow` draw the same frame, the
// same lean and the same hop, for the owner and for every observer.
//
// Talar and Minería land their impact on the beat of the Skills scene
// (`choppingTimeline`'s bite, `miningTimeline`'s strike), so the Pokémon hits
// when the splinters and sparks fly. Agricultura has no scene: its beat is
// its own, slower and lower.

import { DIRS } from '../../wildlands/engine/actors'
import type { Dir } from '../../wildlands/engine/characters'
import { TILE } from '../../wildlands/engine/world'

export type WorkKind = 'chop' | 'mine' | 'farm'

/** One key of a beat: at `at` ms the Pokémon leans `lean` px toward the node and is lifted `hop` px. */
type Key = readonly [at: number, lean: number, hop: number]

export interface TaskBeat {
  readonly periodMs: number
  /** When the blow lands inside the beat (the scene's particles spawn here). */
  readonly impactMs: number
  /** Sprite steps per beat. */
  readonly steps: number
  readonly keys: readonly Key[]
}

/**
 * - chop: 580 ms like CHOP_MS — a short run-up, a push into the trunk at the
 *   bite (260 ms), an easy return;
 * - mine: 500 ms like SWING_MS — a sharp snap at the strike (220 ms), then a
 *   small bounce back off the rock;
 * - farm: 900 ms — a soft, low dip toward the soil, no impact.
 */
export const TASK_BEATS: Readonly<Record<WorkKind, TaskBeat>> = {
  chop: { periodMs: 580, impactMs: 260, steps: 2, keys: [[0, 0, 0], [150, -1, 0], [260, 4, 1], [360, 3, 0.5], [580, 0, 0]] },
  mine: { periodMs: 500, impactMs: 220, steps: 2, keys: [[0, 0, 0], [180, -1.5, 0], [220, 4, 0], [310, 4, 0], [370, -1.5, 2], [440, 0.5, 0.5], [500, 0, 0]] },
  farm: { periodMs: 900, impactMs: 450, steps: 1, keys: [[0, 0, 0], [450, 2, -1.5], [900, 0, 0]] },
}

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
  /** Lean as a share of a tile, in (-1, 1): below 1 so the renderer steps the sprite from `walkClock` (shared), not its local clock. */
  readonly progress: number
  readonly dir: Dir
  readonly hop: number
  readonly walkClock: number
}

export function taskBeat(workKind: string | undefined): TaskBeat {
  return workKind === 'mine' || workKind === 'farm' ? TASK_BEATS[workKind] : TASK_BEATS.chop
}

/** Milliseconds into the current beat, counted from the action's start. */
export function beatTime(beat: TaskBeat, startedAt: number, serverNow: number): number {
  const elapsed = serverNow - startedAt
  return ((elapsed % beat.periodMs) + beat.periodMs) % beat.periodMs
}

/** True while a blow is landing (the node shivers for observers, in time with the Pokémon). */
export function isImpact(workKind: string | undefined, startedAt: number, serverNow: number): boolean {
  const beat = taskBeat(workKind)
  if (workKind === 'farm') return false
  const t = beatTime(beat, startedAt, serverNow)
  return serverNow >= startedAt && t >= beat.impactMs && t < beat.impactMs + 90
}

function sample(keys: readonly Key[], t: number): { lean: number; hop: number } {
  for (let i = 1; i < keys.length; i++) {
    const [at, lean, hop] = keys[i]
    const [from, fromLean, fromHop] = keys[i - 1]
    if (t <= at) {
      const u = at === from ? 1 : (t - from) / (at - from)
      return { lean: fromLean + (lean - fromLean) * u, hop: fromHop + (hop - fromHop) * u }
    }
  }
  return { lean: 0, hop: 0 }
}

/**
 * Where and how the worker is drawn at `serverNow`: on its stand, leaning
 * toward the node it faces as its task's beat says. `reduceMotion` keeps the
 * sprite stepping but drops the lean and the hop.
 */
export function workerPose(stand: WorkerStandTile, workKind: string | undefined, startedAt: number, serverNow: number, reduceMotion = false): WorkerPose {
  const beat = taskBeat(workKind)
  const t = beatTime(beat, startedAt, serverNow)
  const { lean, hop } = reduceMotion ? { lean: 0, hop: 0 } : sample(beat.keys, t)
  const [dx, dy] = DIRS[stand.dir]
  // Interpolating from the stand toward the next tile along the facing gives a
  // sub-tile lean; a negative progress is the pull-back before a blow.
  return {
    fromTx: stand.tx, fromTy: stand.ty,
    tx: stand.tx + dx, ty: stand.ty + dy,
    progress: lean / TILE,
    dir: stand.dir,
    hop,
    // Never negative: the renderer indexes frames with it (a clock a hair behind `startedAt` is normal).
    walkClock: (Math.max(0, serverNow - startedAt) / beat.periodMs) * (beat.steps / 2),
  }
}
