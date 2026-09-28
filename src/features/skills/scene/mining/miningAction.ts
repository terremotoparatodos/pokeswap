// Mining action timeline (SKILLS PROB-2): one pickaxe swing per WORLD work
// tick while the action runs, then the reward once the server has answered.
//
// Pure and time-based so the overlay, the panel and tests agree on when a
// strike lands and when the result is revealed. Nobody on the client knows
// how long an action lasts: the timeline starts OPEN (swings forever) and is
// CLOSED by the result — the swing in progress finishes, then the reward.

import { WORK_TICK_MS } from '../../../../../services/realtime/src/world/worldProtocol.js'

/** One swing per attempt: windup + strike + recoil = WORK_TICK_MS. The strike lands with the worker's blow (workerPose). */
export const SWING_MS = { windup: 264, strike: 90, recoil: WORK_TICK_MS - 354 } as const
export const SWING_TOTAL_MS = SWING_MS.windup + SWING_MS.strike + SWING_MS.recoil
export const REWARD_MS = 950

export type MiningPhase = 'windup' | 'strike' | 'recoil' | 'reward' | 'done'

export interface MiningTimeline {
  /** True until the server's answer arrives: swings repeat and nothing ends. */
  readonly open: boolean
  /** Swings played (Infinity while open). */
  readonly swings: number
  /** When the result is applied (end of the last swing). */
  readonly resultAtMs: number
  readonly totalMs: number
}

/** A running action: swing after swing, one per tick, until `closeMining`. */
export function miningTimeline(): MiningTimeline {
  return { open: true, swings: Infinity, resultAtMs: Infinity, totalMs: Infinity }
}

/** The server answered at `elapsedMs`: finish the swing in progress, then the result. */
export function closeMining(elapsedMs: number): MiningTimeline {
  const swings = Math.max(1, Math.floor(Math.max(0, elapsedMs) / SWING_TOTAL_MS) + 1)
  const resultAtMs = swings * SWING_TOTAL_MS
  return { open: false, swings, resultAtMs, totalMs: resultAtMs + REWARD_MS }
}

export interface MiningPose {
  readonly phase: MiningPhase
  readonly swing: number
  /** Pickaxe frame: 0 raised, 1 mid, 2 strike. */
  readonly toolFrame: 0 | 1 | 2
  /** Node shake offset in world pixels. */
  readonly nodeShake: number
  /** Player lean toward the node, in world pixels. */
  readonly lean: number
  /** 0..1 inside the reward phase. */
  readonly rewardProgress: number
}

export function miningPose(timeline: MiningTimeline, elapsedMs: number): MiningPose {
  const t = Math.max(0, elapsedMs)
  if (t >= timeline.totalMs) return { phase: 'done', swing: timeline.swings - 1, toolFrame: 1, nodeShake: 0, lean: 0, rewardProgress: 1 }
  if (t >= timeline.resultAtMs) {
    return { phase: 'reward', swing: timeline.swings - 1, toolFrame: 1, nodeShake: 0, lean: 0, rewardProgress: (t - timeline.resultAtMs) / REWARD_MS }
  }
  const swing = Math.floor(t / SWING_TOTAL_MS)
  const local = t - swing * SWING_TOTAL_MS
  if (local < SWING_MS.windup) return { phase: 'windup', swing, toolFrame: 0, nodeShake: 0, lean: -0.5, rewardProgress: 0 }
  if (local < SWING_MS.windup + SWING_MS.strike) return { phase: 'strike', swing, toolFrame: 2, nodeShake: swing % 2 === 0 ? 1 : -1, lean: 1, rewardProgress: 0 }
  const recoil = local - SWING_MS.windup - SWING_MS.strike
  return { phase: 'recoil', swing, toolFrame: 1, nodeShake: recoil < 80 ? (swing % 2 === 0 ? -1 : 1) : 0, lean: 0, rewardProgress: 0 }
}

/** Swing indices whose strike begins in (fromMs, toMs]: when to spawn impact effects. */
export function strikesBetween(timeline: MiningTimeline, fromMs: number, toMs: number): number[] {
  const hits: number[] = []
  const first = Math.max(0, Math.floor((fromMs - SWING_MS.windup) / SWING_TOTAL_MS))
  const last = Math.min(timeline.swings, Math.floor((toMs - SWING_MS.windup) / SWING_TOTAL_MS) + 1)
  for (let swing = first; swing < last; swing++) {
    const at = swing * SWING_TOTAL_MS + SWING_MS.windup
    if (at > fromMs && at <= toMs) hits.push(swing)
  }
  return hits
}
