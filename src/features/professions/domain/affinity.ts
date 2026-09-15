// Pokémon profession affinity — data-driven, roster-wide.
//
//   raw[trait] = generalist + Σ typeWeights + Σ statWeights · statNorm + overrides
//   fit        = 1 − e^(−Σraw / FIT_K)               how suited, saturating
//   budget     = (0.3 + 0.7·fit) · levelFactor · (1 + 0.1·bstNorm)
//   bonus[t]   = min(cap[t], raw[t]/Σraw · budget · scale[t])
//
// The budget is shared across traits: a species strong in one niche is
// proportionally weaker in the others, and legendaries get at most +10 %.
// That is what prevents one "best Pokémon for Mining".

import { AFFINITY_PROFILES, GENERALIST_WEIGHTS, SPECIES_OVERRIDES, TYPE_HOME_BIOMES } from './catalog/affinityProfiles'
import {
  POKEMON_TYPES, PROFESSION_TRAITS, STAT_KEYS,
  type AccessTag, type Biome, type PokemonProfessionAffinity, type PokemonProfessionInput, type PokemonType,
  type ProfessionId, type ProfessionTrait, type SpeciesOverride,
} from './types'

const FIT_K = 1.2
const STAT_FLOOR = 30
const STAT_SPAN = 100
const BST_FLOOR = 250
const BST_SPAN = 430

/** Spanish and English type names seen in `pokemon.type1/type2`. Mirrors wildlands population aliases. */
const TYPE_ALIASES: Readonly<Record<string, PokemonType>> = {
  planta: 'grass', fuego: 'fire', agua: 'water', bicho: 'bug', veneno: 'poison',
  'eléctrico': 'electric', electrico: 'electric', 'psíquico': 'psychic', psiquico: 'psychic', roca: 'rock',
  siniestro: 'dark', fantasma: 'ghost', tierra: 'ground', acero: 'steel', hielo: 'ice', lucha: 'fighting',
  'dragón': 'dragon', hada: 'fairy', volador: 'flying',
}

const KNOWN_TYPES = new Set<string>(POKEMON_TYPES)

export function normalisePokemonType(type: string | null): PokemonType | null {
  if (!type) return null
  const key = type.trim().toLowerCase()
  const resolved = TYPE_ALIASES[key] ?? key
  return KNOWN_TYPES.has(resolved) ? (resolved as PokemonType) : null
}

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const round4 = (value: number): number => Math.round(value * 10_000) / 10_000

export function statNorm(value: number): number {
  return clamp01((value - STAT_FLOOR) / STAT_SPAN)
}

/** Level 1 → 0.5, level 100 → 1. New Pokémon are useful; trained ones are better. */
export function levelFactor(level: number): number {
  return 0.5 + 0.5 * Math.sqrt(Math.min(100, Math.max(1, level)) / 100)
}

function addWeights(target: Record<ProfessionTrait, number>, weights: Partial<Record<ProfessionTrait, number>> | undefined, factor = 1): void {
  if (!weights) return
  for (const trait of PROFESSION_TRAITS) target[trait] += (weights[trait] ?? 0) * factor
}

export function computeAffinity(
  input: PokemonProfessionInput,
  profession: ProfessionId,
  overrides: readonly SpeciesOverride[] = SPECIES_OVERRIDES,
): PokemonProfessionAffinity {
  const profile = AFFINITY_PROFILES[profession]
  const raw = Object.fromEntries(PROFESSION_TRAITS.map(trait => [trait, 0])) as Record<ProfessionTrait, number>
  const types = [...new Set([normalisePokemonType(input.type1), normalisePokemonType(input.type2)])]
    .filter((type): type is PokemonType => type !== null)

  addWeights(raw, GENERALIST_WEIGHTS)
  for (const type of types) addWeights(raw, profile.typeWeights[type])
  if (input.baseStats) STAT_KEYS.forEach((stat, index) => addWeights(raw, profile.statWeights[stat], statNorm(input.baseStats![index])))
  for (const override of overrides) {
    if (override.speciesId === input.speciesId && override.profession === profession) addWeights(raw, override.rawBoost)
  }
  // Reserved: nature/ability modifiers plug in here once an instance model exists.

  const total = PROFESSION_TRAITS.reduce((sum, trait) => sum + raw[trait], 0)
  const fit = 1 - Math.exp(-total / FIT_K)
  const bst = input.baseStats ? input.baseStats.reduce((sum, value) => sum + value, 0) : 0
  const budget = (0.3 + 0.7 * fit) * levelFactor(input.level) * (1 + 0.1 * clamp01((bst - BST_FLOOR) / BST_SPAN))

  const bonuses: Partial<Record<ProfessionTrait, number>> = {}
  let archetype: ProfessionTrait = PROFESSION_TRAITS[0]
  for (const trait of PROFESSION_TRAITS) {
    if (raw[trait] > raw[archetype]) archetype = trait
    if (raw[trait] <= 0) continue
    const value = Math.min(profile.traitCap[trait] ?? 0, (raw[trait] / total) * budget * (profile.traitScale[trait] ?? 0))
    if (value > 0) bonuses[trait] = round4(value)
  }

  const access: AccessTag[] = profile.accessRules
    .filter(rule => types.some(type => rule.anyType.includes(type)))
    .filter(rule => !rule.minStat || (input.baseStats !== null && input.baseStats[STAT_KEYS.indexOf(rule.minStat.stat)] >= rule.minStat.value))
    .map(rule => rule.tag)

  const homeBiomes = [...new Set(types.flatMap(type => TYPE_HOME_BIOMES[type] ?? []))] as Biome[]

  return { speciesId: input.speciesId, profession, fit: round4(fit), bonuses, access, archetype, homeBiomes }
}
