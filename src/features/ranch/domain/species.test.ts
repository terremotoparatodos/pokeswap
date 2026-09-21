import { describe, expect, it } from 'vitest'
import { isSpeciesId, MAX_SPECIES, RANDOM_POOL, SPECIES_COUNT, speciesName } from './species'

describe('species', () => {
  it('names exactly the 493 species that have overworld sheets', () => {
    expect(SPECIES_COUNT).toBe(MAX_SPECIES)
    expect(speciesName(1)).toBe('Bulbasaur')
    expect(speciesName(25)).toBe('Pikachu')
    expect(speciesName(151)).toBe('Mew')
    expect(speciesName(197)).toBe('Umbreon')
    expect(speciesName(251)).toBe('Celebi')
    expect(speciesName(258)).toBe('Mudkip')
    expect(speciesName(386)).toBe('Deoxys')
    expect(speciesName(448)).toBe('Lucario')
    expect(speciesName(493)).toBe('Arceus')
  })

  it('keeps legendary and mythical Pokémon out of the random pool', () => {
    expect(RANDOM_POOL).toHaveLength(493 - 35)
    for (const id of [144, 150, 151, 249, 251, 384, 386, 483, 490, 493]) expect(RANDOM_POOL).not.toContain(id)
    for (const id of [1, 25, 133, 197, 258, 448]) expect(RANDOM_POOL).toContain(id)
  })

  it('validates ids', () => {
    expect(isSpeciesId(1)).toBe(true)
    expect(isSpeciesId(493)).toBe(true)
    expect(isSpeciesId(0)).toBe(false)
    expect(isSpeciesId(494)).toBe(false)
    expect(isSpeciesId(2.5)).toBe(false)
    expect(isSpeciesId('25')).toBe(false)
  })
})
