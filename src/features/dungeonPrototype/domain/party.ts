// The active party inside an expedition (D2/D3).
//
// APPROVED: at most six Pokémon; the same six are used for exploration, combat
// and professions; HP, PP, faint and status persist between floors, and there
// is no free healing. The wear is the point.
//
// `PokemonSpecies` vs `PokemonInstance`: the species is the shared catalog row,
// the instance is this individual. The prototype keeps the split honest even
// though the fields it can fill are fewer than the real model will need — see
// BATTLE_DATA_GAP_REPORT.md.

export type PokemonTypeName =
  | 'normal' | 'fire' | 'water' | 'electric' | 'grass' | 'ice' | 'fighting' | 'poison' | 'ground'
  | 'flying' | 'psychic' | 'bug' | 'rock' | 'ghost' | 'dragon' | 'dark' | 'steel' | 'fairy'

export interface PokemonSpecies {
  readonly speciesId: number
  readonly name: string
  readonly types: readonly [PokemonTypeName] | readonly [PokemonTypeName, PokemonTypeName]
  /** [hp, attack, defense, spAttack, spDefense, speed] — the repo already has these for 493 species. */
  readonly baseStats: readonly [number, number, number, number, number, number]
  /** Used by the capture formula. Missing from the repo today (see the gap report). */
  readonly catchRate: number
}

/**
 * APPROVED (D1 §26): **one major status at a time**. Our realtime reading of
 * each is in `damage.ts`; notably Freeze halves Sp. Attack instead of freezing
 * the Pokémon solid, which would be a stun in a game with no turns.
 */
export type StatusCondition = 'none' | 'burn' | 'paralysis' | 'poison' | 'freeze' | 'sleep'

/** One individual. `PROTOTYPE`: natures, IVs, EVs and abilities are not modelled yet. */
export interface PokemonInstance {
  readonly instanceId: string
  readonly speciesId: number
  readonly level: number
  readonly moves: readonly string[]
  hp: number
  readonly maxHp: number
  /** Remaining PP per move id. */
  pp: Record<string, number>
  status: StatusCondition
  /** Battle seconds left of sleep, or 0. */
  sleepFor: number
  /**
   * Battle seconds left of confusion. APPROVED (D1 §27): confusion does **not**
   * take the major-status slot, so it can sit on top of a burn or a poison.
   */
  confusedFor: number
}

export const MAX_PARTY = 6

/** Gen-3+ HP formula with neutral IV/EV, which is all the prototype can honestly fill. */
export const hpFor = (baseHp: number, level: number): number =>
  Math.floor(((2 * baseHp + 31) * level) / 100) + level + 10

/** Non-HP stat, same simplification. */
export const statFor = (base: number, level: number): number =>
  Math.floor(((2 * base + 31) * level) / 100) + 5

export const isFainted = (pokemon: PokemonInstance): boolean => pokemon.hp <= 0

export const isWiped = (party: readonly PokemonInstance[]): boolean =>
  party.length > 0 && party.every(isFainted)

/** The first member that can still fight, for auto-switching after a faint. */
export const firstHealthy = (party: readonly PokemonInstance[]): PokemonInstance | null =>
  party.find(member => !isFainted(member)) ?? null

export function damage(pokemon: PokemonInstance, amount: number): void {
  pokemon.hp = Math.max(0, pokemon.hp - Math.max(0, Math.round(amount)))
  if (pokemon.hp === 0) {
    pokemon.status = 'none'
    pokemon.sleepFor = 0
    pokemon.confusedFor = 0
  }
}

export function heal(pokemon: PokemonInstance, amount: number): number {
  if (isFainted(pokemon)) return 0
  const before = pokemon.hp
  pokemon.hp = Math.min(pokemon.maxHp, pokemon.hp + Math.max(0, Math.round(amount)))
  return pokemon.hp - before
}

/** Revive brings a fainted member back at a fraction of its maximum. */
export function revive(pokemon: PokemonInstance, fraction: number): boolean {
  if (!isFainted(pokemon)) return false
  pokemon.hp = Math.max(1, Math.round(pokemon.maxHp * fraction))
  return true
}

export const canUseMove = (pokemon: PokemonInstance, moveId: string): boolean =>
  (pokemon.pp[moveId] ?? 0) > 0

export function spendPp(pokemon: PokemonInstance, moveId: string): boolean {
  if (!canUseMove(pokemon, moveId)) return false
  pokemon.pp[moveId] -= 1
  return true
}

export function restorePp(pokemon: PokemonInstance, moveId: string, amount: number, max: number): number {
  const before = pokemon.pp[moveId] ?? 0
  pokemon.pp[moveId] = Math.min(max, before + amount)
  return pokemon.pp[moveId] - before
}

/** A deep copy, so a lab can reset a run without rebuilding fixtures. */
export const clonePokemon = (pokemon: PokemonInstance): PokemonInstance => ({
  ...pokemon, pp: { ...pokemon.pp },
})

export const cloneParty = (party: readonly PokemonInstance[]): PokemonInstance[] => party.map(clonePokemon)
