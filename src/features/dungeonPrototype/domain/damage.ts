// Damage, stat stages and the Action Bar (D0, rewritten for D1 §21–§28).
//
// Ruleset: ORAS / Generation VI (APPROVED). The damage formula is the Gen-6
// one, simplified where the repo has no data to fill (no natures, IVs, EVs,
// abilities or held items — see BATTLE_DATA_GAP_REPORT.md).
//
// The Action Bar is the part to judge by feel, not by reading: the target is
// **an action roughly every 2–3 seconds for an average Pokémon**, Speed
// mattering deterministically, and no per-attack randomness on the bar.

import { statFor, type PokemonInstance, type PokemonSpecies, type StatusCondition } from './party'
import type { MoveDefinition, StatKey } from './moves'
import { stabFor, typeEffectiveness } from './typeChart'

// ── Stat stages, capped at ×2 / ×0.5 (APPROVED, D1 §25) ────────────────────

export type StatStages = Partial<Record<StatKey, number>>

/** APPROVED: whatever the internal stages say, the result never leaves [0.5, 2]. */
export const STAGE_LIMITS = { max: 2, min: 0.5 } as const

/**
 * Two stages reach the cap, so the UX is "up / way up" instead of a −6…+6
 * ladder nobody reads. The internal number is still a stage, which keeps the
 * move data honest (Swords Dance is +2), but the multiplier is clamped.
 */
export function stageMultiplier(stages: number): number {
  const clamped = Math.max(-6, Math.min(6, stages))
  const raw = clamped >= 0 ? 1 + clamped * 0.5 : 1 / (1 + Math.abs(clamped) * 0.5)
  return Math.max(STAGE_LIMITS.min, Math.min(STAGE_LIMITS.max, raw))
}

export const applyStage = (stages: StatStages, stat: StatKey, delta: number): StatStages => ({
  ...stages,
  [stat]: Math.max(-6, Math.min(6, (stages[stat] ?? 0) + delta)),
})

export interface CombatModifiers {
  readonly damageDealt?: number
  readonly damageTaken?: number
  readonly speed?: number
  /** 0…1: how much of an incoming status chance is ignored. */
  readonly statusResistance?: number
  /** Multiplies every cooldown; the Alpha barely uses it. */
  readonly cooldown?: number
}

export interface Combatant {
  readonly pokemon: PokemonInstance
  readonly species: PokemonSpecies
  readonly stages: StatStages
  readonly modifiers?: CombatModifiers
}

const BASE_INDEX: Record<StatKey, number> = { attack: 1, defense: 2, spAttack: 3, spDefense: 4, speed: 5 }

/**
 * A live stat: base → level → stage → status → modifiers.
 *
 * APPROVED status effects on stats (D1 §26): Burn halves Attack, and our
 * realtime Freeze halves Sp. Attack — deliberately **not** the traditional
 * frozen-solid rule, which would be a stun in a game with no turns.
 */
export function effectiveStat(combatant: Combatant, stat: StatKey): number {
  const base = combatant.species.baseStats[BASE_INDEX[stat]]
  let value = statFor(base, combatant.pokemon.level) * stageMultiplier(combatant.stages[stat] ?? 0)
  if (stat === 'attack' && combatant.pokemon.status === 'burn') value *= 0.5
  if (stat === 'spAttack' && combatant.pokemon.status === 'freeze') value *= 0.5
  if (stat === 'speed' && combatant.modifiers?.speed) value *= combatant.modifiers.speed
  return Math.max(1, value)
}

// ── Action Bar (PLAYTEST PARAMETER, D1 §21) ────────────────────────────────

/**
 * fill = clamp(base · √(reference / effectiveSpeed), min, max)
 *
 * A square root instead of D0's linear rate: it keeps the middle of the range
 * where the feel should be (an average Pokémon lands on ~2.6–2.9 s) while
 * compressing both extremes, so a very fast Pokémon is clearly faster without
 * acting twice per enemy action, and a very slow one is clearly slower without
 * being unplayable. It is deterministic — **no per-attack randomness** — which
 * is what lets a player learn the rhythm.
 *
 * Measured with the current fixtures:
 *   Geodude L25 (eff. 22) → 4.00 s (clamped)   "slow"
 *   Machamp L30 (eff. 47) → 2.94 s             "average"
 *   Jolteon L30 (eff. 92) → 2.10 s             "fast"
 */
// D1.2.4 §5: every cooldown is 50 %% longer than the D1 values, so a fight is
// readable while it is being played. PLAYTEST VALUES — the shapes are the
// approved ones, only the numbers moved.
export const ACTION_BAR = {
  baseSeconds: 3.9,
  referenceSpeed: 60,
  minSeconds: 2.1,
  maxSeconds: 6,
  /** Multipliers applied to the *next* cooldown. APPROVED shapes, playtest values. */
  priorityMultiplier: 0.5,
  rechargeMultiplier: 2,
  protectMultiplier: 2,
  paralysisMultiplier: 2,
} as const

export type ActionBarConfig = typeof ACTION_BAR

