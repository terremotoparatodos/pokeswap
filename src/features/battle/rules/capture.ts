// Capture, as a pure contract (R32.3).
//
// What this owns: **did the ball work**. Nothing else. No ownership, no
// persistence, no expedition loot, no instance creation, no Dungeon. That
// whole boundary is I-1 and it is decided elsewhere: a successful capture in
// an expedition is loot until the player retreats, and only the server writes
// that (R32_INTEGRATION_AUDIT §4). This file would give the same answer for a
// capture in a field, in a cave or in a test.
//
// PLAYTEST — every number. The formula reacts to the inputs the real one will
// use (catch rate, how hurt the target is, its status, the ball) and is
// deliberately the simplest thing that does so. It is not balance and it is
// not frozen; it is marked here so nobody mistakes it for either.
//
// The roll is injected, like every other roll in these rules.

import type { BattleRulesConfig } from './config'
import type { RngState } from './rng'
import { drawRandom } from './rng'
import type { BallSpec, BattleCombatant } from './state'
import { currentHpOf, isCombatantFainted } from './state'

export interface CaptureInput {
  readonly catchRate: number
  readonly currentHp: number
  readonly maxHp: number
  readonly majorStatus: string
  readonly ball: BallSpec
  /** Present for traceability and future formulas; the R32.3 shape does not read it. */
  readonly level?: number
}

/**
 * `chance = scale · (catchRate / 255) · hpFactor · statusBonus · ballBonus`
 *
 * `hpFactor` runs from 1/3 at full health to 1 at a sliver, which is the shape
 * the games use. A fainted target cannot be caught.
 */
export function captureChance(input: CaptureInput, config: BattleRulesConfig): number {
  const capture = config.capture
  if (input.maxHp <= 0 || input.currentHp <= 0) return 0
  const hpFraction = Math.max(0, Math.min(1, input.currentHp / input.maxHp))
  const hpFactor = (3 - 2 * hpFraction) / 3
  const raw = capture.scale
    * (Math.max(1, input.catchRate) / 255)
    * hpFactor
    * (capture.statusBonus[input.majorStatus] ?? 1)
    * input.ball.bonus
  return Math.max(capture.minChance, Math.min(capture.maxChance, raw))
}

export interface CaptureResult {
  readonly captured: boolean
  readonly chance: number
  /** 0–3 wobbles. Presentation only: the verdict is already decided. */
  readonly shakes: number
  readonly rng: RngState
}

/** One throw. Spends exactly one draw. */
export function resolveCapture(
  input: CaptureInput, config: BattleRulesConfig, rng: RngState,
): CaptureResult {
  const chance = captureChance(input, config)
  const draw = drawRandom(rng)
  const captured = draw.value < chance
  const shakes = captured ? 3 : Math.max(0, Math.min(2, Math.floor((chance / Math.max(draw.value, 1e-9)) * 3)))
  return { captured, chance, shakes, rng: draw.rng }
}

/** The capture input a combatant on the field represents. */
export function captureInputFor(
  target: BattleCombatant, catchRate: number, ball: BallSpec,
): CaptureInput {
  return {
    catchRate,
    currentHp: isCombatantFainted(target) ? 0 : currentHpOf(target),
    maxHp: target.stats.hp,
    majorStatus: target.condition.majorStatus,
    ball,
    level: target.level,
  }
}
