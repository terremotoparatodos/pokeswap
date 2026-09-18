// Example DungeonDefinitions, one per category (D1 §4, §47).
//
// The point is not the roster: it is that the generator takes a **pool rule**
// and never hardcodes species, so TYPE, GENERATION and SPECIAL are three
// configurations of the same machine. Four examples are enough to prove it.
//
// PLAYTEST PARAMETER: every name, tier, floor count and modifier here.

import type { DungeonDefinition, PoolRule } from '../domain/dungeonSpawn'
import { ALL_SPECIES, type FixtureSpecies, type RegionName, type SpeciesTag } from './speciesFixtures'

/**
 * Resolves a pool rule against the fixtures.
 *
 * APPROVED nuance for TYPE: most of the roster answers to the theme, but the
 * pool is **not** forced to be 100 % that type — a compatible secondary fauna
 * is allowed. That is what `secondaryShare` is: the rule keeps a few nearby
 * species so a Fire dungeon is not literally nothing but Fire.
 */
export function resolvePool(rule: PoolRule, all: readonly FixtureSpecies[] = ALL_SPECIES): number[] {
  if (rule.kind === 'type') {
    const primary = all.filter(species => species.types.some(type => rule.types.includes(type)))
    // Compatible fauna: rock/ground dwellers that live in any cave.
    const secondary = all.filter(species =>
      !primary.includes(species) && species.types.some(type => type === 'rock' || type === 'ground'))
    return [...primary, ...secondary.slice(0, Math.max(1, Math.round(primary.length * 0.25)))]
      .map(species => species.speciesId)
  }
  if (rule.kind === 'generation') {
    return all
      .filter(species => rule.regions.includes(species.origin as RegionName))
      .map(species => species.speciesId)
  }
  return all
    .filter(species => species.tags.some(tag => rule.tags.includes(tag as SpeciesTag)))
    .map(species => species.speciesId)
}

export const DUNGEON_DEFINITIONS: readonly DungeonDefinition[] = [
  {
    definitionId: 'ignea',
    name: 'Caverna Ígnea',
    category: 'type',
    theme: 'volcano',
    tier: 'B',
    biomes: ['volcanic', 'mountain'],
    pool: { kind: 'type', types: ['fire'] },
    floors: 16,
    lootTableId: 'floor',
    modifiers: { luckyChance: 0.12 },
  },
  {
    definitionId: 'glacial',
    name: 'Grieta Glacial',
    category: 'type',
    theme: 'glacier',
    tier: 'C',
    biomes: ['tundra'],
    pool: { kind: 'type', types: ['ice'] },
    floors: 10,
    lootTableId: 'floor',
    modifiers: { luckyChance: 0.1 },
  },
  {
    definitionId: 'sinnoh-deep',
    name: 'Simas de Sinnoh',
    category: 'generation',
    theme: 'cave',
    tier: 'B',
    biomes: ['mountain', 'cave'],
    pool: { kind: 'generation', regions: ['sinnoh'] },
    floors: 14,
    lootTableId: 'floor',
    modifiers: { luckyChance: 0.1 },
  },
  {
    definitionId: 'fossil-strata',
    name: 'Estratos Fósiles',
    category: 'special',
    theme: 'ruin',
    tier: 'A',
    biomes: ['desert', 'cave'],
    pool: { kind: 'special', label: 'Fósiles', tags: ['fossil'] },
    floors: 20,
    lootTableId: 'floor',
    modifiers: { luckyChance: 0.16 },
  },
]

export const definitionById = (definitionId: string): DungeonDefinition | null =>
  DUNGEON_DEFINITIONS.find(definition => definition.definitionId === definitionId) ?? null

/** The species this definition may spawn, resolved once. */
export const poolOf = (definition: DungeonDefinition): number[] => {
  const pool = resolvePool(definition.pool)
  return pool.length ? pool : [74]
}

/** Who may be the Alpha: the declared subset, or the whole pool. */
export const alphaPoolOf = (definition: DungeonDefinition): number[] => {
  const declared = definition.alphaPool?.filter(id => poolOf(definition).includes(id)) ?? []
  return declared.length ? declared : poolOf(definition)
}
