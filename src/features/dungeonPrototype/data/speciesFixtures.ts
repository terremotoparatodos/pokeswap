// Species fixtures for the prototype (D0).
//
// Deliberately tiny. The repo already holds real base stats for 493 species
// (extracted from the legacy baseline, under the professions catalog) and types
// live in the `pokemon` table — but neither is a shared battle catalog, and
// neither has catch rates, abilities, moves or learnsets. Rather than reach
// across features for half the data, the prototype declares the handful of
// species it needs; the gap report says what a real catalog must contain and
// gives the exact paths.
//
// The values below are canonical Pokémon data (base stats, types, catch rates),
// not invented balance.

import type { PokemonSpecies } from '../domain/party'
import type { DungeonTheme } from '../domain/tiers'

export const SPECIES: Readonly<Record<number, PokemonSpecies>> = {
  74: { speciesId: 74, name: 'Geodude', types: ['rock', 'ground'], baseStats: [40, 80, 100, 30, 30, 20], catchRate: 255 },
  95: { speciesId: 95, name: 'Onix', types: ['rock', 'ground'], baseStats: [35, 45, 160, 30, 45, 70], catchRate: 45 },
  41: { speciesId: 41, name: 'Zubat', types: ['poison', 'flying'], baseStats: [40, 45, 35, 30, 40, 55], catchRate: 255 },
  66: { speciesId: 66, name: 'Machop', types: ['fighting'], baseStats: [70, 80, 50, 35, 35, 35], catchRate: 180 },
  68: { speciesId: 68, name: 'Machamp', types: ['fighting'], baseStats: [90, 130, 80, 65, 85, 55], catchRate: 45 },
  4: { speciesId: 4, name: 'Charmander', types: ['fire'], baseStats: [39, 52, 43, 60, 50, 65], catchRate: 45 },
  25: { speciesId: 25, name: 'Pikachu', types: ['electric'], baseStats: [35, 55, 40, 50, 50, 90], catchRate: 190 },
  135: { speciesId: 135, name: 'Jolteon', types: ['electric'], baseStats: [65, 65, 60, 110, 95, 130], catchRate: 45 },
  79: { speciesId: 79, name: 'Slowpoke', types: ['water', 'psychic'], baseStats: [90, 65, 65, 40, 40, 15], catchRate: 190 },
  246: { speciesId: 246, name: 'Larvitar', types: ['rock', 'ground'], baseStats: [50, 64, 50, 45, 50, 41], catchRate: 45 },
  37: { speciesId: 37, name: 'Vulpix', types: ['fire'], baseStats: [38, 41, 40, 50, 65, 65], catchRate: 190 },
  43: { speciesId: 43, name: 'Oddish', types: ['grass', 'poison'], baseStats: [45, 50, 55, 75, 65, 30], catchRate: 255 },
  81: { speciesId: 81, name: 'Magnemite', types: ['electric', 'steel'], baseStats: [25, 35, 70, 95, 55, 45], catchRate: 190 },
  220: { speciesId: 220, name: 'Swinub', types: ['ice', 'ground'], baseStats: [50, 50, 40, 30, 30, 50], catchRate: 225 },
}

export const speciesById = (speciesId: number): PokemonSpecies | null => SPECIES[speciesId] ?? null

/** Which species a themed dungeon may spawn. PROTOTYPE ASSUMPTION. */
export const THEME_POOLS: Readonly<Record<DungeonTheme, readonly number[]>> = {
  cave: [74, 95, 41, 246],
  ruin: [41, 81, 25, 95],
  tower: [25, 81, 135, 79],
  forest: [43, 41, 66, 25],
  mine: [74, 95, 81, 246],
  volcano: [4, 37, 74, 66],
  glacier: [220, 79, 81, 41],
}

export const poolFor = (theme: DungeonTheme): readonly number[] => THEME_POOLS[theme] ?? [74]
