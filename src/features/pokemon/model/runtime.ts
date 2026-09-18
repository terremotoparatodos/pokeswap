// What a battle does to a Pokémon, and where it stops (R32.2).
//
// A persisted Pokémon must not become a bag of temporary battle state. The
// split is deliberate:
//
//   `PokemonInstance`      what survives: nature, IVs, EVs, moves, PP, damage
//                          carried out of the fight, ownership, provenance.
//   `PokemonRuntimeState`  what the fight owns: the major status, confusion,
//                          stat stages, the active form while Mega-Evolved,
//                          the action bar. None of it is persisted.
//
// The rule for deciding where something goes: **would it still be true
// tomorrow, out of combat?** A burn is; a −2 Attack is not. HP and PP are the
// two that survive, because the cost of a dungeon floor is supposed to follow
// you to the next one — there is no free sustain inside (D1).
//
// R32.2 only defines the shapes and the two crossings between them. The rules
// that mutate a runtime state are R32.3.

import type { FormId, PokemonInstance } from './instance'
import type { StatKey } from './stats'

/** One major status at a time (D1 §26); confusion is a volatile and separate. */
export type MajorStatus = 'none' | 'burn' | 'paralysis' | 'poison' | 'badlyPoisoned' | 'freeze' | 'sleep'

/** −6…+6, as in the games. */
export type StatStages = Readonly<Partial<Record<Exclude<StatKey, 'hp'>, number>>>

export interface PokemonRuntimeState {
  readonly instanceId: string
  /**
   * The form it is fighting as. Normally the instance's own form; a Mega lives
   * **here** and nowhere else, so it cannot survive the battle by accident.
   */
  readonly activeFormId: FormId
  readonly currentHp: number
  readonly maxHp: number
  /** Remaining PP per move id, mirroring the instance's slots. */
  readonly pp: Readonly<Record<number, number>>
  readonly status: MajorStatus
  /** Seconds of sleep left, for the realtime reading of it. */
  readonly sleepFor: number
  readonly confusedFor: number
  readonly stages: StatStages
  /** Guarding this instant (Protect and its family). */
  readonly protected: boolean
}

export const isFainted = (state: PokemonRuntimeState): boolean => state.currentHp <= 0

export interface EnterBattleInput {
  readonly instance: PokemonInstance
  /** Derived from the instance; the model never stores it. */
  readonly maxHp: number
  /** Base PP per move id, from the catalog plus the slot's PP Ups. */
  readonly maxPP: Readonly<Record<number, number>>
}

/**
 * The runtime state a Pokémon walks into a fight with.
 *
 * Damage and spent PP come from the instance: a Pokémon that left the last
 * fight at half health starts this one at half health.
 */
export function enterBattle({ instance, maxHp }: EnterBattleInput): PokemonRuntimeState {
  const pp: Record<number, number> = {}
  for (const slot of instance.moves) pp[slot.moveId] = slot.currentPP
  return {
    instanceId: instance.instanceId,
    activeFormId: instance.formId,
    currentHp: instance.currentHp ?? maxHp,
    maxHp,
    pp,
    status: 'none',
    sleepFor: 0,
    confusedFor: 0,
    stages: {},
    protected: false,
  }
}

/**
 * What the fight leaves behind.
 *
 * Only HP and PP cross back. The Mega form, the stat stages, the confusion and
 * the status stop existing here — deciding whether a status should survive a
 * battle is a product question (see the model doc), and until it is answered
 * the honest thing is not to persist it.
 */
export function leaveBattle(instance: PokemonInstance, state: PokemonRuntimeState): PokemonInstance {
  return {
    ...instance,
    currentHp: Math.max(0, Math.min(state.currentHp, state.maxHp)),
    moves: instance.moves.map(slot => ({ ...slot, currentPP: state.pp[slot.moveId] ?? slot.currentPP })),
  }
}
