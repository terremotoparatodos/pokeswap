// A combatant's stats, right now (R32.3).
//
// Two layers, and keeping them apart is the point:
//
//   **Persistent** — the Gen VI formula over base stats, level, IVs, EVs and
//   nature. That is `deriveStats` in the Pokémon model (R32.2) and R32.3 never
//   touches it: a battle cannot change what a Pokémon *is*.
//
//   **Runtime** — stat stages, a burn, PokeSwap's freeze. This file. All of it
//   dies with the battle, and Speed in particular is never written back: a
//   modifier changes the cooldown, not the Pokémon (§13).
//
// Stat stages, as approved: PokeSwap's temporary stages run **−2 … +2**, and
// the clamp is on the **stage itself**.
//
// The first version of these rules clamped only the multiplier and kept a
// −6…+6 ladder underneath. That hides accumulation: six Swords Dances read ×2
// like two do, and then a Growl takes the hidden +6 to +5 and nothing visibly
// changes. A player cannot learn a rule they cannot see, so the ladder is the
// narrow one and a debuff is felt on the very next action.
//
// The move data is untouched by this: Swords Dance still says +2 in the
// catalog. What the clamp changes is what a *second* Swords Dance is worth,
// which is a runtime question and not a data one.

import { deriveStats, levelForExperience } from '../../pokemon/model'
import type { PokemonInstance, StatValues } from '../../pokemon/model'
import type { BattleRulesConfig, StatStageConfig } from './config'
import type { BattleRulesCatalog } from './catalogView'
import type { BattleCombatant, StageKey, StatStages } from './state'

/** The stats a battle can buff or debuff, mapped to the persistent stat keys. */
export type BattleStatKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe'

/** The stage a value lands on, never outside PokeSwap's range. */
export const clampStage = (stage: number, config: StatStageConfig): number =>
  Math.max(config.minStage, Math.min(config.maxStage, Math.trunc(stage)))

/**
 * What one stage is worth: ×0.5, ×2/3, ×1, ×1.5, ×2.
 *
 * Read straight out of the config, so the ladder is one table and not a
 * formula anybody has to re-derive.
 */
export function stageMultiplier(stage: number, config: StatStageConfig): number {
  return config.multiplierByStage[String(clampStage(stage, config))] ?? 1
}

/** The stage of one stat; an absent entry is zero. */
export const stageOf = (stages: StatStages, stat: StageKey): number => stages[stat] ?? 0

/**
 * Moves a stage, clamping **the stage**.
 *
 * At the ceiling another buff changes nothing at all, and a single debuff
 * takes it straight down one step — there is no hidden surplus to eat first.
 * Returns the stage it landed on so the caller can say whether anything moved.
 */
export function applyStage(
  stages: StatStages, stat: StageKey, delta: number, config: StatStageConfig,
): { stages: StatStages; stage: number; changed: boolean } {
  const before = stageOf(stages, stat)
  const stage = clampStage(before + delta, config)
  return { stages: { ...stages, [stat]: stage }, stage, changed: stage !== before }
}

/**
 * The persistent stats of an instance: what it would have out of combat.
 *
 * Shedinja is the one species with base HP 1 and always has exactly 1 HP; the
 * model's `deriveStats` takes that as a flag rather than special-casing an id
 * inside the formula, so the rules pass it from the catalog.
 */
export function battleStatsOf(
  instance: PokemonInstance, catalog: BattleRulesCatalog, formId = instance.formId,
): { stats: StatValues; level: number } | null {
  const base = catalog.baseStats(formId)
  if (!base) return null
  const level = levelForExperience(instance.experience)
  const stats = deriveStats(
    { base, level, ivs: instance.ivs, evs: instance.evs, nature: catalog.natureEffect(instance.natureId) },
    base.hp === 1,
  )
  return { stats, level }
}

/**
 * A stat as the fight sees it: persistent value → stage → major status.
 *
 * The two status effects here are the approved PokeSwap readings (§25): a burn
 * halves Attack, and our freeze halves Sp. Attack instead of immobilising —
 * freezing a Pokémon solid is a stun in a game with no turns, and a stun is
 * not what the product approved.
 *
 * Never below 1: a division by a defence of zero is not a balance question.
 */
export function effectiveStat(
  combatant: BattleCombatant, stat: BattleStatKey, config: BattleRulesConfig,
): number {
  let value = combatant.stats[stat] * stageMultiplier(stageOf(combatant.runtime.stages, stat), config.statStages)
  const status = combatant.condition.majorStatus
  if (stat === 'atk' && status === 'burn') value *= config.status.burnAttackMultiplier
  if (stat === 'spa' && status === 'freeze') value *= config.status.freezeSpecialAttackMultiplier
  return Math.max(1, value)
}

/**
 * The accuracy check's multiplier: the attacker's accuracy stage against the
 * defender's evasion stage.
 *
 * Accuracy and evasion use the **same −2…+2 ladder** as the other five, on
 * purpose: one vocabulary for the whole battle runtime. The games give them
 * their own 3/9…9/3 table, but a second ladder would mean two rules to read on
 * screen and two to explain, and nothing in PokeSwap needs that precision yet.
 * Sand Attack and Double Team are executable, so this is live, not theory.
 */
export function accuracyMultiplier(
  attacker: BattleCombatant, defender: BattleCombatant, config: BattleRulesConfig,
): number {
  const accuracy = stageMultiplier(stageOf(attacker.runtime.stages, 'accuracy'), config.statStages)
  const evasion = stageMultiplier(stageOf(defender.runtime.stages, 'evasion'), config.statStages)
  return accuracy / evasion
}
