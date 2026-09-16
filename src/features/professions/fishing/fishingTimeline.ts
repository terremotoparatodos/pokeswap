// Fishing action timeline (R31-C2): cast → line in the water → wait → bite →
// reel. Pure and time-based, so the overlay, the card and tests agree on when
// the bite opens and how good the reaction was.
//
// Every number here is prototype tuning, NOT an economy rule: the bite window
// and the wait are configurable and must be validated by feel first.

export interface FishingTuning {
  readonly castMs: number
  readonly flightMs: number
  readonly minWaitMs: number
  readonly maxWaitMs: number
  /** How long the fish stays hooked and reelable. */
  readonly biteWindowMs: number
  /** Opening slice of the window that counts as a perfect reaction. */
  readonly perfectMs: number
  /** Closing slice that still catches, but late. */
  readonly lateMs: number
  readonly reelMs: number
  readonly rewardMs: number
  readonly escapeMs: number
}

export const FISHING_TUNING: FishingTuning = {
  castMs: 340, flightMs: 260, minWaitMs: 1400, maxWaitMs: 3400,
  biteWindowMs: 1100, perfectMs: 350, lateMs: 300, reelMs: 380, rewardMs: 950, escapeMs: 700,
}

export type FishingPhase = 'cast' | 'flight' | 'waiting' | 'bite' | 'reeling' | 'reward' | 'escaped' | 'done'

export interface FishingPlan {
  readonly tuning: FishingTuning
  /** Milliseconds from the cast. */
  readonly lineAtMs: number
  readonly biteAtMs: number
  readonly biteEndsAtMs: number
}

/** Seeded so a demo run can be replayed; the wait is the only random part. */
export function planCast(random: () => number, tuning: FishingTuning = FISHING_TUNING): FishingPlan {
  const lineAtMs = tuning.castMs + tuning.flightMs
  const wait = tuning.minWaitMs + random() * (tuning.maxWaitMs - tuning.minWaitMs)
  const biteAtMs = lineAtMs + wait
  return { tuning, lineAtMs, biteAtMs, biteEndsAtMs: biteAtMs + tuning.biteWindowMs }
}

export type ReelGrade = 'early' | 'perfect' | 'good' | 'late' | 'missed'

/** How the player reacted; 'early' scares the fish, 'missed' lets it go. */
export function gradeReel(plan: FishingPlan, atMs: number): ReelGrade {
  if (atMs < plan.biteAtMs) return 'early'
  if (atMs >= plan.biteEndsAtMs) return 'missed'
  const into = atMs - plan.biteAtMs
  if (into <= plan.tuning.perfectMs) return 'perfect'
  return into >= plan.tuning.biteWindowMs - plan.tuning.lateMs ? 'late' : 'good'
}

export const CATCHING_GRADES: readonly ReelGrade[] = ['perfect', 'good', 'late']

export function isCatch(grade: ReelGrade): boolean {
  return CATCHING_GRADES.includes(grade)
}

export interface FishingPose {
  readonly phase: FishingPhase
  /** Rod frame: 0 back, 1 whip, 2 held out. */
  readonly rodFrame: 0 | 1 | 2
  /** 0..1 flight of the bobber from the rod tip to the water. */
  readonly flight: number
  /** The bobber is pulled under. */
  readonly sunk: boolean
  /** 0..1 inside the reward. */
  readonly rewardProgress: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

/**
 * Pose for the frame. `reelAtMs` is when the player reeled (null while the
 * line is still out); `outcome` says what that reel produced.
 */
export function fishingPose(plan: FishingPlan, elapsedMs: number, reelAtMs: number | null, caught: boolean): FishingPose {
  const t = Math.max(0, elapsedMs)
  const { tuning } = plan
  const base = { rodFrame: 2 as const, flight: 1, sunk: false, rewardProgress: 0 }

  if (reelAtMs !== null) {
    const since = t - reelAtMs
    if (since < tuning.reelMs) return { ...base, phase: 'reeling', rodFrame: 1, flight: clamp01(1 - since / tuning.reelMs) }
    if (!caught) {
      return since < tuning.reelMs + tuning.escapeMs
        ? { ...base, phase: 'escaped', rodFrame: 2, flight: 0 }
        : { ...base, phase: 'done', flight: 0 }
    }
    const into = since - tuning.reelMs
    return into < tuning.rewardMs
      ? { ...base, phase: 'reward', rodFrame: 2, flight: 0, rewardProgress: clamp01(into / tuning.rewardMs) }
      : { ...base, phase: 'done', flight: 0, rewardProgress: 1 }
  }

  if (t < tuning.castMs) return { ...base, phase: 'cast', rodFrame: 0, flight: 0 }
  if (t < plan.lineAtMs) return { ...base, phase: 'flight', rodFrame: 1, flight: clamp01((t - tuning.castMs) / tuning.flightMs) }
  if (t < plan.biteAtMs) return { ...base, phase: 'waiting' }
  if (t < plan.biteEndsAtMs) return { ...base, phase: 'bite', sunk: Math.floor((t - plan.biteAtMs) / 90) % 2 === 0 }
  return t < plan.biteEndsAtMs + tuning.escapeMs ? { ...base, phase: 'escaped', flight: 0 } : { ...base, phase: 'done', flight: 0 }
}

/** Total run length, so the controller knows when to release the input lock. */
export function fishingEndsAtMs(plan: FishingPlan, reelAtMs: number | null, caught: boolean): number {
  const { tuning } = plan
  if (reelAtMs === null) return plan.biteEndsAtMs + tuning.escapeMs
  return reelAtMs + tuning.reelMs + (caught ? tuning.rewardMs : tuning.escapeMs)
}
