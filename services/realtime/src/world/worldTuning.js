/**
 * WORLD pacing knobs, in one place (INTEGRATION-1).
 *
 * These are how the *world* behaves physically, not what a skill yields. They
 * are provisional: SKILLS/design can move them later without touching the
 * authority. Nothing here was rebalanced by the integration.
 */

/** How long a depleted node takes to come back, per physical kind. */
export const RESPAWN_MS = Object.freeze({ tree: 90_000, rock: 90_000 })

/** A planted crop looks GROWING from this share of its grow time on (visual stage only). */
export const PLOT_GROWING_AT = 0.5
