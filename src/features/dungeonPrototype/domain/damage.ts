// Damage, accuracy, crits, stat stages and the Action Bar / Speed relation (D2).
//
// The damage formula is the standard Gen-3+ one, simplified where the repo has
// no data to fill (no natures, IVs, EVs, abilities or items). The Action Bar
// formula is this station's proposal and is the main thing to review here.

import { statFor, type PokemonInstance, type PokemonSpecies, type StatusCondition } from './party'
import type { MoveDefinition, StatKey } from './moves'
import { stabFor, typeEffectiveness } from './typeChart'

// ── Stat stages ────────────────────────────────────────────────────────────

export type StatStages = Partial<Record<StatKey, number>>

/** Gen-3+ multipliers, clamped to ±6. */
export function stageMultiplier(stages: number): number {
  const clamped = Math.max(-6, Math.min(6, stages))
  return clamped >= 0 ? (2 + clamped) / 2 : 2 / (2 - clamped)
}

export const applyStage = (stages: StatStages, stat: StatKey, delta: number): StatStages => ({
  ...stages,
  [stat]: Math.max(-6, Math.min(6, (stages[stat] ?? 0) + delta)),
})

export interface Combatant {
  readonly pokemon: PokemonInstance
  readonly species: PokemonSpecies
  readonly stages: StatStages
  /** Alpha and coop scaling ride on top of the raw stats. */
  readonly modifiers?: CombatModifiers
}

export interface CombatModifiers {
  readonly damageDealt?: number
  readonly damageTaken?: number
  readonly speed?: number
  /** 0…1: how much of an incoming status chance is ignored. */
  readonly statusResistance?: number
}

const BASE_INDEX: Record<StatKey, number> = { attack: 1, defense: 2, spAttack: 3, spDefense: 4, speed: 5 }

/** A live stat: base → level → stage → status → modifiers. */
export function effectiveStat(combatant: Combatant, stat: StatKey): number {
  const base = combatant.species.baseStats[BASE_INDEX[stat]]
  let value = statFor(base, combatant.pokemon.level) * stageMultiplier(combatant.stages[stat] ?? 0)
  // Burn halves physical attack and paralysis halves speed, as in the games.
  if (stat === 'attack' && combatant.pokemon.status === 'burn') value *= 0.5
  if (stat === 'speed' && combatant.pokemon.status === 'paralysis') value *= 0.5
  if (stat === 'speed' && combatant.modifiers?.speed) value *= combatant.modifiers.speed
  return Math.max(1, value)
}

// ── Action Bar ─────────────────────────────────────────────────────────────

/**
 * PROTOTYPE ASSUMPTION — Speed → Action Bar.
 *
 *     rate = 1 + effectiveSpeed / REFERENCE_SPEED
 *     fillSeconds = clamp(BASE_FILL_SECONDS / rate, MIN, MAX)
 *
 * Why this shape: it is linear in Speed (easy to reason about and to balance),
 * it never reaches zero, and the clamp is what actually bounds the game. With
 * the values below a Slowpoke-ish 30 Speed fills in ~2.6 s and a Jolteon-ish
 * 130 in ~1.5 s — a ratio near 1.8×, enough to feel the difference without a
 * fast Pokémon acting three times per slow action. Paralysis and stat stages
 * enter through `effectiveStat`, so Thunder Wave is worth a whole action.
 *
 * Alternatives to weigh later: a square-root curve (compresses the extremes) or
 * a fixed "ticks per second" table per Speed band (very predictable, less
 * granular). Both are in the design doc.
 */
export const ACTION_BAR = {
  baseFillSeconds: 3.2,
  referenceSpeed: 120,
  minFillSeconds: 1.2,
  maxFillSeconds: 5,
} as const

export function fillSeconds(speed: number, config = ACTION_BAR): number {
  const rate = 1 + Math.max(0, speed) / config.referenceSpeed
  return Math.min(config.maxFillSeconds, Math.max(config.minFillSeconds, config.baseFillSeconds / rate))
}

export const barSecondsFor = (combatant: Combatant, config = ACTION_BAR): number =>
  fillSeconds(effectiveStat(combatant, 'speed'), config)

// ── Damage ─────────────────────────────────────────────────────────────────

export interface DamageRolls {
  /** 0–1: below the accuracy fraction the move connects. */
  readonly accuracy: number
  /** 0–1: below the crit rate it is a critical hit. */
  readonly crit: number
  /** 0–1: mapped to the 0.85…1.00 spread. */
  readonly spread: number
  /** 0–1: below the secondary chance the status lands. */
  readonly secondary: number
}

export interface DamageResult {
  readonly hit: boolean
  readonly damage: number
  readonly critical: boolean
  readonly effectiveness: number
  readonly stab: number
  readonly statusApplied: StatusCondition | null
}

/** Gen-3+ base crit rate. No crit-boosting items or abilities in the prototype. */
export const CRIT_RATE = 1 / 16
export const CRIT_MULTIPLIER = 1.5

export function computeDamage(
  attacker: Combatant, defender: Combatant, move: MoveDefinition, rolls: DamageRolls,
): DamageResult {
  const effectiveness = typeEffectiveness(move.type, defender.species.types)

  if (move.accuracy !== null && rolls.accuracy >= move.accuracy / 100) {
    return { hit: false, damage: 0, critical: false, effectiveness, stab: 1, statusApplied: null }
  }
  if (effectiveness === 0) {
    return { hit: true, damage: 0, critical: false, effectiveness, stab: 1, statusApplied: null }
  }

  const secondary = move.inflicts
    && rolls.secondary < move.inflicts.chance * (1 - (defender.modifiers?.statusResistance ?? 0))
    && defender.pokemon.status === 'none'
  const statusApplied = secondary ? move.inflicts!.status : null

  if (move.power === null) {
    return { hit: true, damage: 0, critical: false, effectiveness, stab: 1, statusApplied }
  }

  const physical = move.category === 'physical'
  const attack = effectiveStat(attacker, physical ? 'attack' : 'spAttack')
  const defense = effectiveStat(defender, physical ? 'defense' : 'spDefense')
  const level = attacker.pokemon.level
  const base = ((2 * level) / 5 + 2) * move.power * (attack / defense) / 50 + 2

  const critical = rolls.crit < CRIT_RATE
  const stab = stabFor(move.type, attacker.species.types)
  const spread = 0.85 + rolls.spread * 0.15
  const dealt = attacker.modifiers?.damageDealt ?? 1
  const taken = defender.modifiers?.damageTaken ?? 1

  const damage = Math.max(1, Math.floor(
    base * (critical ? CRIT_MULTIPLIER : 1) * stab * effectiveness * spread * dealt * taken,
  ))
  return { hit: true, damage, critical, effectiveness, stab, statusApplied }
}

/** Burn and poison tick between actions. PROTOTYPE ASSUMPTION: 1/16 max HP every 4 s. */
export const RESIDUAL = { fraction: 1 / 16, everySeconds: 4 } as const

export const residualDamage = (pokemon: PokemonInstance): number =>
  pokemon.status === 'burn' || pokemon.status === 'poison'
    ? Math.max(1, Math.floor(pokemon.maxHp * RESIDUAL.fraction))
    : 0

/** Paralysis still makes an action fizzle sometimes, as in the games. */
export const FIZZLE_CHANCE = 0.25
