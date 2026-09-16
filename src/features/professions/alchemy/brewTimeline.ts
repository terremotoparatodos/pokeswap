// Brewing timeline (R31-C4): the shape of one crafting action.
//
// Pure and time-based, like the mining swing and the chopping timeline, so the
// overlay, the card and the tests agree on when the flask fills, when a unit is
// bottled and when the reward shows.
//
// A batch does not replay the whole ceremony N times — that would be unbearable
// at quantity 20. The preparation happens once and the *bottling* repeats, one
// short pulse per unit, capped so a big batch still ends in a few seconds.

/** Load the ingredients, heat, let it boil, then bottle unit by unit. */
export const BREW_MS = { load: 420, heat: 380, boil: 900 } as const
export const BOTTLE_MS = 220
/** Even a batch of 100 finishes: past this many pulses the rest are implied. */
export const MAX_BOTTLE_PULSES = 6
export const BREW_REWARD_MS = 900

export type BrewPhase = 'load' | 'heat' | 'boil' | 'bottle' | 'reward' | 'done'

export interface BrewTimeline {
  readonly quantity: number
  /** Visible bottling pulses (≤ quantity). */
  readonly pulses: number
  readonly loadAtMs: number
  readonly heatAtMs: number
  readonly boilAtMs: number
  readonly bottleAtMs: number
  /** When the crafting result is applied. */
  readonly resultAtMs: number
  readonly totalMs: number
}

/**
 * `actionSeconds` is what the domain says this batch takes; it only stretches
 * the boil, so a slow recipe feels slower without making the player wait for a
 * proportional animation.
 */
export function brewTimeline(actionSeconds: number, quantity: number): BrewTimeline {
  const units = Math.max(1, Math.floor(quantity))
  const pulses = Math.min(MAX_BOTTLE_PULSES, units)
  const boil = Math.round(Math.max(BREW_MS.boil, Math.min(2600, actionSeconds * 260)))
  const loadAtMs = BREW_MS.load
  const heatAtMs = loadAtMs + BREW_MS.heat
  const boilAtMs = heatAtMs + boil
  const bottleAtMs = boilAtMs
  const resultAtMs = bottleAtMs + pulses * BOTTLE_MS
  return { quantity: units, pulses, loadAtMs, heatAtMs, boilAtMs, bottleAtMs, resultAtMs, totalMs: resultAtMs + BREW_REWARD_MS }
}

export interface BrewPose {
  readonly phase: BrewPhase
  /** 0..1 of liquid in the flask. */
  readonly fill: number
  /** 0..1 boiling intensity; drives bubbles and steam. */
  readonly boil: number
  /** Units already bottled. */
  readonly bottled: number
  /** 0..1 inside the reward phase. */
  readonly rewardProgress: number
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, value))

export function brewPose(timeline: BrewTimeline, elapsedMs: number): BrewPose {
  const t = Math.max(0, elapsedMs)
  if (t >= timeline.totalMs) return { phase: 'done', fill: 0, boil: 0, bottled: timeline.quantity, rewardProgress: 1 }
  if (t >= timeline.resultAtMs) {
    return { phase: 'reward', fill: 0, boil: 0, bottled: timeline.quantity, rewardProgress: (t - timeline.resultAtMs) / BREW_REWARD_MS }
  }
  if (t >= timeline.bottleAtMs) {
    const done = Math.floor((t - timeline.bottleAtMs) / BOTTLE_MS)
    const share = done / timeline.pulses
    return {
      phase: 'bottle',
      // The flask empties as the phials fill.
      fill: 1 - share,
      boil: 0.25,
      bottled: Math.min(timeline.quantity, Math.round(share * timeline.quantity)),
      rewardProgress: 0,
    }
  }
  if (t >= timeline.heatAtMs) {
    const share = clamp01((t - timeline.heatAtMs) / (timeline.boilAtMs - timeline.heatAtMs))
    // It comes to the boil and stays there; the colour is already the product's.
    return { phase: 'boil', fill: 1, boil: 0.35 + 0.65 * Math.min(1, share * 2), bottled: 0, rewardProgress: 0 }
  }
  if (t >= timeline.loadAtMs) {
    return { phase: 'heat', fill: 1, boil: clamp01((t - timeline.loadAtMs) / BREW_MS.heat) * 0.35, bottled: 0, rewardProgress: 0 }
  }
  // Loading: the ingredients go in and the flask fills.
  return { phase: 'load', fill: clamp01(t / BREW_MS.load), boil: 0, bottled: 0, rewardProgress: 0 }
}

/** Bottling pulses that begin in (fromMs, toMs]: when to drop a droplet. */
export function bottlesBetween(timeline: BrewTimeline, fromMs: number, toMs: number): number[] {
  const hits: number[] = []
  for (let pulse = 0; pulse < timeline.pulses; pulse++) {
    const at = timeline.bottleAtMs + pulse * BOTTLE_MS
    if (at > fromMs && at <= toMs) hits.push(pulse)
  }
  return hits
}

/** Ingredient drops that begin in (fromMs, toMs]: one per ingredient, while loading. */
export function loadsBetween(timeline: BrewTimeline, ingredients: number, fromMs: number, toMs: number): number[] {
  const hits: number[] = []
  const step = BREW_MS.load / Math.max(1, ingredients)
  for (let i = 0; i < ingredients; i++) {
    // Offset by half a step so the first ingredient still lands after t = 0.
    const at = (i + 0.5) * step
    if (at > fromMs && at <= toMs) hits.push(i)
  }
  return hits
}
