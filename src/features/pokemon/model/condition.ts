// What a Pokémon carries out of a fight (R32.2.1).
//
// The model is cut in three, and this is the middle layer:
//
//   `PokemonInstance`      identity: species and form, nature, IVs, EVs,
//                          learnt moves, ownership, provenance, shiny.
//                          Changes rarely and never because of one battle.
//   `PokemonConditionState` wear: current HP, PP spent per move, major status.
//                          Mutable, and it **survives** the battle.
//   `BattleRuntimeState`   the fight itself: stat stages, confusion, Protect,
//                          the action bar, a Mega form. Dies with the battle.
//
// The rule that decides the layer: **would it still be true tomorrow, out of
// combat?** A burn is; a −2 Attack is not.
//
// Why condition survives: the Dungeon's product direction is attrition (A-15,
// D1). HP, PP, faint and major status follow you from one floor to the next —
// that is what makes a Potion, an Ether and a Revive worth anything. Winning a
// battle heals nothing; see the model doc's healing direction.

/**
 * One major status at a time, as in the games.
 *
 * Confusion is **not** here: it is a volatile and belongs to the runtime.
 */
export type MajorStatus = 'none' | 'burn' | 'paralysis' | 'poison' | 'badlyPoisoned' | 'freeze' | 'sleep'

export const MAJOR_STATUSES: readonly MajorStatus[] =
  ['none', 'burn', 'paralysis', 'poison', 'badlyPoisoned', 'freeze', 'sleep']

/**
 * The wear of one Pokémon between battles.
 *
 * `currentHp` is `null` while the Pokémon is as healthy as it can be, so a
 * record never has to know its own max HP — that is derived from the catalog,
 * the level, the IVs, the EVs and the nature, and it changes when any of those
 * do.
 *
 * `pp` is keyed by move id and **sparse**: a move that is absent is at full PP.
 * Keying by move id rather than by slot means re-ordering the four slots cannot
 * silently move spent PP from one move to another.
 *
 * There is deliberately no `fainted` flag: fainting is `currentHp === 0` and
 * two fields describing one fact can disagree (`isFainted`).
 */
export interface PokemonConditionState {
  readonly currentHp: number | null
  readonly pp: Readonly<Record<number, number>>
  readonly majorStatus: MajorStatus
}

/** As healthy as this Pokémon can be: full HP, full PP, no status. */
export const HEALTHY: PokemonConditionState = { currentHp: null, pp: {}, majorStatus: 'none' }

/** Fainted is derived, never stored: no HP left. */
export const isFainted = (condition: PokemonConditionState): boolean =>
  condition.currentHp !== null && condition.currentHp <= 0

/** Remaining PP of a move; a move the condition does not mention is full. */
export const remainingPP = (condition: PokemonConditionState, moveId: number, maxPP: number): number =>
  condition.pp[moveId] ?? maxPP

/** Everything wrong with a condition, in plain sentences; empty means it is sound. */
export function validateCondition(
  condition: PokemonConditionState,
  maxPPOfMove: (moveId: number) => number | null,
): string[] {
  const issues: string[] = []
  if (condition.currentHp !== null && (!Number.isInteger(condition.currentHp) || condition.currentHp < 0)) {
    issues.push('currentHp must be null or a whole number of zero or more')
  }
  if (!MAJOR_STATUSES.includes(condition.majorStatus)) {
    issues.push(`major status ${String(condition.majorStatus)} is not one this game has`)
  }
  for (const [key, value] of Object.entries(condition.pp)) {
    const moveId = Number(key)
    const max = maxPPOfMove(moveId)
    if (max === null) { issues.push(`PP recorded for move ${key}, which this Pokémon does not know`); continue }
    if (!Number.isInteger(value) || value < 0 || value > max) {
      issues.push(`PP of move ${key} must be between 0 and ${max}`)
    }
  }
  return issues
}

/** Drops every PP entry for a move the Pokémon no longer knows. */
export function pruneCondition(
  condition: PokemonConditionState,
  knows: (moveId: number) => boolean,
): PokemonConditionState {
  const pp: Record<number, number> = {}
  for (const [key, value] of Object.entries(condition.pp)) {
    if (knows(Number(key))) pp[Number(key)] = value
  }
  return { ...condition, pp }
}
