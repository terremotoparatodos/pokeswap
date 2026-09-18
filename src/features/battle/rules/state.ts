// The shape of a battle (R32.3).
//
// Plain data, all of it: JSON-safe, no classes, no closures, no `Date`, no
// functions. A state can be written to a socket, stored, diffed and replayed.
// The only thing that is *not* in here is the catalog, because it is large,
// shared and read-only — it arrives as context (`reduce.ts`).
//
// The three layers of R32.2.1 keep their meaning exactly:
//
//   `PokemonInstance`       identity. The rules **never** write it.
//   `PokemonConditionState` wear: HP, PP, major status. The rules write it and
//                           it survives the battle (`leaveBattle`).
//   runtime                 this file's `CombatantRuntime`: Action Bar, stat
//                           stages, confusion, Protect, the selected action, a
//                           battle-only form. It dies with the battle.
//
// Shape and extension: the baseline is one active Pokémon per side, but the
// state is written as **sides with parties and active slots** rather than as
// `ally` and `enemy` fields. An Alpha fought by two allies, or a four-player
// co-op, is more slots and more sides — not a different type. None of that is
// implemented and no rule in R32.3 reads more than the first active slot.

import type { MajorStatus, PokemonConditionState, PokemonInstance, StatValues } from '../../pokemon/model'
import type { BattleRulesConfig } from './config'
import type { RngState } from './rng'

/** Stages of the stats a battle can move. HP is not one of them. */
export type StageKey = 'atk' | 'def' | 'spa' | 'spd' | 'spe' | 'accuracy' | 'evasion'

export const STAGE_KEYS: readonly StageKey[] =
  ['atk', 'def', 'spa', 'spd', 'spe', 'accuracy', 'evasion']

/** An absent stage is zero. Sparse so an untouched combatant serialises small. */
export type StatStages = Readonly<Partial<Record<StageKey, number>>>

/**
 * A pure item effect. R32.3 owns **what an item does to a Pokémon** and knows
 * nothing about inventories, stacks, prices or who may use one (§29).
 */
export type ItemEffect =
  | { readonly kind: 'healHp'; readonly amount: number }
  | { readonly kind: 'restorePp'; readonly moveId: number; readonly amount: number }
  | { readonly kind: 'revive'; readonly hpFraction: number }

/** A ball, as the capture contract sees it: a name and a multiplier (§30). */
export interface BallSpec {
  readonly id: string
  readonly bonus: number
}

/** What a combatant will do when its Action Bar completes. */
export type SelectedAction =
  | { readonly kind: 'move'; readonly moveId: number }
  | { readonly kind: 'switch'; readonly incomingId: string }
  | { readonly kind: 'item'; readonly item: ItemEffect; readonly targetId: string }
  | { readonly kind: 'capture'; readonly targetId: string; readonly ball: BallSpec }

export interface CombatantRuntime {
  /**
   * The form it is fighting **as**. A Mega lives here and nowhere else, so it
   * cannot survive the battle by accident (R32.2.1 §13).
   */
  readonly activeFormId: number
  /** How much of the current Action Window has elapsed, in ms. */
  readonly actionElapsedMs: number
  /** Multiplies the **current** cooldown: priority, recharge, spent Protect. */
  readonly cooldownMultiplier: number
  readonly stages: StatStages
  /** Volatile. Sits beside a major status rather than replacing it. */
  readonly confusionRemainingMs: number
  /** Offensive actions the shield still absorbs. */
  readonly protectCharges: number
  /** Sleep is a major status, but how much of it is left is runtime. */
  readonly sleepRemainingMs: number
  /** Battle time of this combatant's next poison tick; poison has its own clock. */
  readonly nextPoisonTickMs: number
  /** What it will do next. A move persists (auto-repeat); the rest is one-shot. */
  readonly selected: SelectedAction | null
  /** The last move it actually used, for the auto-repeat fallback. */
  readonly lastMoveId: number | null
  /** Named volatiles the effect registry may add. Empty in the R32.3 baseline. */
  readonly volatiles: readonly string[]
}

export const freshRuntime = (formId: number): CombatantRuntime => ({
  activeFormId: formId,
  actionElapsedMs: 0,
  cooldownMultiplier: 1,
  stages: {},
  confusionRemainingMs: 0,
  protectCharges: 0,
  sleepRemainingMs: 0,
  nextPoisonTickMs: 0,
  selected: null,
  lastMoveId: null,
  volatiles: [],
})

