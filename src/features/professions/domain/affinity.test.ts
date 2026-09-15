import { describe, expect, it } from 'vitest'
import { computeAffinity, levelFactor } from './affinity'
import { SPECIES_BASE_STATS } from './catalog/speciesBaseStats'
import { POKEMON_TYPES, PROFESSION_IDS, type PokemonProfessionInput, type ProfessionTrait } from './types'

const input = (speciesId: number, type1: string, type2: string | null = null, level = 50): PokemonProfessionInput => ({
  speciesId, type1, type2, level, baseStats: SPECIES_BASE_STATS[speciesId],
})

const maxBonus = (bonuses: Partial<Record<ProfessionTrait, number>>) => Math.max(0, ...Object.values(bonuses))

describe('affinity formula', () => {
  it('derives the conceptual niches from types and stats, without per-species rules', () => {
    expect(computeAffinity(input(68, 'fighting'), 'mining', []).archetype).toBe('yield')
    expect(computeAffinity(input(50, 'ground'), 'mining', []).archetype).toBe('speed')
    expect(['energySaving', 'toolCare']).toContain(computeAffinity(input(74, 'rock', 'ground'), 'mining', []).archetype)
    expect(computeAffinity(input(81, 'electric', 'steel'), 'mining', []).archetype).toBe('detection')
  })

  it('accepts Spanish database type names', () => {
    expect(computeAffinity(input(68, 'Lucha'), 'mining')).toEqual(computeAffinity(input(68, 'fighting'), 'mining'))
  })

  it('uses overrides as raw nudges, still bounded by caps', () => {
    const plain = computeAffinity(input(400, 'normal', 'water'), 'woodcutting', [])
    const canon = computeAffinity(input(400, 'normal', 'water'), 'woodcutting')
    expect(canon.bonuses.yield!).toBeGreaterThan(plain.bonuses.yield!)
    expect(canon.bonuses.yield!).toBeLessThanOrEqual(0.3)
  })

  it('grants biome mastery and access only through type and stat rules', () => {
    const blastoise = computeAffinity(input(9, 'water'), 'fishing')
    const charizard = computeAffinity(input(6, 'fire', 'flying'), 'fishing')
    expect(blastoise.bonuses.biomeMastery).toBeGreaterThan(0)
    expect(blastoise.homeBiomes).toContain('ocean')
    expect(charizard.bonuses.biomeMastery).toBeUndefined()
    expect(blastoise.access).toEqual(['deepWater'])
    expect(computeAffinity(input(129, 'water'), 'fishing').access).toEqual([])
    expect(computeAffinity(input(68, 'fighting'), 'mining').access).toEqual(['hardRock'])
    expect(computeAffinity(input(50, 'ground'), 'mining').access).toEqual([])
  })

  it('scales with Pokémon level without making low levels useless', () => {
    expect(levelFactor(1)).toBeCloseTo(0.55)
    expect(levelFactor(100)).toBe(1)
    const low = computeAffinity(input(68, 'fighting', null, 1), 'mining')
    const high = computeAffinity(input(68, 'fighting', null, 100), 'mining')
    expect(high.bonuses.yield! / low.bonuses.yield!).toBeCloseTo(1 / 0.55, 1)
  })

  it('ignores reserved nature/ability fields until an instance model exists', () => {
    const base = input(68, 'fighting')
    expect(computeAffinity({ ...base, nature: 'adamant', abilityId: 'guts' }, 'mining')).toEqual(computeAffinity(base, 'mining'))
  })

  it('does not let a legendary generalist beat a typed specialist', () => {
    const mewtwo = computeAffinity(input(150, 'psychic'), 'mining')
    const machamp = computeAffinity(input(68, 'fighting'), 'mining')
    expect(maxBonus(mewtwo.bonuses)).toBeLessThan(machamp.bonuses.yield!)
  })
})

describe('affinity across the roster', () => {
  // The repo has real base stats for all 493 species but no offline type table
  // (types live in the `pokemon` table), so every stat line is tested with every type.
  const species = Object.keys(SPECIES_BASE_STATS).map(Number)

  it('gives every stat line and type a meaningful niche in some profession', () => {
    for (const id of species) {
      for (const type of POKEMON_TYPES) {
        const best = Math.max(...PROFESSION_IDS.map(profession => maxBonus(computeAffinity(input(id, type), profession).bonuses)))
        expect(best, `species ${id} as ${type}`).toBeGreaterThanOrEqual(0.02)
      }
    }
  })

  it('never exceeds trait caps and spreads the top spot across different species', () => {
    const niches: ProfessionTrait[] = ['speed', 'yield', 'energySaving', 'detection', 'toolCare', 'rareFind']
    const best = new Map<ProfessionTrait, { id: number; value: number }>()
    for (const id of species) {
      for (const type of POKEMON_TYPES) {
        const { bonuses } = computeAffinity(input(id, type), 'mining')
        for (const [trait, value] of Object.entries(bonuses) as [ProfessionTrait, number][]) {
          expect(value).toBeLessThanOrEqual(1)
          if (niches.includes(trait) && value > (best.get(trait)?.value ?? -1)) best.set(trait, { id, value })
        }
      }
    }
    expect(new Set([...best.values()].map(entry => entry.id)).size).toBeGreaterThanOrEqual(4)
    expect(best.get('yield')!.id).not.toBe(best.get('speed')!.id)
  })
})
