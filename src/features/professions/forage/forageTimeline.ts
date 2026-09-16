// Foraging timeline (R31-C4.1): how a plant is gathered.
//
// Two styles, and the *domain* chooses which one: nodes with `minToolTier` 0
// (the berry bush and the herb patch) are gathered **by hand**, and nodes that
// demand a sickle (the wild grove and the frost bloom) are **cut**. Nothing is
// forced: picking a berry with a scythe would look absurd, and the catalog
// already says it is not needed.
//
// Pure and time-based, like the pickaxe swing and the chopping timeline.

/** By hand: reach into the plant, close the fingers, let it settle back. */
export const PICK_MS = { reach: 300, pluck: 120, settle: 220 } as const
/** With the sickle: a horizontal sweep, slower to wind up and quick through. */
export const SWEEP_MS = { windup: 260, sweep: 130, recover: 250 } as const
export const FORAGE_REWARD_MS = 900
export const MIN_PICKS = 2
export const MAX_PICKS = 4

export type ForageStyle = 'hand' | 'sickle'
export type ForagePhase = 'reach' | 'take' | 'settle' | 'reward' | 'done'

export interface ForageTimeline {
  readonly style: ForageStyle
  readonly picks: number
  readonly cycleMs: number
  /** When the result is applied. */
  readonly resultAtMs: number
  readonly totalMs: number
}

export function forageTimeline(actionSeconds: number, style: ForageStyle): ForageTimeline {
  const picks = Math.max(MIN_PICKS, Math.min(MAX_PICKS, Math.round(actionSeconds / 6)))
  const cycleMs = style === 'hand'
    ? PICK_MS.reach + PICK_MS.pluck + PICK_MS.settle
    : SWEEP_MS.windup + SWEEP_MS.sweep + SWEEP_MS.recover
  const resultAtMs = picks * cycleMs
  return { style, picks, cycleMs, resultAtMs, totalMs: resultAtMs + FORAGE_REWARD_MS }
}

export interface ForagePose {
  readonly phase: ForagePhase
  readonly pick: number
  /** Sickle frame: 0 raised, 1 mid, 2 through. Always 1 while gathering by hand. */
  readonly toolFrame: 0 | 1 | 2
  /** Sway of the plant, in world pixels; a plant bends, it does not shake. */
  readonly sway: number
  /** 0..1 inside the reward phase. */
  readonly rewardProgress: number
}

export function foragePose(timeline: ForageTimeline, elapsedMs: number): ForagePose {
  const t = Math.max(0, elapsedMs)
  const base = { pick: timeline.picks - 1, toolFrame: 1 as const, sway: 0, rewardProgress: 0 }
  if (t >= timeline.totalMs) return { ...base, phase: 'done', rewardProgress: 1 }
  if (t >= timeline.resultAtMs) {
    return { ...base, phase: 'reward', rewardProgress: (t - timeline.resultAtMs) / FORAGE_REWARD_MS }
  }
  const pick = Math.floor(t / timeline.cycleMs)
  const local = t - pick * timeline.cycleMs
  const first = timeline.style === 'hand' ? PICK_MS.reach : SWEEP_MS.windup
  const second = timeline.style === 'hand' ? PICK_MS.pluck : SWEEP_MS.sweep
  const away = pick % 2 === 0 ? 1 : -1

  if (local < first) {
    // The plant is still; the hand (or the blade) is on its way in.
    return { ...base, pick, phase: 'reach', toolFrame: 0, sway: 0 }
  }
  if (local < first + second) {
    return { ...base, pick, phase: 'take', toolFrame: 2, sway: away * 2 }
  }
  // Settling: the plant swings back and dies down, instead of snapping still.
  const settle = local - first - second
  const span = timeline.cycleMs - first - second
  const decay = 1 - settle / span
  return { ...base, pick, phase: 'settle', sway: -away * 2 * decay * Math.cos((settle / span) * Math.PI * 1.5), rewardProgress: 0 }
}

/** Pick indices whose take begins in (fromMs, toMs]: when to spawn petals. */
export function takesBetween(timeline: ForageTimeline, fromMs: number, toMs: number): number[] {
  const hits: number[] = []
  const first = timeline.style === 'hand' ? PICK_MS.reach : SWEEP_MS.windup
  for (let pick = 0; pick < timeline.picks; pick++) {
    const at = pick * timeline.cycleMs + first
    if (at > fromMs && at <= toMs) hits.push(pick)
  }
  return hits
}
