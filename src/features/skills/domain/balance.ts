// Every Skills balance number that is not a property of one resource or crop.
//
// One place on purpose: components, controllers and adapters never carry their
// own copies. Resource- and crop-specific values live in their catalogs
// (resources.ts, crops.ts) because they only make sense next to the thing they
// describe. Changing a number here must not require touching anything else;
// the tests read these values instead of restating them.

import type { Aptitude } from './aptitude/aptitudeScale'

/** Provisional cap. The design covers 1–50; the curve can extend later. */
export const MAX_SKILL_LEVEL = 50

/**
 * XP needed to go from `L` to `L + 1`:
 *
 *   round(linear · L + base · growth^L)
 *
 * The linear term makes the first levels quick (L2 is four basic actions);
 * the exponential term takes over in the 30s so the late levels are an
 * investment: at the reference pace (scripts/skills/pacing.ts: probabilistic
 * work, the normative stock per node and a 0.4 s commit since RESOURCE
 * YIELD-2; Talar) Nv 10 takes ~13 min, Nv 25 ~1,2 h, Nv 40 ~8,7 h and Nv 50
 * ~28,5 h of active play (Minería ~32 h, Agricultura ~19 h). The ~14 h once
 * quoted here assumed the catalog's advisory charges (see pacing.ts).
 * `growth` is the knob for "how steep is the midgame"; `linear` for "how fast
 * is the tutorial". See docs/skills/SKILLS_1_REPORT.md §7.
 */
export const XP_CURVE = { linear: 20, base: 15, growth: 1.19 } as const

/**
 * Work duration multiplier by aptitude 1..5. 3 is the reference Pokémon.
 * A specialist (5) works ~1.6× as fast as a clumsy one (1): noticeable, never
 * the difference between playing and not playing.
 */
export const APTITUDE_DURATION: Readonly<Record<Aptitude, number>> = { 1: 1.3, 2: 1.12, 3: 1, 4: 0.9, 5: 0.8 }

/** Chance of one extra unit per completed action, by aptitude. */
export const APTITUDE_BONUS_CHANCE: Readonly<Record<Aptitude, number>> = { 1: 0, 2: 0.05, 3: 0.1, 4: 0.18, 5: 0.25 }

/**
 * "Ritmo": the player's own mastery, shown in the roadmap every `everyLevels`
 * so there is always a milestone between resource unlocks. Since PROB-2 the
 * level itself raises the chance of every attempt (ATTEMPTS, `curveGamma`);
 * Ritmo absorbed into that curve and only names the milestones. `reduction`
 * is the pre-PROB-2 fixed-duration discount (`workDuration`, scripts only).
 */
export const RHYTHM = { everyLevels: 10, reduction: 0.04 } as const

/**
 * Pre-PROB-2 floor of the fixed-duration model (`workDuration`, kept for the
 * MAP-1 audit script). Work and the pacing tool no longer use it: an action lasts a whole
 * number of attempts (see ATTEMPTS).
 */
export const MIN_ACTION_MS = 1200

/**
 * Probabilistic work (SKILLS PROB-2, docs/design/SKILLS_PROB_1_AUDIT.md §2.4).
 *
 * An action is a run of attempts, one per WORLD work tick. Each attempt
 * succeeds with the same chance `p`; the first success completes the action.
 *
 *   x    = (level − requiredLevel) / (MAX_SKILL_LEVEL − requiredLevel), in [0, 1]
 *   pReq = min(maxRequiredChance, tick / (unlockSlowdown · baseMs))
 *   b    = pReq + (pMax[tier] − pReq) · x^curveGamma
 *   p    = min(chanceCap, 1 − (1 − b)^(1 / APTITUDE_DURATION[aptitude]))
 *   cap  = clamp(⌈capFactor / p⌉, minAttempts, maxAttempts)
 *
 * - `unlockSlowdown`: before the cap, an aptitude-3 worker at the unlock level
 *   averages 1.25 × the catalog's base duration. With the cap (below) a basic
 *   resource at level 1 averages ~3.1 s (2.5–3.8 s over aptitudes 5..1).
 * - `curveGamma` 2 keeps the first levels close to the old pace; the big
 *   gains come in the second half.
 * - Aptitude acts as "that many rolls per attempt": a specialist still works
 *   ~1.6× as fast as a clumsy worker, and p never exceeds 1.
 * - `cap`: the attempt that always succeeds, so nobody waits more than ~1.5×
 *   the uncapped mean (WORK CANCEL-1 halved it from ⌈3/p⌉ in [3, 40]: the
 *   longest wait went from 24 s to 12 s). `maxAttempts` only binds for a
 *   cúmulo cristalino at level 45–46 with an aptitude-2 worker (⌈1.5/p⌉ =
 *   21 → 20); `minAttempts` never binds while p ≤ chanceCap.
 */
export const ATTEMPTS = {
  unlockSlowdown: 1.25,
  curveGamma: 2,
  maxRequiredChance: 0.5,
  chanceCap: 0.98,
  capFactor: 1.5,
  minAttempts: 2,
  maxAttempts: 20,
  /** WORLD's work tick (the attempt length) must stay inside these bounds. */
  minTickMs: 400,
  maxTickMs: 1200,
} as const

/** Chance per attempt at MAX_SKILL_LEVEL (before aptitude), by ladder tier. */
export const TIER_MAX_CHANCE = {
  'muy básico': 0.95,
  básico: 0.85,
  intermedio: 0.72,
  avanzado: 0.58,
  especializado: 0.48,
} as const

/**
 * How early WORLD may settle a completed action relative to the authorized
 * duration (network jitter, frame timing). Earlier than this is refused.
 */
export const SETTLE_EARLY_TOLERANCE_MS = 250

/** An authorization older than this can no longer be settled as completed. */
export const AUTHORIZATION_TTL_MS = 10 * 60 * 1000

/** Bumped whenever a rule or a number above changes meaning. Stored with each settlement. */
export const SKILLS_RULES_VERSION = 'skills-1.3'
