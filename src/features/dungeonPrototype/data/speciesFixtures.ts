// Species fixtures for the prototype (D0, extended in D1).
//
// Deliberately small. The repo already holds real base stats for 493 species
// (extracted from the legacy baseline, under the professions catalog) and types
// live in the `pokemon` table — but neither is a shared battle catalog, and
// neither has catch rates, abilities, moves or learnsets. Rather than reach
// across features for half the data, the prototype declares the species it
// needs; the gap report says what a real catalog must contain and gives paths.
//
// **Ruleset: ORAS / Generation VI (APPROVED, D1 §16).** Types below are the
// Gen 6 ones — Clefairy is Fairy, Magnemite is Electric/Steel, Azumarill is
// Water/Fairy — and `origin` is the region the species comes from, which is
// what a GENERATION dungeon filters on. These are canonical values, not
// invented balance.

import type { PokemonSpecies, PokemonTypeName } from '../domain/party'
import type { DungeonTheme } from '../domain/tiers'

export type RegionName = 'kanto' | 'johto' | 'hoenn' | 'sinnoh'

/** Tags a SPECIAL dungeon can select on. PROTOTYPE: only what the examples need. */
export type SpeciesTag = 'fossil' | 'starter' | 'baby' | 'pseudoLegendary' | 'eevee' | 'nocturnal'

export interface FixtureSpecies extends PokemonSpecies {
  readonly origin: RegionName
  readonly tags: readonly SpeciesTag[]
}

const entry = (
  speciesId: number, name: string, types: readonly PokemonTypeName[],
  baseStats: readonly [number, number, number, number, number, number],
  catchRate: number, origin: RegionName, tags: readonly SpeciesTag[] = [],
): FixtureSpecies => ({
  speciesId, name,
  types: types as FixtureSpecies['types'],
  baseStats, catchRate, origin, tags,
})

