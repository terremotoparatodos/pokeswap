// Probabilistic work (SKILLS PROB-2): the chance of one attempt, the attempt
// that always succeeds, and the secret draw of how many attempts an action
// takes. Pure: the caller injects the tick and the randomness.
//
// The draw is one Bernoulli roll per attempt, stopped at the first success or
// at the cap. Drawing all rolls at authorization and scheduling the end at
// `attempts × tick` gives exactly the distribution of rolling live on every
// tick (docs/design/SKILLS_PROB_1_AUDIT.md §2.5); only *when* the answer is
// known differs, and it never leaves the server.

import { APTITUDE_DURATION, ATTEMPTS, MAX_SKILL_LEVEL, TIER_MAX_CHANCE } from './balance'
import type { Aptitude } from './aptitude/aptitudeScale'
import type { ResourceTier } from './resources'

export interface ChanceInput {
  /** The player's level in the skill. */
  readonly level: number
  readonly requiredLevel: number
  /** The catalog's base duration (resource `baseDurationMs`, `FARM_ACTION_MS`). */
  readonly baseMs: number
  readonly tier: ResourceTier
  readonly aptitude: Aptitude
  /** WORLD's work tick: the length of one attempt. */
  readonly attemptMs: number
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value))

/** A tick WORLD may run work on: an integer inside ATTEMPTS' bounds. */
export function isValidAttemptMs(attemptMs: unknown): attemptMs is number {
  return Number.isInteger(attemptMs) && (attemptMs as number) >= ATTEMPTS.minTickMs && (attemptMs as number) <= ATTEMPTS.maxTickMs
}

/** How far the player is between the unlock (0) and the level cap (1). */
export function levelProgress(level: number, requiredLevel: number): number {
  if (requiredLevel >= MAX_SKILL_LEVEL) return level >= requiredLevel ? 1 : 0
  return clamp((level - requiredLevel) / (MAX_SKILL_LEVEL - requiredLevel), 0, 1)
}

/** The chance that one attempt succeeds. Always in (0, chanceCap]. */
export function attemptChance(input: ChanceInput): number {
  const required = Math.min(ATTEMPTS.maxRequiredChance, input.attemptMs / (ATTEMPTS.unlockSlowdown * input.baseMs))
  const top = Math.max(required, TIER_MAX_CHANCE[input.tier])
  const base = required + (top - required) * levelProgress(input.level, input.requiredLevel) ** ATTEMPTS.curveGamma
  const withAptitude = 1 - (1 - base) ** (1 / APTITUDE_DURATION[input.aptitude])
  return Math.min(ATTEMPTS.chanceCap, withAptitude)
}

/** The attempt that always succeeds: ⌈capFactor / p⌉, inside [minAttempts, maxAttempts]. */
export function attemptCap(chance: number): number {
  return clamp(Math.ceil(ATTEMPTS.capFactor / chance), ATTEMPTS.minAttempts, ATTEMPTS.maxAttempts)
}

/**
 * How many attempts this action takes: 1 + the failures before the first
 * success, never more than `cap`. `random` must be server-side and
 * unpredictable in production (the SKILLS random port); tests inject a script.
 */
export function drawAttempts(chance: number, cap: number, random: () => number): number {
  for (let attempt = 1; attempt < cap; attempt++) {
    if (random() < chance) return attempt
  }
  return cap
}

/** Exact P(attempts = n) for n = 1..cap (index n − 1). Sums to 1. */
export function attemptDistribution(chance: number, cap: number): number[] {
  const out: number[] = []
  for (let n = 1; n < cap; n++) out.push((1 - chance) ** (n - 1) * chance)
  out.push((1 - chance) ** (cap - 1))
  return out
}

/** E[attempts] of the capped draw: (1 − (1 − p)^cap) / p. */
export function expectedAttempts(chance: number, cap: number): number {
  return (1 - (1 - chance) ** cap) / chance
}

/** The smallest n with P(attempts ≤ n) ≥ q (0 < q < 1). */
export function attemptQuantile(chance: number, cap: number, q: number): number {
  let cumulative = 0
  const distribution = attemptDistribution(chance, cap)
  for (let n = 0; n < distribution.length; n++) {
    cumulative += distribution[n]
    if (cumulative >= q - 1e-12) return n + 1
  }
  return cap
}
