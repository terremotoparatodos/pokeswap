// Starting a battle, and leaving one (R32.3).
//
// This is the persistence boundary, and it is the only place these rules touch
// it. Going in, a `PokemonInstance` and its condition become a combatant with
// derived stats. Coming out, `leaveBattle` from the Pokémon model takes the
// wear back — HP, PP, major status — and nothing else: the stat stages, the
// confusion, the Protect charges and a Mega form stop existing, because the
// runtime is not even an argument to it (R32.2.1 §2).
//
// Nothing here writes anywhere. `finishBattle` returns new instances; storing
// them is the caller's business, and in production it will be the server's.

import { leaveBattle, levelForExperience } from '../../pokemon/model'
import type { PokemonInstance } from '../../pokemon/model'
import type { BattleRulesCatalog } from './catalogView'
import { DEFAULT_BATTLE_RULES_CONFIG } from './config'
import type { BattleRulesConfig } from './config'
import { createRngState } from './rng'
import { battleStatsOf } from './stats'
import { BATTLE_RULES_VERSION } from './version'
import type { BattleCombatant, BattleSide, BattleState } from './state'
import { freshRuntime } from './state'

export interface BattleSideInput {
  readonly sideId: string
  /** Who commands it; `null` for the wild side. Nothing reads it in R32.3. */
  readonly controllerId?: string | null
  /** In party order. The first `activeCount` of them start on the field. */
  readonly party: readonly PokemonInstance[]
  /** True when these are wild Pokémon, and therefore capturable. */
  readonly wild?: boolean
  /** Active slots. **1 in the R32.3 baseline**; more is not implemented. */
  readonly activeCount?: number
}

export interface CreateBattleInput {
  readonly battleId: string
  /** Owned by whoever starts the battle; the server owns it from R32.4 on. */
  readonly seed: number
  readonly sides: readonly BattleSideInput[]
  readonly catalog: BattleRulesCatalog
  readonly config?: BattleRulesConfig
}

/**
 * Builds the opening state.
 *
 * The condition comes straight from each instance: a Pokémon that left the
 * last fight burnt, at half health and out of Thunderbolt starts this one
 * burnt, at half health and out of Thunderbolt. Nothing is healed on the way
 * in, which is the Dungeon's attrition and the whole reason condition
 * survives a battle at all.
 */
export function createBattleState(input: CreateBattleInput): BattleState {
  const config = input.config ?? DEFAULT_BATTLE_RULES_CONFIG
  const combatants: Record<string, BattleCombatant> = {}
  const sides: BattleSide[] = []

  for (const side of input.sides) {
    const partyIds: string[] = []
    side.party.forEach((instance, index) => {
      const combatantId = `${side.sideId}-${index}`
      const derived = battleStatsOf(instance, input.catalog)
      if (!derived) {
        throw new Error(`form ${instance.formId} is not in catalog ${input.catalog.catalogVersion}`)
      }
      const poisoned = instance.condition.majorStatus === 'poison'
        || instance.condition.majorStatus === 'badlyPoisoned'
      combatants[combatantId] = {
        combatantId,
        sideId: side.sideId,
        instance,
        condition: instance.condition,
        stats: derived.stats,
        level: derived.level,
        wild: side.wild ?? false,
        runtime: {
          ...freshRuntime(instance.formId),
          sleepRemainingMs: instance.condition.majorStatus === 'sleep' ? config.status.sleepMs : 0,
          nextPoisonTickMs: poisoned ? config.status.poisonTickMs : 0,
        },
      }
      partyIds.push(combatantId)
    })
    sides.push({
      sideId: side.sideId,
      controllerId: side.controllerId ?? null,
      activeIds: partyIds.slice(0, Math.max(1, side.activeCount ?? 1)),
      partyIds,
    })
  }

  return {
    battleRulesVersion: BATTLE_RULES_VERSION,
    catalogVersion: input.catalog.catalogVersion,
    battleId: input.battleId,
    timeMs: 0,
    rng: createRngState(input.seed),
    config,
    sides,
    combatants,
    outcome: { kind: 'ongoing' },
    eventSeq: 0,
  }
}

/**
 * What the fight leaves behind, one instance per combatant.
 *
 * Every one of them goes through the model's `leaveBattle`, so the condition
 * is clamped and pruned by the same code that would have done it anywhere
 * else, and no rule in R32.3 can invent its own way out.
 */
export function finishBattle(state: BattleState): Record<string, PokemonInstance> {
  const out: Record<string, PokemonInstance> = {}
  for (const combatant of Object.values(state.combatants)) {
    out[combatant.combatantId] = leaveBattle(combatant.instance, combatant.condition)
  }
  return out
}

/** The level a combatant is fighting at. Derived from experience, never stored. */
export const levelOf = (instance: PokemonInstance): number => levelForExperience(instance.experience)
