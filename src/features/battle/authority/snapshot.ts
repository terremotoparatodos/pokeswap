// What the client is allowed to see (R32.4).
//
// `BattleState` carries `rng: { seed, cursor }`, and it has to: the rules are
// pure, so their randomness is data, and a replay starts from those two
// numbers. Sending them to a client would hand it the whole future of the
// fight — `rngValueAt(seed, cursor)` is exported, deterministic and three
// lines long, so anyone with the seed can read off the next accuracy check,
// the next critical, the next secondary effect and, worst of all, the next
// capture roll. They would not have to cheat; they would just have to look.
//
// The answer is a **projection**, not a change to R32.3. The rules keep their
// honest state, the authority keeps it internally, and what crosses the wire
// is built here field by field.
//
// Built **explicitly**, never `Omit<BattleState, 'rng'>`. With `Omit`, the day
// someone adds a second secret to the state it ships to every client and
// nothing fails. Listing the fields means a new one is missing from the client
// until a person decides otherwise — the wrong direction is the safe one.

import type {
  BallSpec, BattleOutcome, BattleRulesConfig, BattleState, CombatantRuntime, ItemEffect, StatStages,
} from '../rules'
import type { PokemonConditionState, PokemonInstance, StatValues } from '../../pokemon/model'

/** A combatant as a client sees it: everything except how the dice will fall. */
export interface ClientCombatantView {
  readonly combatantId: string
  readonly sideId: string
  readonly instance: PokemonInstance
  readonly condition: PokemonConditionState
  readonly stats: StatValues
  readonly level: number
  readonly wild: boolean
  readonly runtime: ClientRuntimeView
}

/** The runtime, minus nothing: none of it is secret, all of it is on screen. */
export interface ClientRuntimeView {
  readonly activeFormId: number
  readonly actionElapsedMs: number
  readonly cooldownMultiplier: number
  readonly stages: StatStages
  readonly confusionRemainingMs: number
  readonly protectCharges: number
  readonly sleepRemainingMs: number
  readonly nextPoisonTickMs: number
  readonly selected: ClientSelectedView | null
  readonly lastMoveId: number | null
  readonly volatiles: readonly string[]
}

export type ClientSelectedView =
  | { readonly kind: 'move'; readonly moveId: number }
  | { readonly kind: 'switch'; readonly incomingId: string }
  | { readonly kind: 'item'; readonly item: ItemEffect; readonly targetId: string }
  | { readonly kind: 'capture'; readonly targetId: string; readonly ball: BallSpec }

export interface ClientSideView {
  readonly sideId: string
  readonly controllerId: string | null
  readonly activeIds: readonly string[]
  readonly partyIds: readonly string[]
}

export interface ClientBattleSnapshot {
  readonly battleId: string
  /** Canonical and monotonic. A client with a lower one is behind. */
  readonly revision: number
  /** The authority's clock, so a client can tell how old this snapshot is. */
  readonly serverTimeMs: number
  /** Battle time: what the rules actually ran on. */
  readonly timeMs: number
  readonly catalogVersion: string
  readonly battleRulesVersion: string
  /** Carried so a client animates the bars the server is timing. */
  readonly config: BattleRulesConfig
  readonly sides: readonly ClientSideView[]
  readonly combatants: Readonly<Record<string, ClientCombatantView>>
  readonly outcome: BattleOutcome
  readonly eventSeq: number
  /** Who commands what. Not a secret: it is who may press which button. */
  readonly controls: Readonly<Record<string, readonly string[]>>
}

const projectRuntime = (runtime: CombatantRuntime): ClientRuntimeView => ({
  activeFormId: runtime.activeFormId,
  actionElapsedMs: runtime.actionElapsedMs,
  cooldownMultiplier: runtime.cooldownMultiplier,
  stages: runtime.stages,
  confusionRemainingMs: runtime.confusionRemainingMs,
  protectCharges: runtime.protectCharges,
  sleepRemainingMs: runtime.sleepRemainingMs,
  nextPoisonTickMs: runtime.nextPoisonTickMs,
  selected: runtime.selected,
  lastMoveId: runtime.lastMoveId,
  volatiles: runtime.volatiles,
})

export interface SnapshotMeta {
  readonly revision: number
  readonly serverTimeMs: number
  readonly controls: Readonly<Record<string, readonly string[]>>
}

/**
 * Projects the canonical state for a client.
 *
 * The cost is one shallow pass over the combatants — the catalog is not in the
 * state and is never copied, so a snapshot of a six-a-side battle is a dozen
 * small objects and not 621 moves (§34).
 */
export function projectClientSnapshot(state: BattleState, meta: SnapshotMeta): ClientBattleSnapshot {
  const combatants: Record<string, ClientCombatantView> = {}
  for (const combatant of Object.values(state.combatants)) {
    combatants[combatant.combatantId] = {
      combatantId: combatant.combatantId,
      sideId: combatant.sideId,
      instance: combatant.instance,
      condition: combatant.condition,
      stats: combatant.stats,
      level: combatant.level,
      wild: combatant.wild,
      runtime: projectRuntime(combatant.runtime),
    }
  }
  return {
    battleId: state.battleId,
    revision: meta.revision,
    serverTimeMs: meta.serverTimeMs,
    timeMs: state.timeMs,
    catalogVersion: state.catalogVersion,
    battleRulesVersion: state.battleRulesVersion,
    config: state.config,
    sides: state.sides.map(side => ({
      sideId: side.sideId,
      controllerId: side.controllerId,
      activeIds: side.activeIds,
      partyIds: side.partyIds,
    })),
    combatants,
    outcome: state.outcome,
    eventSeq: state.eventSeq,
    controls: meta.controls,
  }
}
