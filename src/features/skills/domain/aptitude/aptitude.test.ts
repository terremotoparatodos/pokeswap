import { describe, expect, it } from 'vitest'
import { SKILL_IDS } from '../skills'
import { FALLBACK_APTITUDE, derivedAptitude, indexOverrides, resolveAptitude, workAptitudes } from './aptitude'
import { APTITUDES, clampAptitude } from './aptitudeScale'
import { statTier, typeTier } from './aptitudeRules'
import { APTITUDE_OVERRIDES } from './overrides'
import { SPECIES_COUNT, allSpeciesFacts, speciesDisplayName, speciesFacts } from './speciesFacts'

describe('species facts', () => {
  it('covers the whole Pokédex the game uses (1–493)', () => {
    expect(SPECIES_COUNT).toBe(493)
    expect(speciesFacts(1)?.types).toEqual(['grass', 'poison'])
    expect(speciesFacts(493)).not.toBeNull()
  })

  it('names species for display', () => {
    expect(speciesDisplayName(123)).toBe('Scyther')
    expect(speciesDisplayName(122)).toBe('Mr Mime')
    expect(speciesDisplayName(9999)).toBe('#9999')
  })
})

describe('aptitude scale', () => {
  it('clamps anything into 1..5', () => {
    expect(clampAptitude(-3)).toBe(1)
    expect(clampAptitude(9)).toBe(5)
    expect(clampAptitude(Number.NaN)).toBe(1)
    expect(clampAptitude(3.4)).toBe(3)
  })
})

describe('derived aptitudes', () => {
  it('gives every species a value of at least 1 in every skill (nobody is useless)', () => {
    for (const facts of allSpeciesFacts()) {
      for (const skill of SKILL_IDS) {
        const value = resolveAptitude(facts.speciesId, skill).value
        expect(APTITUDES, `${facts.name} ${skill}`).toContain(value)
      }
    }
  })

  it('reads stats, not only type: same typing, different bodies, different aptitude', () => {
    // Caterpie and Beedrill are both Bug: one is a worm, the other has stingers.
    expect(derivedAptitude(speciesFacts(15)!, 'woodcutting')).toBeGreaterThan(derivedAptitude(speciesFacts(10)!, 'woodcutting'))
    expect(statTier('mining', [50, 130, 120, 50, 50, 50])).toBe(1)
    expect(statTier('mining', [50, 40, 40, 50, 50, 50])).toBe(-1)
  })

  it('lets a helpful type outweigh an unhelpful second type', () => {
    expect(typeTier('farming', ['grass', 'fire'])).toBe(2)
    expect(typeTier('farming', ['fire', 'flying'])).toBe(-1)
    expect(typeTier('mining', ['psychic'])).toBe(0)
  })

  it('keeps specialists rare and the middle wide', () => {
    for (const skill of SKILL_IDS) {
      const counts = [0, 0, 0, 0, 0, 0]
      for (const facts of allSpeciesFacts()) counts[resolveAptitude(facts.speciesId, skill).value]++
      const atLeastTwo = (SPECIES_COUNT - counts[1]) / SPECIES_COUNT
      // No deadlock: most species can do even the top rung (minAptitude 2).
      expect(atLeastTwo, skill).toBeGreaterThan(0.65)
      // Specialists are special.
      expect(counts[5] / SPECIES_COUNT, skill).toBeLessThan(0.15)
    }
  })

  it('makes the obvious workers good at their work', () => {
    expect(resolveAptitude(74, 'mining').value).toBeGreaterThanOrEqual(4) // Geodude
    expect(resolveAptitude(95, 'mining').value).toBeGreaterThanOrEqual(4) // Onix
    expect(resolveAptitude(3, 'farming').value).toBeGreaterThanOrEqual(4) // Venusaur
    expect(resolveAptitude(214, 'woodcutting').value).toBeGreaterThanOrEqual(4) // Heracross
  })
})

describe('overrides', () => {
  it('win over the derived value', () => {
    expect(resolveAptitude(123, 'woodcutting')).toEqual({ value: 5, source: 'override' }) // Scyther
    expect(resolveAptitude(185, 'woodcutting')).toEqual({ value: 1, source: 'override' }) // Sudowoodo
    expect(resolveAptitude(143, 'farming')).toEqual({ value: 2, source: 'override' }) // Snorlax
  })

  it('only patch the skills they name', () => {
    expect(resolveAptitude(123, 'mining').source).toBe('derived')
  })

  it('are easy to patch: a new table replaces the default one', () => {
    const custom = indexOverrides([{ speciesId: 129, aptitudes: { farming: 5 }, reason: 'test' }])
    expect(resolveAptitude(129, 'farming', custom)).toEqual({ value: 5, source: 'override' })
    expect(resolveAptitude(123, 'woodcutting', custom).source).toBe('derived')
  })

  it('are valid, unique and explained', () => {
    const ids = APTITUDE_OVERRIDES.map(entry => entry.speciesId)
    expect(new Set(ids).size).toBe(ids.length)
    for (const entry of APTITUDE_OVERRIDES) {
      expect(speciesFacts(entry.speciesId), `#${entry.speciesId}`).not.toBeNull()
      expect(entry.reason.length, `#${entry.speciesId}`).toBeGreaterThan(10)
      for (const [skill, value] of Object.entries(entry.aptitudes)) {
        expect(SKILL_IDS, `#${entry.speciesId}`).toContain(skill)
        expect(APTITUDES).toContain(value)
      }
    }
  })
})

describe('fallback', () => {
  it('treats an unknown species as a neutral worker, never as unable', () => {
    expect(resolveAptitude(99_999, 'mining')).toEqual({ value: FALLBACK_APTITUDE, source: 'fallback' })
    expect(FALLBACK_APTITUDE).toBeGreaterThanOrEqual(2)
  })

  it('is serializable: a plain record of three numbers', () => {
    const aptitudes = workAptitudes(68)
    expect(JSON.parse(JSON.stringify(aptitudes))).toEqual(aptitudes)
    expect(Object.keys(aptitudes).sort()).toEqual([...SKILL_IDS].sort())
  })
})