export function fillSeconds(speed: number, config: ActionBarConfig = ACTION_BAR): number {
  const ratio = config.referenceSpeed / Math.max(1, speed)
  return Math.min(config.maxSeconds, Math.max(config.minSeconds, config.baseSeconds * Math.sqrt(ratio)))
}

/**
 * The cooldown this combatant is on right now: its speed, its paralysis, and
 * whatever the last action left behind (priority halves it, recharge and
 * Protect double it).
 */
export function cooldownSeconds(
  combatant: Combatant, pendingMultiplier = 1, config: ActionBarConfig = ACTION_BAR,
): number {
  const base = fillSeconds(effectiveStat(combatant, 'speed'), config)
  const paralysis = combatant.pokemon.status === 'paralysis' ? config.paralysisMultiplier : 1
  const external = combatant.modifiers?.cooldown ?? 1
  return base * paralysis * pendingMultiplier * external
}

/** What the next cooldown should be multiplied by, given the move just used. */
export function cooldownAfter(move: MoveDefinition, config: ActionBarConfig = ACTION_BAR): number {
  if (move.family === 'protect') return config.protectMultiplier
  if (move.recharges) return config.rechargeMultiplier
  if (move.priority > 0) return config.priorityMultiplier
  return 1
}

// ── Status (APPROVED, D1 §26–§28) ──────────────────────────────────────────

/**
 * PLAYTEST PARAMETER. Poison ticks on **its own clock**, never on the action
 * bar: a fast Pokémon must not take more poison just for acting more often.
 */
export const STATUS = {
  poisonTickSeconds: 3,
  poisonFraction: 1 / 16,
  sleepSeconds: 6,
  /** Confusion does not take the major-status slot and can sit on top of one. */
  confusionSeconds: 8,
  confusionSelfHitChance: 0.33,
  /** A self-hit uses a 40-power typeless physical attack, as in the games. */
  confusionPower: 40,
} as const

export const poisonDamage = (pokemon: PokemonInstance): number =>
  pokemon.status === 'poison' ? Math.max(1, Math.floor(pokemon.maxHp * STATUS.poisonFraction)) : 0

/** APPROVED: one major status at a time. A new one is refused, not stacked. */
export const canTakeStatus = (pokemon: PokemonInstance): boolean => pokemon.status === 'none'

// ── Damage ─────────────────────────────────────────────────────────────────

export interface DamageRolls {
  readonly accuracy: number
  readonly crit: number
  readonly spread: number
  readonly secondary: number
}

export interface DamageResult {
  readonly hit: boolean
  readonly damage: number
  readonly critical: boolean
  readonly effectiveness: number
  readonly stab: number
  readonly statusApplied: StatusCondition | null
  readonly confuses: boolean
}

export const CRIT_RATE = 1 / 16
export const CRIT_MULTIPLIER = 1.5

export function computeDamage(
  attacker: Combatant, defender: Combatant, move: MoveDefinition, rolls: DamageRolls,
): DamageResult {
  const effectiveness = typeEffectiveness(move.type, defender.species.types)

  if (move.accuracy !== null && rolls.accuracy >= move.accuracy / 100) {
    return { hit: false, damage: 0, critical: false, effectiveness, stab: 1, statusApplied: null, confuses: false }
  }
  if (effectiveness === 0) {
    return { hit: true, damage: 0, critical: false, effectiveness, stab: 1, statusApplied: null, confuses: false }
  }

  const resistance = 1 - (defender.modifiers?.statusResistance ?? 0)
  const lands = move.inflicts && rolls.secondary < move.inflicts.chance * resistance
  const statusApplied = lands && move.inflicts!.status !== 'confusion' && canTakeStatus(defender.pokemon)
    ? (move.inflicts!.status as StatusCondition)
    : null
  const confuses = Boolean(lands && move.inflicts!.status === 'confusion')

  if (move.power === null) {
    return { hit: true, damage: 0, critical: false, effectiveness, stab: 1, statusApplied, confuses }
  }

  const physical = move.category === 'physical'
  const attack = effectiveStat(attacker, physical ? 'attack' : 'spAttack')
  const defense = effectiveStat(defender, physical ? 'defense' : 'spDefense')
  const level = attacker.pokemon.level
  const base = ((2 * level) / 5 + 2) * move.power * (attack / defense) / 50 + 2

  const critical = rolls.crit < CRIT_RATE
  const stab = stabFor(move.type, attacker.species.types)
  const variance = 0.85 + rolls.spread * 0.15
  const dealt = attacker.modifiers?.damageDealt ?? 1
  const taken = defender.modifiers?.damageTaken ?? 1

  const damage = Math.max(1, Math.floor(
    base * (critical ? CRIT_MULTIPLIER : 1) * stab * effectiveness * variance * dealt * taken,
  ))
  return { hit: true, damage, critical, effectiveness, stab, statusApplied, confuses }
}

/** A confused Pokémon hitting itself: typeless, its own attack against its own defence. */
export function confusionSelfDamage(combatant: Combatant): number {
  const attack = effectiveStat(combatant, 'attack')
  const defense = effectiveStat(combatant, 'defense')
  const level = combatant.pokemon.level
  return Math.max(1, Math.floor(((2 * level) / 5 + 2) * STATUS.confusionPower * (attack / defense) / 50 + 2))
}
