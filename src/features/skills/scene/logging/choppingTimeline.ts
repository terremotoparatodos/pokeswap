// Chopping timeline (R31-C3, SKILLS PROB-2): one axe bite per WORLD work tick
// while the action runs and, once the server has answered, the moment the
// tree gives way.
//
// Pure and time-based, so the overlay, the card and tests agree on when a bite
// lands, when the tree falls and when the reward shows. Since PROB-2 nobody on
// the client knows how long an action lasts: the timeline starts OPEN (bites
// forever) and is CLOSED when the result arrives — the current bite finishes,
// then the tree falls (only on a success) and the reward shows.

import { WORK_TICK_MS } from '../../../../../services/realtime/src/world/worldProtocol.js'

/** One bite per attempt: windup + bite + recoil = WORK_TICK_MS. The bite lands with the worker's blow (workerPose). */
export const CHOP_MS = { windup: 270, bite: 100, recoil: WORK_TICK_MS - 370 } as const
export const CHOP_TOTAL_MS = CHOP_MS.windup + CHOP_MS.bite + CHOP_MS.recoil
/** The tree leans, the canopy lets go, the trunk drops to a stump. */
export const FELL_MS = 420
export const REWARD_MS = 950

export type ChopPhase = 'windup' | 'bite' | 'recoil' | 'fell' | 'reward' | 'done'

export interface ChoppingTimeline {
  /** True until the server's answer arrives: bites repeat and nothing ends. */
  readonly open: boolean
  /** Bites played (Infinity while open). */
  readonly chops: number
  /** True when this action takes the tree down (a success). */
  readonly felling: boolean
  /** When the tree starts giving way (equals resultAtMs when it does not fall). */
  readonly fellAtMs: number
  /** When the result is applied. */
  readonly resultAtMs: number
  readonly totalMs: number
}

/** A running action: bite after bite, one per tick, until `closeChopping`. */
export function choppingTimeline(): ChoppingTimeline {
  return { open: true, chops: Infinity, felling: false, fellAtMs: Infinity, resultAtMs: Infinity, totalMs: Infinity }
}

/**
 * The server answered at `elapsedMs`: finish the bite in progress, then fall
 * (only when `felling`: a success) and show the result.
 */
export function closeChopping(elapsedMs: number, felling: boolean): ChoppingTimeline {
  const chops = Math.max(1, Math.floor(Math.max(0, elapsedMs) / CHOP_TOTAL_MS) + 1)
  const fellAtMs = chops * CHOP_TOTAL_MS
  const resultAtMs = fellAtMs + (felling ? FELL_MS : 0)
  return { open: false, chops, felling, fellAtMs, resultAtMs, totalMs: resultAtMs + REWARD_MS }
}

export interface ChopPose {
  readonly phase: ChopPhase
  readonly chop: number
  /** Axe frame: 0 raised, 1 mid, 2 bite. */
  readonly toolFrame: 0 | 1 | 2
  /** Horizontal shiver of the trunk, in world pixels. */
  readonly trunkShake: number
  /** How far the canopy leans while the tree gives way, 0..1. */
  readonly fall: number
  /** 0..1 inside the reward phase. */
  readonly rewardProgress: number
}

export function choppingPose(timeline: ChoppingTimeline, elapsedMs: number): ChopPose {
  const t = Math.max(0, elapsedMs)
  const base = { chop: timeline.chops - 1, toolFrame: 1 as const, trunkShake: 0, fall: 0, rewardProgress: 0 }
  if (t >= timeline.totalMs) return { ...base, phase: 'done', fall: timeline.felling ? 1 : 0, rewardProgress: 1 }
  if (t >= timeline.resultAtMs) {
    return { ...base, phase: 'reward', fall: timeline.felling ? 1 : 0, rewardProgress: (t - timeline.resultAtMs) / REWARD_MS }
  }
  if (timeline.felling && t >= timeline.fellAtMs) {
    return { ...base, phase: 'fell', toolFrame: 2, fall: (t - timeline.fellAtMs) / FELL_MS }
  }
  const chop = Math.floor(t / CHOP_TOTAL_MS)
  const local = t - chop * CHOP_TOTAL_MS
  if (local < CHOP_MS.windup) return { ...base, chop, phase: 'windup', toolFrame: 0 }
  if (local < CHOP_MS.windup + CHOP_MS.bite) {
    return { ...base, chop, phase: 'bite', toolFrame: 2, trunkShake: chop % 2 === 0 ? 1 : -1 }
  }
  // Wood keeps quivering a moment after the blade leaves it.
  const recoil = local - CHOP_MS.windup - CHOP_MS.bite
  const shake = recoil < 120 ? (chop % 2 === 0 ? -1 : 1) * (recoil < 60 ? 1 : 0.5) : 0
  return { ...base, chop, phase: 'recoil', trunkShake: shake }
}

/** Chop indices whose bite begins in (fromMs, toMs]: when to spawn splinters. */
export function bitesBetween(timeline: ChoppingTimeline, fromMs: number, toMs: number): number[] {
  const hits: number[] = []
  const first = Math.max(0, Math.floor((fromMs - CHOP_MS.windup) / CHOP_TOTAL_MS))
  const last = Math.min(timeline.chops, Math.floor((toMs - CHOP_MS.windup) / CHOP_TOTAL_MS) + 1)
  for (let chop = first; chop < last; chop++) {
    const at = chop * CHOP_TOTAL_MS + CHOP_MS.windup
    if (at > fromMs && at <= toMs) hits.push(chop)
  }
  return hits
}
