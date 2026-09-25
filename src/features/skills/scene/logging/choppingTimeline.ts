// Chopping timeline (R31-C3): a few axe bites and, when the tree runs out of
// wood, the moment it gives way.
//
// Pure and time-based, so the overlay, the card and tests agree on when a bite
// lands, when the tree falls and when the reward shows. The server-side action
// time only chooses how many bites the animation plays.

/** Slower and heavier than the pickaxe: wood answers late. */
export const CHOP_MS = { windup: 260, bite: 100, recoil: 220 } as const
export const CHOP_TOTAL_MS = CHOP_MS.windup + CHOP_MS.bite + CHOP_MS.recoil
/** The tree leans, the canopy lets go, the trunk drops to a stump. */
export const FELL_MS = 420
export const REWARD_MS = 950
export const MIN_CHOPS = 2

export type ChopPhase = 'windup' | 'bite' | 'recoil' | 'fell' | 'reward' | 'done'

export interface ChoppingTimeline {
  readonly chops: number
  /** True when this action takes the tree's last charge. */
  readonly felling: boolean
  /** When the tree starts giving way (equals resultAtMs when it does not fall). */
  readonly fellAtMs: number
  /** When the result is applied. */
  readonly resultAtMs: number
  readonly totalMs: number
}

/** As many bites as fit the authorized duration, rounded up (see miningTimeline). */
export function choppingTimeline(durationMs: number, felling: boolean): ChoppingTimeline {
  const chops = Math.max(MIN_CHOPS, Math.ceil(durationMs / CHOP_TOTAL_MS))
  const fellAtMs = chops * CHOP_TOTAL_MS
  const resultAtMs = fellAtMs + (felling ? FELL_MS : 0)
  return { chops, felling, fellAtMs, resultAtMs, totalMs: resultAtMs + REWARD_MS }
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
  for (let chop = 0; chop < timeline.chops; chop++) {
    const at = chop * CHOP_TOTAL_MS + CHOP_MS.windup
    if (at > fromMs && at <= toMs) hits.push(chop)
  }
  return hits
}
