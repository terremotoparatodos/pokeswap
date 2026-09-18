// What belongs to the current battle and dies with it (R32.2.1).
//
// The third layer of the model. The other two are elsewhere on purpose:
//
//   `PokemonInstance`       identity — species and form, nature, IVs, EVs,
//                           learnt moves, ownership, provenance, shiny.
//   `PokemonConditionState` wear — current HP, PP spent, major status. It
//                           **survives** the battle (`condition.ts`).
//   `BattleRuntimeState`    this file: stat stages, confusion, Protect, the
//                           action bar, a Mega form. None of it is persisted.
//
// The rule that decides the layer: **would it still be true tomorrow, out of
// combat?** A burn is, so it is condition. A −2 Attack is not, so it is here.
//
// Nothing here heals anything. Ending a battle does not restore HP, does not
// restore PP and does not cure a status: the Dungeon's attrition is the point
// (see the model doc's healing direction). What leaving a battle does is
// **forget** this record.
//
// R32.2.1 defines the shapes and the two crossings. The rules that mutate a
// runtime state — what a move does, what an ability does, how the action bar
// fills — are R32.3.

import { pruneCondition } from './condition'
import type { PokemonConditionState } from './condition'
import { withCondition } from './instance'
import type { FormId, PokemonInstance } from './instance'
import type { StatKey } from './stats'

/** −6…+6, as in the games. An absent stat is at zero. */
export type StatStages = Readonly<Partial<Record<Exclude<StatKey, 'hp'>, number>>>

export interface BattleRuntimeState {
  readonly instanceId: string
  /**
   * The form it is fighting **as**.
   *
   * A Mega lives here and nowhere else, so it cannot survive the battle by
   * accident: `instance.formId` is never written by a fight. (The catalog holds
   * Mega data; Mega as gameplay is still disabled.)
   */
  readonly activeFormId: FormId
  /** Derived from catalog + level + IVs + EVs + nature; never persisted. */
  readonly maxHp: number
  readonly stages: StatStages
  /** Confusion left. Volatile: it never leaves the battle. */
  readonly confusedFor: number
  /** Guarding this instant (Protect and its family). */
  readonly protected: boolean
  /**
   * How full this Pokémon's action bar is, 0…1: the realtime turn order. R32.3
   * owns the rules that fill it.
   */
  readonly actionBar: number
  /** Other volatiles, which R32.3 will name properly. */
  readonly volatiles: readonly string[]
}

export interface EnterBattleInput {
  readonly instance: PokemonInstance
  readonly maxHp: number
}

/**
 * The runtime state a Pokémon walks into a fight with.
 *
 * It carries **no** health, **no** PP and **no** status: those are the
 * instance's condition, and the battle reads them from there. A Pokémon that
 * left the last fight burnt, at half health and out of Thunderbolt starts this
 * one burnt, at half health and out of Thunderbolt.
 */
export function enterBattle({ instance, maxHp }: EnterBattleInput): BattleRuntimeState {
  return {
    instanceId: instance.instanceId,
    activeFormId: instance.formId,
    maxHp,
    stages: {},
    confusedFor: 0,
    protected: false,
    actionBar: 0,
    volatiles: [],
  }
}

/**
 * What the fight leaves behind: the condition, and nothing else.
 *
 * The runtime state is not even an argument, because it has nothing to
 * contribute — that is the whole point of the split. Stat stages, confusion,
 * Protect, the action bar and a Mega form stop existing when this returns.
 *
 * PP recorded for a move the Pokémon no longer knows is dropped on the way out,
 * so a move swapped mid-expedition cannot leave wear behind it.
 */
export function leaveBattle(
  instance: PokemonInstance,
  condition: PokemonConditionState,
): PokemonInstance {
  const knows = (moveId: number): boolean => instance.moves.some(slot => slot.moveId === moveId)
  return withCondition(instance, pruneCondition(clampHp(condition), knows))
}

const clampHp = (condition: PokemonConditionState): PokemonConditionState =>
  condition.currentHp === null || condition.currentHp >= 0
    ? condition
    : { ...condition, currentHp: 0 }

/** Mega Evolution, for the length of this battle only. Gameplay is still disabled. */
export const megaEvolve = (state: BattleRuntimeState, formId: FormId): BattleRuntimeState =>
  ({ ...state, activeFormId: formId })