export interface BattleCombatant {
  /** Stable inside one battle. Not the instance id: the same Pokémon can appear twice. */
  readonly combatantId: string
  readonly sideId: string
  /** Identity. Never written by the rules (R32.2.1). */
  readonly instance: PokemonInstance
  /** Wear. Written by the rules, and it outlives the battle. */
  readonly condition: PokemonConditionState
  /**
   * Derived once, when the battle starts: catalog base stats + level + IVs +
   * EVs + nature. Nothing in R32.3 changes experience, so it cannot go stale.
   */
  readonly stats: StatValues
  /** Level at the start of the battle, derived from `instance.experience`. */
  readonly level: number
  /** True for a wild Pokémon: only these can be captured. */
  readonly wild: boolean
  readonly runtime: CombatantRuntime
}

export interface BattleSide {
  readonly sideId: string
  /**
   * Who commands it. `null` for the wild side. In co-op two sides — or two
   * slots of one side — carry different controllers; nothing reads it yet.
   */
  readonly controllerId: string | null
  /** Combatant ids that are on the field. Length 1 in the R32.3 baseline. */
  readonly activeIds: readonly string[]
  /** Everyone, on the field or not, in party order. */
  readonly partyIds: readonly string[]
}

export type BattleOutcome =
  | { readonly kind: 'ongoing' }
  | { readonly kind: 'decided'; readonly winningSideId: string }
  | { readonly kind: 'captured'; readonly combatantId: string }

export interface BattleState {
  /** How PokeSwap reads the data. A state from another version is not replayable. */
  readonly battleRulesVersion: string
  /** What the data says. A mismatch is refused, never resolved against another catalog. */
  readonly catalogVersion: string
  readonly battleId: string
  /** Whole milliseconds since the battle started. Never a wall clock. */
  readonly timeMs: number
  readonly rng: RngState
  /** The numbers this battle ran with, carried so a replay cannot be re-balanced. */
  readonly config: BattleRulesConfig
  readonly sides: readonly BattleSide[]
  /** Everyone in the battle, keyed by combatant id. */
  readonly combatants: Readonly<Record<string, BattleCombatant>>
  readonly outcome: BattleOutcome
  /** How many events this battle has emitted; every event carries its ordinal. */
  readonly eventSeq: number
}

// ── Reading a state ─────────────────────────────────────────────────────────

export const combatantOf = (state: BattleState, id: string): BattleCombatant | null =>
  state.combatants[id] ?? null

export const sideOf = (state: BattleState, sideId: string): BattleSide | null =>
  state.sides.find(side => side.sideId === sideId) ?? null

/** Fainted is derived from HP, here as everywhere (R32.2.1). */
export const isCombatantFainted = (combatant: BattleCombatant): boolean =>
  combatant.condition.currentHp !== null && combatant.condition.currentHp <= 0

export const currentHpOf = (combatant: BattleCombatant): number =>
  combatant.condition.currentHp ?? combatant.stats.hp

export const majorStatusOf = (combatant: BattleCombatant): MajorStatus =>
  combatant.condition.majorStatus

/** The combatant on the field for a side; `null` when the slot is empty. */
export function activeOf(state: BattleState, sideId: string, slot = 0): BattleCombatant | null {
  const side = sideOf(state, sideId)
  const id = side?.activeIds[slot]
  return id ? combatantOf(state, id) : null
}

/** The single opposing active combatant of the 1-vs-1 baseline (§38). */
export function opposingActive(state: BattleState, combatantId: string): BattleCombatant | null {
  const self = combatantOf(state, combatantId)
  if (!self) return null
  for (const side of state.sides) {
    if (side.sideId === self.sideId) continue
    for (const id of side.activeIds) {
      const other = combatantOf(state, id)
      if (other && !isCombatantFainted(other)) return other
    }
  }
  return null
}

/** Every combatant on the field, in side order then slot order. Ties break here. */
export function activeCombatants(state: BattleState): BattleCombatant[] {
  const out: BattleCombatant[] = []
  for (const side of state.sides) {
    for (const id of side.activeIds) {
      const combatant = combatantOf(state, id)
      if (combatant) out.push(combatant)
    }
  }
  return out
}

/** Replaces one combatant, leaving everything else untouched. */
export const withCombatant = (state: BattleState, combatant: BattleCombatant): BattleState => ({
  ...state,
  combatants: { ...state.combatants, [combatant.combatantId]: combatant },
})

export const withRuntime = (
  combatant: BattleCombatant,
  patch: Partial<CombatantRuntime>,
): BattleCombatant => ({ ...combatant, runtime: { ...combatant.runtime, ...patch } })

export const withConditionPatch = (
  combatant: BattleCombatant,
  patch: Partial<PokemonConditionState>,
): BattleCombatant => ({ ...combatant, condition: { ...combatant.condition, ...patch } })
