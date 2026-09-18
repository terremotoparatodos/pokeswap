// The Action Bar (R32.3).
//
// PokeSwap has no turns. Every combatant fills a bar and acts when it is full,
// so Speed is not an ordering any more — it is a **rate**. That one decision
// is what forces most of the adaptations in these rules: priority, recharge,
// paralysis and sleep all had to be re-read as time instead of turn order.
//
// The approved baseline:
//
//     cooldown = clamp(2.6 * sqrt(60 / Speed), 1.4, 4.0) seconds
//
// The square root, not a straight ratio, is the shape that matters: it keeps
// the middle of the range where the feel should be while compressing both
// ends, so a very fast Pokémon is clearly faster without acting twice per
// enemy action, and a very slow one is clearly slower without being
// unplayable. The numbers are PLAYTEST and live in the config.
//
// Note for whoever compares this with the dungeon prototype: the prototype
// runs D1.2.4's readability pass (3.9 / 2.1 / 6.0 s), 1.5× these values. The
// shapes are identical; only the numbers differ, and the R32.3 contract fixes
// these.
//
// Everything is whole milliseconds. Seconds are a float, and a float that
// accumulates for three hours is a desync waiting to happen.

import type { BattleRulesConfig } from './config'
import type { BattleCombatant } from './state'
import { effectiveStat } from './stats'

/** The bar's length at a given Speed, before any multiplier, in ms. */
export function baseCooldownMs(speed: number, config: BattleRulesConfig): number {
  const bar = config.actionBar
  const ratio = bar.referenceSpeed / Math.max(1, speed)
  const seconds = Math.min(bar.maxSeconds, Math.max(bar.minSeconds, bar.baseSeconds * Math.sqrt(ratio)))
  return Math.round(seconds * 1000)
}

/**
 * How long this combatant's current Action Window lasts.
 *
 * Three things stretch or shrink it, and all three are runtime:
 *   - Speed, through stages and modifiers (never the persistent stat, §13);
 *   - paralysis, which doubles every cooldown instead of cutting Speed — the
 *     traditional Speed cut would be invisible mid-bar, and this is felt;
 *   - whatever the **last** action left behind: a priority move halves the
 *     next one, a recharge move doubles it, spending the last Protect charge
 *     doubles it.
 *
 * Rounded once, at the end, so the value is a whole number of milliseconds and
 * two machines computing it agree exactly.
 */
export function cooldownMs(combatant: BattleCombatant, config: BattleRulesConfig): number {
  const speed = effectiveStat(combatant, 'spe', config)
  const paralysis = combatant.condition.majorStatus === 'paralysis'
    ? config.actionBar.paralysisMultiplier
    : 1
  const base = baseCooldownMs(speed, config)
  return Math.max(1, Math.round(base * paralysis * combatant.runtime.cooldownMultiplier))
}

/** 0…1, for a HUD. The rules themselves read elapsed milliseconds. */
export const actionBarFill = (combatant: BattleCombatant, config: BattleRulesConfig): number =>
  Math.max(0, Math.min(1, combatant.runtime.actionElapsedMs / cooldownMs(combatant, config)))

/** Milliseconds until this combatant acts; 0 when it already should have. */
export const msUntilReady = (combatant: BattleCombatant, config: BattleRulesConfig): number =>
  Math.max(0, cooldownMs(combatant, config) - combatant.runtime.actionElapsedMs)

/**
 * What the next cooldown is multiplied by, given the move just used.
 *
 * Priority keeps its real catalog value — a Quick Attack is still priority 1
 * and the data stays honest — but in a barless game the meaning of "goes
 * first" is "comes back sooner" (§14).
 */
export function cooldownAfterMove(
  priority: number, recharges: boolean, config: BattleRulesConfig,
): number {
  if (recharges) return config.actionBar.rechargeMultiplier
  if (priority > 0) return config.actionBar.priorityMultiplier
  return 1
}
