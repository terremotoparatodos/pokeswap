// Affinity profiles: how types and base stats map onto profession traits.
//
// These weights are the whole "Pokémon × profession" design surface. The
// formula (domain/affinity.ts) turns them into bonuses for all 493 species;
// individual species are only touched through the short override list below.

import type { AffinityProfile, Biome, PokemonType, ProfessionId, ProfessionTrait, SpeciesOverride } from '../types'

type Weights = Partial<Record<ProfessionTrait, number>>

/** Small spread every species receives so nobody is useless in any profession. */
export const GENERALIST_WEIGHTS: Weights = { energySaving: 0.05, toolCare: 0.05, quality: 0.05 }

const TRAIT_SCALE: Weights = {
  speed: 0.35, yield: 0.45, energySaving: 0.3, rareFind: 1.2, quality: 0.4, toolCare: 0.6,
  critical: 0.15, detection: 1.2, processing: 0.4, biomeMastery: 0.25, safety: 0.6,
}

const TRAIT_CAP: Weights = {
  speed: 0.25, yield: 0.3, energySaving: 0.25, rareFind: 1, quality: 0.3, toolCare: 0.5,
  critical: 0.1, detection: 1, processing: 0.3, biomeMastery: 0.2, safety: 0.5,
}

export const AFFINITY_PROFILES: Readonly<Record<ProfessionId, AffinityProfile>> = {
  mining: {
    profession: 'mining',
    typeWeights: {
      rock: { energySaving: 0.5, toolCare: 0.4, safety: 0.2 },
      ground: { speed: 0.5, detection: 0.2, yield: 0.2 },
      steel: { rareFind: 0.4, detection: 0.4, toolCare: 0.2 },
      fighting: { yield: 0.6, critical: 0.2 },
      fire: { processing: 0.4 },
      electric: { detection: 0.3, rareFind: 0.2 },
      dragon: { yield: 0.2, rareFind: 0.2 },
    },
    statWeights: {
      attack: { yield: 0.5, critical: 0.15 },
      defense: { toolCare: 0.4, energySaving: 0.25, safety: 0.2 },
      speed: { speed: 0.45 },
      specialAttack: { detection: 0.3, rareFind: 0.2 },
      hp: { energySaving: 0.15 },
      specialDefense: { safety: 0.2 },
    },
    traitScale: TRAIT_SCALE,
    traitCap: TRAIT_CAP,
    accessRules: [{ tag: 'hardRock', anyType: ['rock', 'ground', 'steel', 'fighting'], minStat: { stat: 'attack', value: 80 } }],
  },
  woodcutting: {
    profession: 'woodcutting',
    typeWeights: {
      grass: { yield: 0.3, biomeMastery: 0.3 },
      bug: { speed: 0.4, critical: 0.2 },
      fighting: { yield: 0.5 },
      normal: { energySaving: 0.3, toolCare: 0.2 },
      steel: { toolCare: 0.3, speed: 0.2 },
      flying: { detection: 0.3 },
      dark: { critical: 0.2, speed: 0.2 },
    },
    statWeights: {
      attack: { yield: 0.5, critical: 0.1 },
      speed: { speed: 0.45 },
      defense: { toolCare: 0.35, energySaving: 0.2 },
      hp: { energySaving: 0.2 },
      specialDefense: { safety: 0.15 },
      specialAttack: { detection: 0.15, quality: 0.15 },
    },
    traitScale: TRAIT_SCALE,
    traitCap: TRAIT_CAP,
    accessRules: [],
  },
  fishing: {
    profession: 'fishing',
    typeWeights: {
      water: { yield: 0.5, biomeMastery: 0.3, rareFind: 0.2 },
      flying: { detection: 0.5, speed: 0.2 },
      electric: { speed: 0.4, critical: 0.2 },
      ice: { quality: 0.4 },
      dragon: { rareFind: 0.4 },
      psychic: { detection: 0.3, rareFind: 0.2 },
      normal: { energySaving: 0.2 },
    },
    statWeights: {
      speed: { speed: 0.35 },
      specialAttack: { detection: 0.25, rareFind: 0.15 },
      specialDefense: { quality: 0.3 },
      hp: { energySaving: 0.25, safety: 0.15 },
      attack: { yield: 0.3 },
      defense: { toolCare: 0.3 },
    },
    traitScale: TRAIT_SCALE,
    traitCap: TRAIT_CAP,
    accessRules: [{ tag: 'deepWater', anyType: ['water'], minStat: { stat: 'hp', value: 50 } }],
  },
  alchemy: {
    profession: 'alchemy',
    typeWeights: {
      grass: { yield: 0.4, detection: 0.3, biomeMastery: 0.2 },
      poison: { processing: 0.5, quality: 0.2 },
      psychic: { quality: 0.4, processing: 0.3 },
      fairy: { quality: 0.3, rareFind: 0.3 },
      bug: { detection: 0.3, speed: 0.2 },
      fire: { processing: 0.4 },
      ghost: { rareFind: 0.3 },
      water: { processing: 0.2 },
      normal: { energySaving: 0.2 },
    },
    statWeights: {
      specialDefense: { quality: 0.35, processing: 0.2 },
      specialAttack: { processing: 0.3, detection: 0.15 },
      hp: { energySaving: 0.25 },
      speed: { speed: 0.35 },
      attack: { yield: 0.2 },
      defense: { toolCare: 0.2 },
    },
    traitScale: TRAIT_SCALE,
    traitCap: TRAIT_CAP,
    accessRules: [{ tag: 'frozenGround', anyType: ['ice', 'fire', 'steel'] }],
  },
}

/**
 * Biomes where a type is "at home" for `biomeMastery`. Mirrors
 * wildlands/engine/population.ts BIOME_TYPES (inverted); a test guards drift.
 */
export const TYPE_HOME_BIOMES: Readonly<Partial<Record<PokemonType, readonly Biome[]>>> = {
  ground: ['desert'], rock: ['desert'], fire: ['desert'], steel: ['desert', 'tundra'],
  water: ['beach', 'ocean', 'deep'], normal: ['beach', 'grassland'], flying: ['beach'],
  grass: ['grassland', 'forest'], bug: ['grassland', 'forest'], electric: ['grassland'], fairy: ['grassland'],
  poison: ['forest'], ghost: ['forest'], dark: ['forest'],
  ice: ['tundra'], psychic: ['tundra'], dragon: ['ocean', 'deep'],
}

/**
 * Exceptions only where canon clearly contradicts the formula. Keep this list
 * short; the isolation test fails above 25 entries.
 */
export const SPECIES_OVERRIDES: readonly SpeciesOverride[] = [
  { speciesId: 399, profession: 'woodcutting', rawBoost: { speed: 0.3 }, reason: 'Bidoof roe troncos constantemente (Pokédex).' },
  { speciesId: 400, profession: 'woodcutting', rawBoost: { yield: 0.6, speed: 0.3 }, reason: 'Bibarel construye diques cortando árboles (Pokédex).' },
  { speciesId: 113, profession: 'alchemy', rawBoost: { processing: 0.5, quality: 0.3 }, reason: 'Chansey asiste en Centros Pokémon; afinidad curativa.' },
  { speciesId: 242, profession: 'alchemy', rawBoost: { processing: 0.6, quality: 0.4 }, reason: 'Blissey es la especie enfermera por excelencia.' },
]
