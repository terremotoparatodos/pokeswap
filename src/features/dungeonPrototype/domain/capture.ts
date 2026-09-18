// Capture (D3).
//
// APPROVED: capture exists in the open world and inside dungeons; the basic
// Poké Ball has a very low chance; better balls will come from crafting; a
// capture made inside a dungeon is expedition loot and is lost on a wipe.
//
// PROTOTYPE ASSUMPTION: the formula and every number. It is deliberately the
// simplest thing that still reacts to the inputs the real one will use, so the
// UX can be judged (how often a throw works, how it feels to risk a catch deep
// in a run) without pretending to be balance.

import { isFainted, type PokemonInstance, type StatusCondition } from './party'

export interface BallDefinition {
  readonly id: string
  readonly name: string
  /** Multiplier over the base chance. The basic ball is 1. */
  readonly bonus: number
}

/** PROTOTYPE: only the basic ball exists; the rest arrive with crafting. */
export const BASIC_BALL: BallDefinition = { id: 'poke_ball', name: 'Poké Ball', bonus: 1 }

export const STATUS_BONUS: Readonly<Record<StatusCondition, number>> = {
  none: 1, burn: 1.5, poison: 1.5, paralysis: 1.5, freeze: 2, sleep: 2.5,
}

export interface CaptureConfig {
  /** Scales the whole formula. Low on purpose: the basic ball should disappoint. */
  readonly scale: number
  readonly minChance: number
  readonly maxChance: number
}

export const DEFAULT_CAPTURE_CONFIG: CaptureConfig = { scale: 0.5, minChance: 0.01, maxChance: 0.75 }

export interface CaptureInput {
  readonly target: PokemonInstance
  /** 3…255, as in the games. Not in the repo yet — see the gap report. */
  readonly catchRate: number
  readonly ball?: BallDefinition
  readonly config?: CaptureConfig
}

/**
 * chance = scale · (catchRate / 255) · hpFactor · statusBonus · ballBonus
 *
 * `hpFactor` runs from 1/3 at full health to 1 at a sliver, the same shape the
 * games use. A healthy 45-catch-rate Pokémon with a basic ball lands around
 * 3 %; the same one asleep and nearly fainted is around 20 %.
 */
export function captureChance(input: CaptureInput): number {
  const { target } = input
  const config = input.config ?? DEFAULT_CAPTURE_CONFIG
  if (isFainted(target)) return 0
  const hpFraction = Math.max(0, Math.min(1, target.hp / target.maxHp))
  const hpFactor = (3 - 2 * hpFraction) / 3
  const raw = config.scale
    * (Math.max(1, input.catchRate) / 255)
    * hpFactor
    * STATUS_BONUS[target.status]
    * (input.ball ?? BASIC_BALL).bonus
  return Math.max(config.minChance, Math.min(config.maxChance, raw))
}

export interface CaptureAttempt {
  readonly captured: boolean
  readonly chance: number
  /** Three wobbles, purely for the animation; the outcome is decided by `chance`. */
  readonly shakes: number
}

/** `roll` is injected: the same roll always gives the same outcome. */
export function attemptCapture(input: CaptureInput, roll: number): CaptureAttempt {
  const chance = captureChance(input)
  const captured = roll < chance
  const shakes = captured ? 3 : Math.min(2, Math.floor((1 - roll / Math.max(chance, 0.0001)) * 3 + 3))
  return { captured, chance, shakes: Math.max(0, shakes) }
}