export const SPECIES: Readonly<Record<number, FixtureSpecies>> = Object.fromEntries([
  // Kanto
  entry(4, 'Charmander', ['fire'], [39, 52, 43, 60, 50, 65], 45, 'kanto', ['starter']),
  entry(6, 'Charizard', ['fire', 'flying'], [78, 84, 78, 109, 85, 100], 45, 'kanto', ['starter']),
  entry(7, 'Squirtle', ['water'], [44, 48, 65, 50, 64, 43], 45, 'kanto', ['starter']),
  entry(25, 'Pikachu', ['electric'], [35, 55, 40, 50, 50, 90], 190, 'kanto'),
  entry(35, 'Clefairy', ['fairy'], [70, 45, 48, 60, 65, 35], 150, 'kanto'),
  entry(37, 'Vulpix', ['fire'], [38, 41, 40, 50, 65, 65], 190, 'kanto'),
  entry(41, 'Zubat', ['poison', 'flying'], [40, 45, 35, 30, 40, 55], 255, 'kanto', ['nocturnal']),
  entry(43, 'Oddish', ['grass', 'poison'], [45, 50, 55, 75, 65, 30], 255, 'kanto'),
  entry(66, 'Machop', ['fighting'], [70, 80, 50, 35, 35, 35], 180, 'kanto'),
  entry(68, 'Machamp', ['fighting'], [90, 130, 80, 65, 85, 55], 45, 'kanto'),
  entry(74, 'Geodude', ['rock', 'ground'], [40, 80, 100, 30, 30, 20], 255, 'kanto'),
  entry(81, 'Magnemite', ['electric', 'steel'], [25, 35, 70, 95, 55, 45], 190, 'kanto'),
  entry(95, 'Onix', ['rock', 'ground'], [35, 45, 160, 30, 45, 70], 45, 'kanto'),
  entry(124, 'Jynx', ['ice', 'psychic'], [65, 50, 35, 115, 95, 95], 45, 'kanto'),
  entry(133, 'Eevee', ['normal'], [55, 55, 50, 45, 65, 55], 45, 'kanto', ['eevee']),
  entry(135, 'Jolteon', ['electric'], [65, 65, 60, 110, 95, 130], 45, 'kanto', ['eevee']),
  entry(136, 'Flareon', ['fire'], [65, 130, 60, 95, 110, 65], 45, 'kanto', ['eevee']),
  entry(138, 'Omanyte', ['rock', 'water'], [35, 40, 100, 90, 55, 35], 45, 'kanto', ['fossil']),
  entry(140, 'Kabuto', ['rock', 'water'], [30, 80, 90, 55, 45, 55], 45, 'kanto', ['fossil']),
  entry(142, 'Aerodactyl', ['rock', 'flying'], [80, 105, 65, 60, 75, 130], 45, 'kanto', ['fossil']),
  entry(147, 'Dratini', ['dragon'], [41, 64, 45, 50, 50, 50], 45, 'kanto', ['pseudoLegendary']),
  // Johto
  entry(155, 'Cyndaquil', ['fire'], [39, 52, 43, 60, 50, 65], 45, 'johto', ['starter']),
  entry(172, 'Pichu', ['electric'], [20, 40, 15, 35, 35, 60], 190, 'johto', ['baby']),
  entry(179, 'Mareep', ['electric'], [55, 40, 40, 65, 45, 35], 235, 'johto'),
  entry(183, 'Marill', ['water', 'fairy'], [70, 20, 50, 20, 50, 40], 190, 'johto', ['baby']),
  entry(200, 'Misdreavus', ['ghost'], [60, 60, 60, 85, 85, 85], 45, 'johto', ['nocturnal']),
  entry(220, 'Swinub', ['ice', 'ground'], [50, 50, 40, 30, 30, 50], 225, 'johto'),
  entry(246, 'Larvitar', ['rock', 'ground'], [50, 64, 50, 45, 50, 41], 45, 'johto', ['pseudoLegendary']),
  // Hoenn
  entry(255, 'Torchic', ['fire'], [45, 60, 40, 70, 50, 45], 45, 'hoenn', ['starter']),
  entry(302, 'Sableye', ['dark', 'ghost'], [50, 75, 75, 65, 65, 50], 45, 'hoenn', ['nocturnal']),
  entry(345, 'Lileep', ['rock', 'grass'], [66, 41, 77, 61, 87, 23], 45, 'hoenn', ['fossil']),
  entry(347, 'Anorith', ['rock', 'bug'], [45, 95, 50, 40, 50, 75], 45, 'hoenn', ['fossil']),
  entry(361, 'Snorunt', ['ice'], [50, 50, 50, 50, 50, 50], 190, 'hoenn'),
  entry(371, 'Bagon', ['dragon'], [45, 75, 60, 40, 30, 50], 45, 'hoenn', ['pseudoLegendary']),
  // Sinnoh
  entry(390, 'Chimchar', ['fire'], [44, 58, 44, 58, 44, 61], 45, 'sinnoh', ['starter']),
  entry(393, 'Piplup', ['water'], [53, 51, 53, 61, 56, 40], 45, 'sinnoh', ['starter']),
  entry(408, 'Cranidos', ['rock'], [67, 125, 40, 30, 30, 58], 45, 'sinnoh', ['fossil']),
  entry(410, 'Shieldon', ['rock', 'steel'], [30, 42, 118, 42, 88, 30], 45, 'sinnoh', ['fossil']),
  entry(418, 'Buizel', ['water'], [55, 65, 35, 60, 30, 85], 190, 'sinnoh'),
  entry(422, 'Shellos', ['water'], [76, 48, 48, 57, 62, 34], 190, 'sinnoh'),
  entry(443, 'Gible', ['dragon', 'ground'], [58, 70, 45, 40, 45, 42], 45, 'sinnoh', ['pseudoLegendary']),
  entry(459, 'Snover', ['grass', 'ice'], [60, 62, 50, 62, 60, 40], 120, 'sinnoh'),
  entry(471, 'Glaceon', ['ice'], [65, 60, 110, 130, 95, 65], 45, 'sinnoh', ['eevee']),
].map(species => [species.speciesId, species]))

export const speciesById = (speciesId: number): FixtureSpecies | null => SPECIES[speciesId] ?? null

export const ALL_SPECIES: readonly FixtureSpecies[] = Object.values(SPECIES)

/** Theme roster for a dungeon that declares no pool rule. PROTOTYPE ASSUMPTION. */
export const THEME_POOLS: Readonly<Record<DungeonTheme, readonly number[]>> = {
  cave: [74, 95, 41, 246],
  ruin: [41, 81, 25, 95, 302],
  tower: [25, 81, 135, 200],
  forest: [43, 41, 66, 25],
  mine: [74, 95, 81, 246, 408],
  volcano: [4, 37, 74, 66, 136],
  glacier: [220, 361, 459, 471, 124],
}

export const poolFor = (theme: DungeonTheme): readonly number[] => THEME_POOLS[theme] ?? [74]
