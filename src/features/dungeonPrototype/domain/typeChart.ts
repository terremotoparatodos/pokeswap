// Type effectiveness (D2).
//
// PROTOTYPE ASSUMPTION — and the one that most needs a decision. The repo has
// no type chart at all: `pokemon.type1/type2` are strings in the database and
// nothing interprets them. The table below is the **Gen 6+** chart (Fairy
// exists; Steel no longer resists Ghost and Dark).
//
// OPEN: which generation/ruleset PokeSwap adopts. That choice changes this
// table, the damage formula, abilities and movesets together — see
// docs/wildlands/BATTLE_DATA_GAP_REPORT.md. Nothing here should be treated as
// settled; it exists so the prototype can compute something defensible.
//
// Stored as exceptions only: anything not listed is 1×.

import type { PokemonTypeName } from './party'

type Exceptions = Partial<Record<PokemonTypeName, number>>

const CHART: Readonly<Record<PokemonTypeName, Exceptions>> = {
  normal: { rock: 0.5, ghost: 0, steel: 0.5 },
  fire: { fire: 0.5, water: 0.5, grass: 2, ice: 2, bug: 2, rock: 0.5, dragon: 0.5, steel: 2 },
  water: { fire: 2, water: 0.5, grass: 0.5, ground: 2, rock: 2, dragon: 0.5 },
  electric: { water: 2, electric: 0.5, grass: 0.5, ground: 0, flying: 2, dragon: 0.5 },
  grass: { fire: 0.5, water: 2, grass: 0.5, poison: 0.5, ground: 2, flying: 0.5, bug: 0.5, rock: 2, dragon: 0.5, steel: 0.5 },
  ice: { fire: 0.5, water: 0.5, grass: 2, ice: 0.5, ground: 2, flying: 2, dragon: 2, steel: 0.5 },
  fighting: { normal: 2, ice: 2, poison: 0.5, flying: 0.5, psychic: 0.5, bug: 0.5, rock: 2, ghost: 0, dark: 2, steel: 2, fairy: 0.5 },
  poison: { grass: 2, poison: 0.5, ground: 0.5, rock: 0.5, ghost: 0.5, steel: 0, fairy: 2 },
  ground: { fire: 2, electric: 2, grass: 0.5, poison: 2, flying: 0, bug: 0.5, rock: 2, steel: 2 },
  flying: { electric: 0.5, grass: 2, fighting: 2, bug: 2, rock: 0.5, steel: 0.5 },
  psychic: { fighting: 2, poison: 2, psychic: 0.5, dark: 0, steel: 0.5 },
  bug: { fire: 0.5, grass: 2, fighting: 0.5, poison: 0.5, flying: 0.5, psychic: 2, ghost: 0.5, dark: 2, steel: 0.5, fairy: 0.5 },
  rock: { fire: 2, ice: 2, fighting: 0.5, ground: 0.5, flying: 2, bug: 2, steel: 0.5 },
  ghost: { normal: 0, psychic: 2, ghost: 2, dark: 0.5 },
  dragon: { dragon: 2, steel: 0.5, fairy: 0 },
  dark: { fighting: 0.5, psychic: 2, ghost: 2, dark: 0.5, fairy: 0.5 },
  steel: { fire: 0.5, water: 0.5, electric: 0.5, ice: 2, rock: 2, steel: 0.5, fairy: 2 },
  fairy: { fire: 0.5, fighting: 2, poison: 0.5, dragon: 2, dark: 2, steel: 0.5 },
}

/** How much an attack of `attacking` does to one defending type. */
export const effectivenessAgainst = (attacking: PokemonTypeName, defending: PokemonTypeName): number =>
  CHART[attacking][defending] ?? 1

/** The product over both of the defender's types, 0 for an immunity. */
export const typeEffectiveness = (
  attacking: PokemonTypeName, defending: readonly PokemonTypeName[],
): number => defending.reduce((total, type) => total * effectivenessAgainst(attacking, type), 1)

/** Same-type attack bonus. */
export const stabFor = (
  moveType: PokemonTypeName, attackerTypes: readonly PokemonTypeName[],
): number => (attackerTypes.includes(moveType) ? 1.5 : 1)

/** A word for the feedback line; the UI should never print the raw multiplier. */
export function effectivenessLabel(multiplier: number): string {
  if (multiplier === 0) return 'No afecta'
  if (multiplier >= 2) return 'Es muy eficaz'
  if (multiplier <= 0.5) return 'No es muy eficaz'
  return ''
}
