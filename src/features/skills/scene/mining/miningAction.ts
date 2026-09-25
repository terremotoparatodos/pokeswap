// Mining action timeline: a few pickaxe swings, then the reward.
//
// Pure and time-based so the overlay, the panel and tests agree on when a
// strike lands and when the result is revealed. The server-side action time
// (actionSeconds) only chooses how many swings the animation shows.

export const SWING_MS = { windup: 220, strike: 90, recoil: 190 } as const
export const SWING_TOTAL_MS = SWING_MS.windup + SWING_MS.strike + SWING_MS.recoil
export const REWARD_MS = 950
export const MIN_SWINGS = 2

export type MiningPhase = 'windup' | 'strike' | 'recoil' | 'reward' | 'done'

export interface MiningTimeline {
  readonly swings: number
  /** When the result is applied (end of the last swing). */
  readonly resultAtMs: number
  readonly totalMs: number
}

/**
 * As many blows as fit the authorized duration, rounded up so the result
 * never lands before the Skills service would accept it.
 */
export function miningTimeline(durationMs: number): MiningTimeline {
  const swings = Math.max(MIN_SWINGS, Math.ceil(durationMs / SWING_TOTAL_MS))
  const resultAtMs = swings * SWING_TOTAL_MS
  return { swings, resultAtMs, totalMs: resultAtMs + REWARD_MS }
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
  for (let swing = 0; swing < timeline.swings; swing++) {
    const at = swing * SWING_TOTAL_MS + SWING_MS.windup
    if (at > fromMs && at <= toMs) hits.push(swing)
  }
  return hits
}
