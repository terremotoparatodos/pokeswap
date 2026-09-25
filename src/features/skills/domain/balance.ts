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
 * The linear term makes the first levels quick (L2 is three basic actions);
 * the exponential term takes over in the 30s so the late levels are an
 * investment. `growth` is the knob for "how steep is the midgame"; `linear`
 * for "how fast is the tutorial". See docs/skills/SKILLS_1_REPORT.md §7.
 */
export const XP_CURVE = { linear: 25, base: 8, growth: 1.16 } as const

/**
 * Work duration multiplier by aptitude 1..5. 3 is the reference Pokémon.
 * A specialist (5) works ~1.6× as fast as a clumsy one (1): noticeable, never
 * the difference between playing and not playing.
 */
export const APTITUDE_DURATION: Readonly<Record<Aptitude, number>> = { 1: 1.3, 2: 1.12, 3: 1, 4: 0.9, 5: 0.8 }

/** Chance of one extra unit per completed action, by aptitude. */
export const APTITUDE_BONUS_CHANCE: Readonly<Record<Aptitude, number>> = { 1: 0, 2: 0.05, 3: 0.1, 4: 0.18, 5: 0.25 }

/**
 * "Ritmo": the player's own mastery. Every milestone level shaves a flat
 * fraction off every action's duration in that skill. Shown in the roadmap,
 * so there is always a reason to keep going between resource unlocks.
 */
export const RHYTHM = { everyLevels: 10, reduction: 0.04 } as const

/** No action is ever shorter than this, whatever stacks. */
export const MIN_ACTION_MS = 1200

/**
 * How early WORLD may settle a completed action relative to the authorized
 * duration (network jitter, frame timing). Earlier than this is refused.
 */
export const SETTLE_EARLY_TOLERANCE_MS = 250

/** An authorization older than this can no longer be settled as completed. */
export const AUTHORIZATION_TTL_MS = 10 * 60 * 1000

/** Bumped whenever a rule or a number above changes meaning. Stored with each settlement. */
export const SKILLS_RULES_VERSION = 'skills-1.0'
