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
// Stat stages, as approved (§24): the internal number stays the honest −6…+6
// ladder, so a move that says +2 keeps saying +2 and the data never has to be
// rewritten. What is clamped is the **multiplier**, to PokeSwap's ×2 / ×0.5
// band. The alternative — squashing the ladder itself — would have made the
// move data lie about the game it came from.

import { deriveStats, levelForExperience } from '../../pokemon/model'
import type { PokemonInstance, StatValues } from '../../pokemon/model'
import type { BattleRulesConfig, StatStageConfig } from './config'
import type { BattleRulesCatalog } from './catalogView'
import type { BattleCombatant, StageKey, StatStages } from './state'

/** The stats a battle can buff or debuff, mapped to the persistent stat keys. */
export type BattleStatKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe'

/**
 * The multiplier of a stage, clamped to PokeSwap's band.
 *
 * Shape: +1 stage is ×1.5, and two stages already reach the ×2 ceiling. A
 * realtime fight is read at a glance, so "up" and "way up" is the whole
 * vocabulary; a −6…+6 ladder nobody can read would only be precision nobody
 * uses.
 */
export function stageMultiplier(stage: number, config: StatStageConfig): number {
  const clamped = Math.max(config.minStage, Math.min(config.maxStage, stage))
  const raw = clamped >= 0 ? 1 + clamped * 0.5 : 1 / (1 + Math.abs(clamped) * 0.5)
  return Math.max(config.minMultiplier, Math.min(config.maxMultiplier, raw))
}

/** The stage of one stat; an absent entry is zero. */
export const stageOf = (stages: StatStages, stat: StageKey): number => stages[stat] ?? 0

/** Adds a delta to a stage, keeping the honest ladder inside its own limits. */
export function applyStage(
  stages: StatStages, stat: StageKey, delta: number, config: StatStageConfig,
): StatStages {
  const next = Math.max(config.minStage, Math.min(config.maxStage, stageOf(stages, stat) + delta))
  return { ...stages, [stat]: next }
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
 * No move in R32.3 can move either stage — the catalog does not say which stat
 * a stat-changing move touches (`moveSupport.ts`) — so today this is always 1.
 * It is here, and tested, because an ability or an item hook is the obvious
 * next thing to reach for it, and because leaving the hole out would have made
 * the accuracy roll look simpler than it is.
 */
export function accuracyMultiplier(
  attacker: BattleCombatant, defender: BattleCombatant, config: BattleRulesConfig,
): number {
  const accuracy = stageMultiplier(stageOf(attacker.runtime.stages, 'accuracy'), config.statStages)
  const evasion = stageMultiplier(stageOf(defender.runtime.stages, 'evasion'), config.statStages)
  return accuracy / evasion
}
